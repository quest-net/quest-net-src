import { CampaignUtils } from "../Campaign/CampaignUtils";
import { Context } from "../Context/Context";
import { LogActions } from "../Log/LogActions";
import { VoxelTerrainUtils } from "../VoxelTerrain/VoxelTerrainUtils";
import { getVoxelTerrainById, roundVoxelPosition } from "../VoxelTerrain/VoxelTerrainQueries";
import { calculateVoxelMovementRange } from "../VoxelTerrain/VoxelMovementUtilities";
import { tileHeightKey } from "../../utils/terrain/data/VoxelTerrainIndex";
import { resolveByNameOrId } from "../../utils/resolveByNameOrId";
import type { Campaign } from "../Campaign/Campaign";
import { Actor, Position, StatSlot, ActionSlot, AttributeSlot } from "./Actor";
import type {
	StatDefinition,
	ActionDefinition,
	AttributeDefinition,
} from "../CampaignSetting/CampaignSetting";
import type {
	ActionCost,
	CampaignSettings,
	StatCost,
} from "../CampaignSetting/CampaignSetting";
import type { User } from "../User/User";

export const ActorUtils = {
	/**
	 * Whether `user` is allowed to target the actor named in `params` with
	 * `actionKey`. The DM (and any non-player) is unrestricted. A player is gated
	 * only on the shared `actor:*` surface — the one player-allowed path that can
	 * carry an arbitrary actor id: they may act only on their own selected
	 * Character. Since that selection always points at a Character they own, this
	 * also blocks entities without resolving the actor's kind.
	 *
	 * This is the single home for the ownership rule. It runs in two places: the
	 * player's optimistic pass (called with `context.User`, the player) and the
	 * DM's authoritative re-check before applying a player request (called with the
	 * requesting player). On the DM's own dispatch it is a no-op (DM is unrestricted).
	 */
	playerMayTarget(
		user: User,
		actionKey: string | undefined,
		params: { actorId?: string },
		context: Context
	): boolean {
		if (user.Role !== "player") return true;
		if (actionKey === "actor:move" || actionKey === "actor:edit") {
			const campaign = CampaignUtils.getActiveCampaign(context);
			return user.SelectedCharacters?.[campaign.RoomCode] === params.actorId;
		}
		return true;
	},

	isValidPosition(position: Position): boolean {
		return (
			Number.isFinite(position.x) &&
			Number.isFinite(position.y) &&
			Number.isFinite(position.h)
		);
	},

	/**
	 * Resolves whether an actor id belongs to a Character or an Entity by where it
	 * lives. Storage location is the single source of truth (there is no Kind field
	 * on the Actor model). IDs are unique GUIDs across every collection, so an
	 * entity instance and its template both independently resolve to "entity".
	 */
	getActorKind(
		context: Context,
		actorId: string
	): "character" | "entity" | undefined {
		const campaign = CampaignUtils.getActiveCampaign(context);
		if (
			campaign.GameState.Characters.some((a) => a.Id === actorId) ||
			campaign.CharacterRoster.some((a) => a.Id === actorId)
		) {
			return "character";
		}
		if (
			campaign.GameState.Entities.some((a) => a.Id === actorId) ||
			campaign.EntityTemplates.some((a) => a.Id === actorId)
		) {
			return "entity";
		}
		return undefined;
	},

	// ---- Scripting-API tier-1 reads (pure, no dispatch) --------------------
	// These back the actor facade (`this.actor.*`). Refs are name-OR-id, resolved
	// through the shared resolver. Reads return live data; they never clone.

	/**
	 * Every ACTIVE actor (spawned characters + entities). The single shared
	 * definition of "active actors" used by the scripting facades and the engine.
	 * NOT `getAllActors` — that also includes the roster/templates, which a script
	 * must never resolve onto (it could otherwise mutate a template).
	 */
	getActiveActors(campaign: Campaign): Actor[] {
		return [...campaign.GameState.Characters, ...campaign.GameState.Entities];
	},

	/**
	 * Resolves an ActorRef (a held actor/facade object with `.Id`, or a name|id
	 * string) to the Id of an ACTIVE actor (spawned characters + entities). Used by
	 * every facade that mutates an actor. Returns undefined when nothing resolves.
	 *
	 * Resolution order: an object ref reads `.Id` directly (then confirms it is
	 * active); a string ref runs through `resolveByNameOrId` over active actors
	 * (Id -> Name -> first glob match -> undefined).
	 */
	resolveActorId(
		campaign: Campaign,
		ref: string | { Id: string }
	): string | undefined {
		const active = ActorUtils.getActiveActors(campaign);
		if (ref != null && typeof ref === "object") {
			// A held actor/facade: trust its Id only if it's still on the field.
			return active.some((a) => a.Id === ref.Id) ? ref.Id : undefined;
		}
		return resolveByNameOrId(active, ref)?.Id;
	},

	/**
	 * Resolve an ActorRef to the LIVE active actor OBJECT (not just its Id), or
	 * undefined. The object-returning companion to `resolveActorId`, for reads that
	 * need the actor's fields/Position/slots. The single shared resolver every
	 * scripting facade calls — replaces the per-facade `resolveActiveActor` copies.
	 */
	resolveActiveActor(
		campaign: Campaign,
		ref: string | { Id: string }
	): Actor | undefined {
		const id = ActorUtils.resolveActorId(campaign, ref);
		if (!id) return undefined;
		return ActorUtils.getActiveActors(campaign).find((a) => a.Id === id);
	},

	/**
	 * Clamp a stat value to its slot's valid range `0..Max`. The single shared rule
	 * every stat write uses (changeStat / setStat / transferStat / applyStatCost /
	 * regen) so stat clamping stays consistent across the board.
	 */
	clampStat(value: number, max: number): number {
		return Math.max(0, Math.min(max, value));
	},

	/**
	 * THE one shared stat resolver: resolves a stat NAME or definition Id to the
	 * matching StatSlot on `actor`. The ref resolves over the campaign's
	 * StatDefinitions (name|id -> definition Id), then the actor's slot whose `Id`
	 * equals that definition Id is returned. Everything stat-related routes here.
	 * Returns undefined when the definition or the actor's slot is absent.
	 */
	getStat(
		actor: Actor,
		campaign: Campaign,
		statRef: string
	): StatSlot | undefined {
		const def = resolveByNameOrId(campaign.Settings.StatDefinitions, statRef);
		if (!def) return undefined;
		return actor.Stats?.find((s) => s.Id === def.Id);
	},

	/**
	 * Current value of a stat (name|id), or `null` when the actor doesn't have the
	 * stat — either the slot is absent OR its Current is null (the "unset" state in
	 * the StatSlot model). `null` = "not present on the actor".
	 */
	getStatValue(actor: Actor, campaign: Campaign, statRef: string): number | null {
		const slot = ActorUtils.getStat(actor, campaign, statRef);
		if (!slot || slot.Current === null) return null;
		return slot.Current;
	},

	/**
	 * Max for a stat (name|id), or `undefined` when the actor has no slot for it.
	 * (Max is always a number on a present slot, retained even while the stat is
	 * unset, so absence is the only `undefined` case.)
	 */
	getStatMax(actor: Actor, campaign: Campaign, statRef: string): number | undefined {
		const slot = ActorUtils.getStat(actor, campaign, statRef);
		return slot ? slot.Max : undefined;
	},

	/** Whether the actor has the stat set (slot present AND Current !== null). */
	hasStat(actor: Actor, campaign: Campaign, statRef: string): boolean {
		const slot = ActorUtils.getStat(actor, campaign, statRef);
		return !!slot && slot.Current !== null;
	},

	/**
	 * Value of an attribute (name|id), or `undefined` when the actor has no slot
	 * for it. Resolves the AttributeDefinition then reads the actor's AttributeSlot
	 * Value (always a string in the model).
	 */
	getAttribute(actor: Actor, campaign: Campaign, attrRef: string): string | undefined {
		const def = resolveByNameOrId(campaign.Settings.AttributeDefinitions, attrRef);
		if (!def) return undefined;
		return actor.Attributes?.find((a) => a.Id === def.Id)?.Value;
	},

	/**
	 * Movement distance from actor `a` to actor `b`: the cheapest in-game movement
	 * cost for `a` to reach `b`'s tile, using the SAME Dijkstra pathing the movement
	 * range highlight uses (`calculateVoxelMovementRange`) — cardinal steps, height
	 * costs, and `a`'s own walker/flyer profile. NOT straight-line distance: a
	 * diagonal neighbour is 2, a tile up a cliff costs its height penalty, etc.
	 *
	 * `Infinity` when either lacks a Position, they are on different terrains, the
	 * terrain is missing, or `b`'s tile is unreachable for `a`. Asymmetric by design
	 * (climbing costs, flyer vs walker), so `distanceTo(a,b)` may differ from
	 * `distanceTo(b,a)`. NOTE: floods the full reachable surface (unbounded budget),
	 * so it is a heavier read than a coordinate subtraction — fine for occasional
	 * script use; avoid in tight per-tile loops on huge terrains.
	 */
	distanceTo(a: Actor, b: Actor, campaign: Campaign): number {
		if (!a?.Position || !b?.Position) return Infinity;
		if (a.Position.terrainId !== b.Position.terrainId) return Infinity;
		const terrain = getVoxelTerrainById(campaign, a.Position.terrainId);
		if (!terrain) return Infinity;
		const target = roundVoxelPosition(b.Position);
		// Unbounded flood (a huge budget never trips the cost cutoff) so the cost
		// map covers every standable tile; read the accumulated cost at b's tile.
		const { costs } = calculateVoxelMovementRange(
			terrain,
			a.Position,
			Number.MAX_SAFE_INTEGER,
			a.CanFly ?? false,
			campaign.Settings.MovementSettings
		);
		return costs.get(tileHeightKey(target.x, target.y, target.h)) ?? Infinity;
	},

	/**
	 * Whether `a` can reach `b` in a single step of movement — `distanceTo(a,b) <= 1`,
	 * i.e. a same-height cardinal neighbour (or the same tile). Uses the movement
	 * model, so diagonals and tiles that require a height-cost step are NOT adjacent.
	 */
	isAdjacentTo(a: Actor, b: Actor, campaign: Campaign): boolean {
		return ActorUtils.distanceTo(a, b, campaign) <= 1;
	},

	/**
	 * Value of a `"prefix:value"` tag from the actor's Tags, e.g.
	 * getTagValue(actor, "level") -> "7" for the tag "level:7" (caller does
	 * Number()); `undefined` when no such tag exists. The first matching tag wins.
	 * Only the first colon splits prefix from value, so a value may itself contain
	 * colons (e.g. "url:http://..."). (FolderUtils only parses the `path:` tag for
	 * its folder tree; this is the generic single-tag-value read it lacked.)
	 */
	getTagValue(actor: Actor, prefix: string): string | undefined {
		const head = prefix + ":";
		const tag = actor.Tags?.find((t) => t.startsWith(head));
		return tag === undefined ? undefined : tag.slice(head.length);
	},

	/**
	 * Moves an actor to a new position. Movement is identical for Characters and
	 * Entities, so this resolves the actor by id across both active collections —
	 * no kind needed. (Only spawned actors can move; the roster/templates are not
	 * searched.)
	 */
	moveActor(
		params: { actorId: string; position: Position },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const actor =
			campaign.GameState.Characters.find((a) => a.Id === params.actorId) ??
			campaign.GameState.Entities.find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found in GameState: ${params.actorId}`);
			return;
		}

		if (!ActorUtils.isValidPosition(params.position)) {
			console.warn(`Invalid actor move position: ${params.actorId}`);
			return;
		}

		// Per-move terrain validation is intentionally NOT run here. The client UI
		// derives legal positions from the shared voxel movement model, so the DM
		// trusts the requested position rather than snapping/rejecting it against
		// terrain -- that re-validation was the source of the jarring rubber-band
		// when a player moved onto a visually-valid tile. Gameplay range limits
		// are intentionally UI-only. Terrain validity is reconciled by
		// VoxelTerrainUtils.repairActors on terrain changes, CanFly toggles,
		// scenario loads, and similar layout-changing actions.
		const oldPosition = { ...actor.Position };
		const nextPosition = {
			terrainId: params.position.terrainId ?? actor.Position.terrainId,
			x: Math.round(params.position.x),
			y: Math.round(params.position.y),
			h: Math.round(params.position.h),
		};
		actor.Position = nextPosition;

		// A move that crosses terrains (e.g. traversing a terrain link) re-anchors
		// the combat movement budget to the destination, so remaining-range pathing
		// runs within the new terrain rather than pointing back into the old one.
		// Ordinary intra-terrain moves leave TurnStartPosition untouched, exactly as
		// before.
		if (
			nextPosition.terrainId !== oldPosition.terrainId &&
			campaign.GameState.CombatState?.isActive &&
			actor.TurnStartPosition
		) {
			actor.TurnStartPosition = { ...nextPosition };
		}

		LogActions.create(
			{
				action: "Actor moved",
				details: `${actor.Name} moved from (${oldPosition.x}, ${oldPosition.y}, h=${oldPosition.h}) to (${nextPosition.x}, ${nextPosition.y}, h=${nextPosition.h})`,
				category: "movement",
				level: "verbose",
				visibility: ["all"],
				actorId: params.actorId,
			},
			context
		);

	},

	/**
	 * Edits an actor's properties. Editing is identical for Characters and
	 * Entities, so this resolves the actor by id across every collection (roster,
	 * templates, and GameState) — no kind needed. IDs are unique, so a template
	 * and its spawned instances are distinct objects matched independently.
	 */
	editActor(
		params: { actorId: string; updates: Partial<Actor> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const actor = getAllActors(campaign).find((a) => a.Id === params.actorId);
		if (!actor) {
			console.warn(`Actor not found: ${params.actorId}`);
			return;
		}

		const isSpawnedActor =
			campaign.GameState.Characters.some((a) => a.Id === params.actorId) ||
			campaign.GameState.Entities.some((a) => a.Id === params.actorId);

		const previousCanFly = actor.CanFly;

		Object.assign(actor, params.updates);

		if (
			isSpawnedActor &&
			"CanFly" in params.updates &&
			previousCanFly &&
			!actor.CanFly &&
			getVoxelTerrainById(campaign, actor.Position.terrainId)
		) {
			VoxelTerrainUtils.repairActors(context);
		}

		LogActions.create(
			{
				action: "Actor edited",
				details: `${actor.Name} was updated`,
				category: "character",
				level: "info",
				visibility: ["dm"],
				actorId: params.actorId,
			},
			context
		);
	},

	/**
	 * Deletes an actor from the roster/templates (NOT from GameState)
	 * To remove from GameState, use domain-specific remove actions
	 */
	deleteActor(
		type: "character" | "entity",
		params: { actorId: string },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const roster =
			type === "character"
				? campaign.CharacterRoster
				: campaign.EntityTemplates;

		const index = roster.findIndex((a) => a.Id === params.actorId);
		if (index === -1) {
			console.warn(
				`${type} not found in ${type === "character" ? "roster" : "templates"
				}: ${params.actorId}`
			);
			return;
		}

		const actor = roster[index];
		roster.splice(index, 1);

		LogActions.create(
			{
				action: `${type} deleted`,
				details: `${actor.Name} removed from ${type === "character" ? "roster" : "catalog"
					}`,
				category: "character",
				level: "important",
				visibility: ["dm"],
				actorId: params.actorId,
			},
			context
		);
	},
	/**
	 * Bulk deletes multiple actors from the roster/templates (NOT from GameState)
	 * Works for both Characters and Entities
	 */
	bulkDelete(
		type: "character" | "entity",
		params: { actorIds: string[] },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const roster =
			type === "character"
				? campaign.CharacterRoster
				: campaign.EntityTemplates;

		let count = 0;

		params.actorIds.forEach((actorId) => {
			const index = roster.findIndex((a) => a.Id === actorId);
			if (index !== -1) {
				roster.splice(index, 1);
				count++;
			} else {
				console.warn(`${type} not found for bulk delete: ${actorId}`);
			}
		});

		if (count === 0) return;

		LogActions.create(
			{
				action: "Actors deleted",
				details: `${count} ${type === "character" ? "character" : "entity"}(s) removed from ${type === "character" ? "roster" : "catalog"}`,
				category: type === "character" ? "character" : "combat",
				level: "important",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Bulk edit tags for multiple actors in roster/templates
	 * Works for both Characters and Entities
	 */
	bulkEditTags(
		type: "character" | "entity",
		params: { updates: Array<{ actorId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const roster =
			type === "character"
				? campaign.CharacterRoster
				: campaign.EntityTemplates;

		let successCount = 0;

		params.updates.forEach((update) => {
			const actor = roster.find((a) => a.Id === update.actorId);
			if (actor) {
				actor.Tags = update.tags;
				successCount++;
			} else {
				console.warn(
					`${type} not found for bulk update: ${update.actorId}`
				);
			}
		});

		LogActions.create(
			{
				action: "Actors organized",
				details: `Updated tags for ${successCount} actor(s)`,
				category: type === "character" ? "character" : "combat",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},
};

// ---- Slot creation helpers ----

/**
 * Creates default StatSlots from campaign templates (for new actors).
 */
export function createDefaultStatSlots(templates: StatDefinition[]): StatSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Current: t.Max,
		Max: t.Max,
	}));
}

/**
 * Creates default ActionSlots from campaign templates (for new actors).
 */
export function createDefaultActionSlots(templates: ActionDefinition[]): ActionSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Max: t.Max,
		Current: t.Max,
	}));
}

/**
 * Creates default AttributeSlots from campaign templates (for new actors).
 */
export function createDefaultAttributeSlots(templates: AttributeDefinition[]): AttributeSlot[] {
	return templates.map((t) => ({
		Id: t.Id,
		Value: "",
	}));
}

/**
 * Gets all actors from campaign (both in GameState and collections)
 */
export function getAllActors(campaign: any): Actor[] {
	return [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
		...campaign.CharacterRoster,
		...campaign.EntityTemplates,
	];
}

export function applyStatCost(
	actor: Pick<Actor, "Stats">,
	cost: StatCost | undefined,
	settings: CampaignSettings
): string {
	if (!cost) return "";

	const stat = actor.Stats?.find((s) => s.Id === cost.statId);
	if (!stat || stat.Current === null) return "";

	const currentValue = stat.Current;
	const newValue = ActorUtils.clampStat(currentValue - cost.amount, stat.Max);
	stat.Current = newValue;

	const statDef = settings.StatDefinitions.find((s) => s.Id === stat.Id);
	const statName = statDef?.Name ?? stat.Id;

	return ` (-${Math.min(currentValue, cost.amount)} ${statName})`;
}

export function applyActionCost(
	actor: Pick<Actor, "Actions">,
	cost: ActionCost | undefined,
	settings: CampaignSettings
): string {
	if (!cost) return "";

	const action = actor.Actions?.find((a) => a.Id === cost.actionId);
	if (!action) return "";

	const currentValue = action.Current;
	const newValue = Math.max(0, currentValue - cost.amount);
	action.Current = newValue;

	const actionDef = settings.ActionDefinitions.find((a) => a.Id === action.Id);
	const actionName = actionDef?.Name ?? action.Id;

	return ` (-${Math.min(currentValue, cost.amount)} ${actionName})`;
}

/**
 * Human-readable suffix describing the chosen target of an item/skill use, for
 * the activity log. Returns "" when nothing was targeted. An actor target reads
 * the actor's name; a position target reads its tile coords and terrain name.
 */
export function describeUseTarget(
	campaign: any,
	target: { targetActorId?: string; targetPosition?: Position }
): string {
	if (target.targetActorId) {
		const actor = getAllActors(campaign).find(
			(a) => a.Id === target.targetActorId
		);
		return ` -> ${actor?.Name ?? "unknown target"}`;
	}
	if (target.targetPosition) {
		const { terrainId, x, y, h } = target.targetPosition;
		const terrain = campaign.VoxelTerrains?.find(
			(t: { Id: string }) => t.Id === terrainId
		);
		const terrainName = terrain?.Name ?? "terrain";
		return ` -> (${x}, ${y}, ${h}) on ${terrainName}`;
	}
	return "";
}
