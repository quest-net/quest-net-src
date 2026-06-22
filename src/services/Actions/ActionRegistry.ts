// services/ActionRegistry.ts

import { User } from "../../domains/User/User";
import { Context } from "../../domains/Context/Context";
import { toPlain } from "../../utils/toPlain";
import { CharacterActions } from "../../domains/Character/CharacterActions";
import { CampaignSettingActions } from "../../domains/CampaignSetting/CampaignSettingActions";
import { LogActions } from "../../domains/Log/LogActions";
import { ImageActions } from "../../domains/Image/ImageActions";
import { VoxelTerrainActions } from "../../domains/VoxelTerrain/VoxelTerrainActions";
import { ItemActions } from "../../domains/Item/ItemActions";
import { EntityActions } from "../../domains/Entity/EntityActions";
import { CalendarActions } from "../../domains/Calendar/CalendarActions";
import { AudioActions } from "../../domains/Audio/AudioActions";
import { SkillActions } from "../../domains/Skill/SkillActions";
import { SceneActions } from "../../domains/Scene/SceneActions";
import { NoteActions } from "../../domains/Note/NoteActions";
import { CombatActions } from "../../domains/Combat/CombatActions";
import { StatusActions } from "../../domains/Status/StatusActions";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { ScenarioActions } from "../../domains/Scenario/ScenarioActions";
import { SharedInventoryActions } from "../../domains/SharedInventory/SharedInventoryActions";
import { ActorActions } from "../../domains/Actor/ActorActions";
import { DiceActions } from "../../domains/Dice/DiceActions";
import { PingActions } from "../../domains/Ping/PingActions";
import { StickerActions } from "../../domains/Sticker/StickerActions";
import { TerrainLinkActions } from "../../domains/TerrainLink/TerrainLinkActions";
// import { ItemActions } from '../domains/Item/ItemActions';
// import { SkillActions } from '../domains/Skill/SkillActions';
// import { CombatActions } from '../domains/Combat/CombatActions';
// etc.

export type Role = "dm" | "player";
type ActionHandler = (params: any, context: Context) => void | Promise<void>;

interface ActionDefinition {
	roles: Role[];
	handler: ActionHandler;
	/**
	 * Whether a script may invoke this action via the host facade
	 * (`game.action(key, params)`). Only `true` means scriptable; missing/false
	 * actions are blocked regardless of whether their handlers are sync or async.
	 */
	scriptable: boolean;
}

/**
 * Single registry for all actions
 * Maps action keys to their allowed roles AND handler functions
 */
export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
	// ============================================================================
	// CAMPAIGN ACTIONS
	// ============================================================================
	"campaign:edit": {
		roles: ["dm"],
		handler: CampaignActions.edit,
		scriptable: false, // structural whole-campaign replace; not for scripts
	},
	// ============================================================================
	// CHARACTER ACTIONS
	// ============================================================================
	"character:create": {
		roles: ["dm", "player"],
		handler: CharacterActions.create,
		scriptable: true,
	},
	"character:spawn": {
		roles: ["dm"],
		handler: CharacterActions.spawn,
		scriptable: true,
	},
	"character:createAndSpawn": {
		roles: ["dm", "player"],
		handler: CharacterActions.createAndSpawn,
		scriptable: true,
	},
	// ============================================================================
	// ACTOR ACTIONS (unified surface for Characters and Entities)
	// ============================================================================
	"actor:move": {
		roles: ["dm", "player"], // Player control gated in handler (own character only)
		handler: ActorActions.move,
		scriptable: true,
	},
	"actor:spawn": {
		roles: ["dm"], // Resolves kind internally: character -> move from roster, entity -> clone from template
		handler: ActorActions.spawn,
		scriptable: true,
	},
	"actor:despawn": {
		roles: ["dm"], // Resolves kind internally: character -> roster, entity -> delete
		handler: ActorActions.despawn,
		scriptable: true,
	},
	"actor:edit": {
		roles: ["dm", "player"], // Players may edit characters, not entities (in handler)
		handler: ActorActions.edit,
		scriptable: true,
	},
	"actor:delete": {
		roles: ["dm"],
		handler: ActorActions.delete,
		scriptable: false,
	},
	"actor:bulkEditTags": {
		roles: ["dm"],
		handler: ActorActions.bulkEditTags,
		scriptable: true,
	},
	"actor:bulkDelete": {
		roles: ["dm"],
		handler: ActorActions.bulkDelete,
		scriptable: false,
	},
	"actor:transferStat": {
		roles: ["dm", "player"],
		handler: ActorActions.transferStat,
		scriptable: true,
	},

	// ============================================================================
	// DICE ACTIONS
	// ============================================================================
	"dice:roll": {
		// Observable-roll cascade carrier; the facade's actor.roll dispatches it.
		roles: ["dm", "player"],
		handler: DiceActions.roll,
		scriptable: true,
	},

	// ============================================================================
	// ITEM ACTIONS
	// ============================================================================
	"item:use": {
		roles: ["dm", "player"],
		handler: ItemActions.use,
		scriptable: true,
	},
	"item:equip": {
		roles: ["dm", "player"],
		handler: ItemActions.equip,
		scriptable: true,
	},
	"item:unequip": {
		roles: ["dm", "player"],
		handler: ItemActions.unequip,
		scriptable: true,
	},
	"item:discard": {
		roles: ["dm", "player"],
		handler: ItemActions.discard,
		scriptable: true,
	},
	"item:give": {
		roles: ["dm"],
		handler: ItemActions.give,
		scriptable: true,
	},
	"item:transfer": {
		roles: ["dm", "player"],
		handler: ItemActions.transfer,
		scriptable: true,
	},
	"item:create": {
		roles: ["dm"],
		handler: ItemActions.create,
		scriptable: true,
	},
	"item:edit": {
		roles: ["dm", "player"], //players can upload their own images
		handler: ItemActions.edit,
		scriptable: true,
	},
	"item:delete": {
		roles: ["dm"],
		handler: ItemActions.delete,
		scriptable: false,
	},
	"item:adjustUses": {
		roles: ["dm", "player"],
		handler: ItemActions.adjustUses,
		scriptable: true,
	},
	"item:drop": {
		roles: ["dm", "player"],
		handler: ItemActions.drop,
		scriptable: true,
	},
	"item:pickup": {
		roles: ["dm", "player"],
		handler: ItemActions.pickup,
		scriptable: true,
	},
	"item:spawn": {
		roles: ["dm"],
		handler: ItemActions.spawn,
		scriptable: true,
	},
	"item:bulkEditTags": {
		roles: ["dm"],
		handler: ItemActions.bulkEditTags,
		scriptable: true,
	},
	"item:bulkDelete": {
		roles: ["dm"],
		handler: ItemActions.bulkDelete,
		scriptable: false,
	},

	// ============================================================================
	// SHARED INVENTORY ACTIONS
	// ============================================================================
	"sharedInventory:transferItem": {
		roles: ["dm", "player"],
		handler: SharedInventoryActions.transferItem,
		scriptable: true,
	},
	"sharedInventory:discardItem": {
		roles: ["dm", "player"],
		handler: SharedInventoryActions.discardItem,
		scriptable: true,
	},
	"sharedInventory:transferStat": {
		roles: ["dm", "player"],
		handler: SharedInventoryActions.transferStat,
		scriptable: true,
	},
	"sharedInventory:editStat": {
		roles: ["dm", "player"],
		handler: SharedInventoryActions.editStat,
		scriptable: true,
	},

	// ============================================================================
	// SKILL ACTIONS
	"skill:create": {
		roles: ["dm"],
		handler: SkillActions.create,
		scriptable: true,
	},
	"skill:edit": {
		roles: ["dm", "player"], //players can upload their own images
		handler: SkillActions.edit,
		scriptable: true,
	},
	"skill:delete": {
		roles: ["dm"],
		handler: SkillActions.delete,
		scriptable: false,
	},
	"skill:use": {
		roles: ["dm", "player"],
		handler: SkillActions.use,
		scriptable: true,
	},
	"skill:discard": {
		roles: ["dm", "player"],
		handler: SkillActions.discard,
		scriptable: true,
	},
	"skill:give": {
		roles: ["dm"],
		handler: SkillActions.give,
		scriptable: true,
	},
	"skill:bulkEditTags": {
		roles: ["dm"],
		handler: SkillActions.bulkEditTags,
		scriptable: true,
	},
	"skill:bulkDelete": {
		roles: ["dm"],
		handler: SkillActions.bulkDelete,
		scriptable: false,
	},
	"skill:adjustUses": {
		roles: ["dm", "player"],
		handler: SkillActions.adjustUses,
		scriptable: true,
	},

	//   ============================================================================
	//   ENTITY ACTIONS (uncomment when EntityActions is implemented)
	//   ============================================================================
	"entity:create": {
		roles: ["dm"],
		handler: EntityActions.create,
		scriptable: true,
	},
	"entity:spawn": {
		roles: ["dm"],
		handler: EntityActions.spawn,
		scriptable: true,
	},
	// ============================================================================
	// COMBAT ACTIONS (uncomment when CombatActions is implemented)
	// ============================================================================
	"combat:start": {
		roles: ["dm"],
		handler: CombatActions.start,
		scriptable: true,
	},
	"combat:end": {
		roles: ["dm"],
		handler: CombatActions.end,
		scriptable: true,
	},
	"combat:incrementRound": {
		roles: ["dm"],
		handler: CombatActions.incrementRound,
		scriptable: true,
	},
	"combat:decrementRound": {
		roles: ["dm"],
		handler: CombatActions.decrementRound,
		scriptable: true,
	},
	"combat:markActorTurnDone": {
		// Both roles allowed: UI restricts players to their own selected character.
		// The handler itself is non-destructive (toggles a string-array entry).
		roles: ["dm", "player"],
		handler: CombatActions.markActorTurnDone,
		scriptable: true,
	},

	// ============================================================================
	// AUDIO ACTIONS (uncomment when AudioActions is implemented)
	// ============================================================================
	"audio:create": {
		roles: ["dm"],
		handler: AudioActions.create,
		scriptable: false,
	},
	"audio:importPlaylistByIds": {
		roles: ["dm"],
		handler: AudioActions.importPlaylistByIds,
		scriptable: false,
	},
	"audio:edit": {
		roles: ["dm"],
		handler: AudioActions.edit,
		scriptable: true,
	},
	"audio:delete": {
		roles: ["dm"],
		handler: AudioActions.delete,
		scriptable: false,
	},
	"audio:setTrack": {
		roles: ["dm"],
		handler: AudioActions.setTrack,
		scriptable: true,
	},
	"audio:setVolume": {
		roles: ["dm"],
		handler: AudioActions.setVolume,
		scriptable: true,
	},
	"audio:stopTrack": {
		roles: ["dm"],
		handler: AudioActions.stopTrack,
		scriptable: true,
	},
	"audio:bulkEditTags": {
		roles: ["dm"],
		handler: AudioActions.bulkEditTags,
		scriptable: true,
	},
	// ============================================================================
	// IMAGE/SCENE ACTIONS
	// ============================================================================
	"scene:setEnvironmentImage": {
		roles: ["dm"],
		handler: SceneActions.setEnvironmentImage,
		scriptable: true,
	},
	"scene:setFocusImage": {
		roles: ["dm"],
		handler: SceneActions.setFocusImage,
		scriptable: true,
	},
	"image:create": {
		roles: ["dm", "player"],
		handler: ImageActions.create,
		scriptable: true,
	},
	"image:bulkCreate": {
		roles: ["dm", "player"],
		handler: ImageActions.bulkCreate,
		scriptable: true,
	},
	"image:edit": {
		roles: ["dm"],
		handler: ImageActions.edit,
		scriptable: true,
	},
	"image:delete": {
		roles: ["dm"],
		handler: ImageActions.delete,
		scriptable: false,
	},
	"image:bulkEditTags": {
		roles: ["dm"],
		handler: ImageActions.bulkEditTags,
		scriptable: true,
	},
	"image:bulkDelete": {
		roles: ["dm"],
		handler: ImageActions.bulkDelete,
		scriptable: false,
	},
	"image:reassignOwner": {
		roles: ["dm"],
		handler: ImageActions.reassignOwner,
		scriptable: true,
	},

	// ============================================================================
	// STATUS EFFECT ACTIONS (uncomment when StatusActions is implemented)
	// ============================================================================
	"status:give": {
		roles: ["dm"],
		handler: StatusActions.give,
		scriptable: true,
	},
	"status:remove": {
		roles: ["dm"],
		handler: StatusActions.remove,
		scriptable: true,
	},
	"status:create": {
		roles: ["dm"],
		handler: StatusActions.create,
		scriptable: true,
	},
	"status:edit": {
		roles: ["dm", "player"],
		handler: StatusActions.edit,
		scriptable: true,
	},
	"status:delete": {
		roles: ["dm"],
		handler: StatusActions.delete,
		scriptable: false,
	},
	"status:adjustDuration": {
		roles: ["dm", "player"],
		handler: StatusActions.adjustDuration,
		scriptable: true,
	},
	"status:bulkEditTags": {
		roles: ["dm"],
		handler: StatusActions.bulkEditTags,
		scriptable: true,
	},
	"status:bulkDelete": {
		roles: ["dm"],
		handler: StatusActions.bulkDelete,
		scriptable: false,
	},
	// ============================================================================
	// LOG ACTIONS
	// ============================================================================
	"log:create": {
		roles: ["dm", "player"],
		handler: LogActions.create,
		scriptable: true,
	},
	"log:log": {
		roles: ["dm", "player"],
		handler: LogActions.log,
		scriptable: true,
	},
	// ============================================================================
	// PING ACTIONS
	// ============================================================================
	"ping:create": {
		roles: ["dm", "player"],
		handler: PingActions.create,
		scriptable: true,
	},
	// ============================================================================
	// STICKER ACTIONS
	// ============================================================================
	"sticker:create": {
		roles: ["dm", "player"],
		handler: StickerActions.create,
		scriptable: true,
	},
	// NOTE ACTIONS
	"note:create": {
		roles: ["player"],
		handler: NoteActions.create,
		scriptable: true,
	},
	"note:edit": {
		roles: ["player"],
		handler: NoteActions.edit,
		scriptable: true,
	},
	"note:delete": {
		roles: ["player"],
		handler: NoteActions.delete,
		scriptable: false,
	},
	// ============================================================================
	// CAMPAIGN SETTING ACTIONS
	// ============================================================================
	"setting:edit": {
		roles: ["dm"],
		handler: CampaignSettingActions.edit,
		scriptable: true,
	},

	// ============================================================================
	// CALENDAR ACTIONS
	// ============================================================================
	"calendar:edit": {
		roles: ["dm"],
		handler: CalendarActions.edit,
		scriptable: true,
	},
	"calendar:shortRest": {
		roles: ["dm"],
		handler: CalendarActions.shortRest,
		scriptable: true,
	},
	"calendar:longRest": {
		roles: ["dm"],
		handler: CalendarActions.longRest,
		scriptable: true,
	},
	// ============================================================================
	//TERRAIN ACTIONS
	// ============================================================================

	"terrain:create": {
		roles: ["dm"],
		handler: VoxelTerrainActions.create,
		scriptable: false,
	},
	"terrain:edit": {
		roles: ["dm"],
		handler: VoxelTerrainActions.edit,
		scriptable: true,
	},
	"terrain:delete": {
		roles: ["dm"],
		handler: VoxelTerrainActions.delete,
		scriptable: false,
	},
	"terrain:moveActors": {
		roles: ["dm"],
		handler: VoxelTerrainActions.moveActors,
		scriptable: true,
	},
	"terrain:bulkEditTags": {
		roles: ["dm"],
		handler: VoxelTerrainActions.bulkEditTags,
		scriptable: true,
	},

	// ============================================================================
	// TERRAIN LINK ACTIONS
	// ============================================================================
	"terrainLink:create": {
		roles: ["dm"],
		handler: TerrainLinkActions.create,
		scriptable: true,
	},
	"terrainLink:edit": {
		roles: ["dm"],
		handler: TerrainLinkActions.edit,
		scriptable: true,
	},
	"terrainLink:delete": {
		roles: ["dm"],
		handler: TerrainLinkActions.delete,
		scriptable: false,
	},

	// ============================================================================
	// SCENARIO ACTIONS
	// ============================================================================
	"scenario:capture": {
		roles: ["dm"],
		handler: ScenarioActions.capture,
		scriptable: true,
	},
	"scenario:load": {
		roles: ["dm"],
		handler: ScenarioActions.load,
		scriptable: true,
	},
	"scenario:delete": {
		roles: ["dm"],
		handler: ScenarioActions.delete,
		scriptable: false,
	},
	"scenario:edit": {
		roles: ["dm"],
		handler: ScenarioActions.edit,
		scriptable: true,
	},
	"scenario:bulkEditTags": {
		roles: ["dm"],
		handler: ScenarioActions.bulkEditTags,
		scriptable: true,
	},
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalizes action params to a fresh, mutable, plain object before they enter
 * a registry handler. Call this at every site that invokes `action.handler`.
 *
 * WHY: a handler may `Object.assign`/`push` a param object straight into the
 * Valtio store proxy. If that object is a slice of a frozen useQuestContext()
 * snapshot (e.g. an edit form's untouched nested field) or a live proxy (a
 * script passing data read from the campaign), it must not land in the store
 * as-is: Valtio neither proxies nor unfreezes a frozen object, so a later
 * mutation throws "Cannot assign to read only property". `toPlain` unwraps any
 * proxy (structuredClone throws on a Proxy); structuredClone then yields an
 * unfrozen, independent deep copy. The player request path gets this guarantee
 * for free via its JSON round-trip over Trystero — this gives the DM-local and
 * script-cascade paths the same property.
 */
export function normalizeActionParams<T>(params: T): T {
	return structuredClone(toPlain(params));
}

/**
 * Checks if a user can perform a given action
 */
export function canPerformAction(user: User, actionKey: string): boolean {
	if (user.Role == null) {
		return false;
	}

	const action = ACTION_REGISTRY[actionKey];
	return action ? action.roles.includes(user.Role) : false;
}

/**
 * Whether an action may be invoked from a script (via `game.action`).
 *
 * The registry flag is the sole authority: only `scriptable: true` is callable.
 * Handler sync/async shape is deliberately irrelevant because the scripting
 * engine awaits every action through one async path.
 */
export function isScriptableAction(actionKey: string): boolean {
	const action = ACTION_REGISTRY[actionKey];
	return action?.scriptable === true;
}

/**
 * Gets all action keys for a specific role
 */
export function getActionsForRole(role: Role): string[] {
	return Object.entries(ACTION_REGISTRY)
		.filter(([_, action]) => action.roles.includes(role))
		.map(([key, _]) => key);
}
