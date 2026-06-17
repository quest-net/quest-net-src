import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { ActorUtils } from "./ActorUtils";
import { Actor, Position } from "./Actor";
import { CharacterActions } from "../Character/CharacterActions";
import { EntityActions } from "../Entity/EntityActions";

/**
 * Shared actor logic for both Characters and Entities.
 *
 * The operations callers invoke are unified under a single `actor:*` surface
 * (move, edit, delete, bulkEditTags, remove): each resolves the actor's kind
 * from its id via `ActorUtils.getActorKind` and either runs kind-agnostic logic
 * or routes to the kind-specific handler. Callers never branch on kind.
 *
 * `remove` keeps the genuinely-different despawn semantics in
 * CharacterActions/EntityActions (Characters return to the roster, Entities are
 * deleted) but hides that split behind the unified action. Spawn/create stay
 * split because their call sites are inherently single-kind.
 */
export const ActorActions = {
	/**
	 * Moves an actor to a new position. Players may only move their own selected
	 * Character; they can never control Entities (DM-only).
	 */
	move(
		params: { actorId: string; position: Position },
		context: Context
	): void {
		// A player may only move their own selected Character. Since that selection
		// only ever points at a Character the player owns, this single check also
		// covers "players can't control Entities" (an entity id is never the
		// player's selected character) without resolving the actor's kind.
		if (context.User.Role === "player") {
			const campaign = CampaignUtils.getActiveCampaign(context);
			if (
				context.User.SelectedCharacters?.[campaign.RoomCode] !== params.actorId
			) {
				console.warn(
					`Player ${context.User.Id} cannot move actor: ${params.actorId}`
				);
				return;
			}
			// Movement-range restriction is enforced entirely client-side (world view
			// blocks out-of-range clicks; first-person applies a soft pull-back). The
			// DM trusts the requested position rather than re-validating range here.
		}

		ActorUtils.moveActor(
			{ actorId: params.actorId, position: params.position },
			context
		);
	},

	/**
	 * Edits an actor's properties. Players may edit Characters but never Entities.
	 */
	edit(
		params: { actorId: string; updates: Partial<Actor> },
		context: Context
	): void {
		// Players may edit Characters but never Entities. Kind only matters for this
		// permission gate; editing itself is kind-agnostic. A not-found id falls
		// through to editActor, which logs and no-ops.
		if (context.User.Role === "player") {
			const kind = ActorUtils.getActorKind(context, params.actorId);
			if (kind === "entity") {
				console.warn(
					`Player ${context.User.Id} cannot edit entity: ${params.actorId}`
				);
				return;
			}
		}

		ActorUtils.editActor(
			{ actorId: params.actorId, updates: params.updates },
			context
		);
	},

	/**
	 * Deletes an actor from the roster/templates (NOT from GameState). A Character
	 * that is currently spawned must be removed from the field first.
	 */
	delete(params: { actorId: string }, context: Context): void {
		const kind = ActorUtils.getActorKind(context, params.actorId);
		if (!kind) {
			console.warn(`actor:delete - actor not found: ${params.actorId}`);
			return;
		}

		if (kind === "character") {
			const campaign = CampaignUtils.getActiveCampaign(context);
			const isSpawned = campaign.GameState.Characters.some(
				(c) => c.Id === params.actorId
			);
			if (isSpawned) {
				console.warn(
					`Cannot delete spawned character: ${params.actorId}. Remove from field first.`
				);
				return;
			}
		}

		ActorUtils.deleteActor(kind, { actorId: params.actorId }, context);
	},

	/**
	 * Removes a spawned actor from the field. Resolves kind from the id and routes
	 * to the kind-specific despawn semantics — a Character returns to the roster
	 * (state preserved), an Entity instance is deleted. Callers never branch.
	 */
	remove(params: { actorId: string }, context: Context): void {
		const kind = ActorUtils.getActorKind(context, params.actorId);
		if (kind === "character") {
			CharacterActions.remove({ characterId: params.actorId }, context);
		} else if (kind === "entity") {
			EntityActions.remove({ entityId: params.actorId }, context);
		} else {
			console.warn(`actor:remove - actor not found: ${params.actorId}`);
		}
	},

	/**
	 * Bulk edit tags for multiple actors in roster/templates. Updates are grouped
	 * by resolved kind so a mixed batch is handled correctly (call sites are
	 * single-kind today).
	 */
	bulkEditTags(
		params: { updates: Array<{ actorId: string; tags: string[] }> },
		context: Context
	): void {
		const byKind: Record<"character" | "entity", Array<{ actorId: string; tags: string[] }>> = {
			character: [],
			entity: [],
		};
		for (const update of params.updates) {
			const kind = ActorUtils.getActorKind(context, update.actorId);
			if (!kind) {
				console.warn(`actor:bulkEditTags - actor not found: ${update.actorId}`);
				continue;
			}
			byKind[kind].push(update);
		}

		if (byKind.character.length) {
			ActorUtils.bulkEditTags("character", { updates: byKind.character }, context);
		}
		if (byKind.entity.length) {
			ActorUtils.bulkEditTags("entity", { updates: byKind.entity }, context);
		}
	},

	/**
	 * Transfers a stat amount from an actor to another actor or shared inventory
	 */
	transferStat(
		params: {
			sourceActorId: string;
			sourceStatId: string;
			targetId: string;
			targetStatId: string;
			amount: number;
		},
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Look up stat name from campaign templates
		const statTemplate = campaign.Settings.StatDefinitions.find(
			(d) => d.Id === params.sourceStatId
		);
		const statName = statTemplate?.Name ?? params.sourceStatId;

		// Resolve source
		const allActors = [
			...campaign.GameState.Characters,
			...campaign.GameState.Entities,
		];
		const sourceActor = allActors.find((a) => a.Id === params.sourceActorId);
		if (!sourceActor) return;

		const sourceStat = sourceActor.Stats.find((s) => s.Id === params.sourceStatId);
		if (!sourceStat) return;
		// Refuse transfers from unset stats -- the actor doesn't have this stat.
		if (sourceStat.Current === null) return;

		// Ensure source has enough points
		const availableAmount = Math.min(sourceStat.Current, params.amount);
		if (availableAmount <= 0) return;

		// Resolve target
		const targetActor = allActors.find((a) => a.Id === params.targetId);
		const targetSharedInv = campaign.Settings.SharedInventories?.find(
			(i) => i.Id === params.targetId
		);

		let targetName = "Unknown";
		let transferSuccess = false;

		if (targetActor) {
			targetName = targetActor.Name;
			const tStat = targetActor.Stats.find((s) => s.Id === params.targetStatId);
			// Refuse transfers into unset stats -- target doesn't have this stat.
			if (tStat && tStat.Current !== null) {
				tStat.Current = Math.min(tStat.Max, tStat.Current + availableAmount);
				transferSuccess = true;
			}
		} else if (targetSharedInv) {
			targetName = targetSharedInv.Name;
			const tStat = targetSharedInv.Stats.find((s) => s.Id === params.targetStatId);
			if (tStat && tStat.Current !== null) {
				tStat.Current = Math.min(tStat.Max, tStat.Current + availableAmount);
				transferSuccess = true;
			}
		}

		if (transferSuccess) {
			// Deduct from source (sourceStat.Current guaranteed non-null above)
			sourceStat.Current = Math.max(0, sourceStat.Current - availableAmount);

			LogActions.create(
				{
					action: "Stat Transferred",
					details: `${availableAmount} ${statName} was transferred from ${sourceActor.Name} to ${targetName}.`,
					category: "character",
					level: "info",
					visibility: ["all"],
					actorId: params.sourceActorId,
				},
				context
			);
		}
	},
};
