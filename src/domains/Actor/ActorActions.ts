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
 * (move, edit, delete, bulkEditTags, spawn, despawn): each resolves the actor's
 * kind from its id via `ActorUtils.getActorKind` and either runs kind-agnostic
 * logic or routes to the kind-specific handler. Callers never branch on kind.
 *
 * `spawn` and `despawn` keep the genuinely-different semantics in
 * CharacterActions/EntityActions (a Character MOVEs between roster and field; an
 * Entity is CLONEd from a template on spawn and deleted on despawn) but hide that
 * split behind the unified action. `getActorKind` resolves both active ids and
 * roster/template ids, so a script can call `actor:spawn`/`actor:despawn` with a
 * single id and never know the kind. `create`/`createAndSpawn` stay kind-specific
 * because their call sites are inherently single-kind (and not script-reachable).
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
		// A player may only move their own selected Character (playerMayTarget also
		// blocks entities). This gates the player's optimistic pass; the DM re-checks
		// the same rule authoritatively before applying a player request.
		// Movement-range restriction stays entirely client-side (world view blocks
		// out-of-range clicks; first-person applies a soft pull-back) — the DM trusts
		// the requested position rather than re-validating range here.
		if (!ActorUtils.playerMayTarget(context.User, "actor:move", params, context)) {
			console.warn(
				`Player ${context.User.Id} cannot move actor: ${params.actorId}`
			);
			return;
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
		// A player may only edit their own selected Character (playerMayTarget also
		// blocks entities). The only UI path to the sheet is the player's own
		// selected character; indirect cross-actor effects ride on other actions
		// (item:transfer, actor:transferStat), not actor:edit.
		if (!ActorUtils.playerMayTarget(context.User, "actor:edit", params, context)) {
			console.warn(
				`Player ${context.User.Id} cannot edit actor: ${params.actorId}`
			);
			return;
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
	 * Spawns an actor onto the field from its roster/template. Resolves kind from
	 * the id and routes to the kind-specific spawn semantics — a Character MOVEs
	 * out of the roster (preserving its persistent state), an Entity is CLONEd from
	 * its template into a fresh instance. Callers never branch. Entity-only options
	 * (instanceId, repairActors) stay on EntityActions.spawn for its single-kind
	 * call sites (scenario load); the unified surface forwards only the common
	 * placement params.
	 */
	spawn(
		params: { actorId: string; terrainId?: string; position?: Position },
		context: Context
	): void {
		const kind = ActorUtils.getActorKind(context, params.actorId);
		if (kind === "character") {
			CharacterActions.spawn(
				{
					characterId: params.actorId,
					terrainId: params.terrainId,
					position: params.position,
				},
				context
			);
		} else if (kind === "entity") {
			EntityActions.spawn(
				{
					entityId: params.actorId,
					terrainId: params.terrainId,
					position: params.position,
				},
				context
			);
		} else {
			console.warn(`actor:spawn - actor not found: ${params.actorId}`);
		}
	},

	/**
	 * Removes a spawned actor from the field. Resolves kind from the id and routes
	 * to the kind-specific despawn semantics — a Character returns to the roster
	 * (state preserved), an Entity instance is deleted. Callers never branch.
	 */
	despawn(params: { actorId: string }, context: Context): void {
		const kind = ActorUtils.getActorKind(context, params.actorId);
		if (kind === "character") {
			CharacterActions.remove({ characterId: params.actorId }, context);
		} else if (kind === "entity") {
			EntityActions.remove({ entityId: params.actorId }, context);
		} else {
			console.warn(`actor:despawn - actor not found: ${params.actorId}`);
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
		const allActors = ActorUtils.getActiveActors(campaign);
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
				tStat.Current = ActorUtils.clampStat(tStat.Current + availableAmount, tStat.Max);
				transferSuccess = true;
			}
		} else if (targetSharedInv) {
			targetName = targetSharedInv.Name;
			const tStat = targetSharedInv.Stats.find((s) => s.Id === params.targetStatId);
			if (tStat && tStat.Current !== null) {
				tStat.Current = ActorUtils.clampStat(tStat.Current + availableAmount, tStat.Max);
				transferSuccess = true;
			}
		}

		if (transferSuccess) {
			// Deduct from source (sourceStat.Current guaranteed non-null above)
			sourceStat.Current = ActorUtils.clampStat(sourceStat.Current - availableAmount, sourceStat.Max);

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
