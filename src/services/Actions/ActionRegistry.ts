// services/ActionRegistry.ts

import { User } from "../../domains/User/User";
import { Context } from "../../domains/Context/Context";
import { CharacterActions } from "../../domains/Character/CharacterActions";
import { CampaignSettingActions } from "../../domains/CampaignSetting/CampaignSettingActions";
import { LogActions } from "../../domains/Log/LogActions";
import { ImageActions } from "../../domains/Image/ImageActions";
import { TerrainActions } from "../../domains/Terrain/TerrainActions";
import { ItemActions } from "../../domains/Item/ItemActions";
import { EntityActions } from "../../domains/Entity/EntityActions";
import { CalendarActions } from "../../domains/Calendar/CalendarActions";
import { AudioActions } from "../../domains/Audio/AudioActions";
import { SkillActions } from "../../domains/Skill/SkillActions";
import { SceneActions } from "../../domains/Scene/SceneActions";
import { NoteActions } from "../../domains/Note/NoteActions";
// Import other action modules as they're created
// import { ItemActions } from '../domains/Item/ItemActions';
// import { SkillActions } from '../domains/Skill/SkillActions';
// import { CombatActions } from '../domains/Combat/CombatActions';
// etc.

export type Role = "dm" | "player";
type ActionHandler = (params: any, context: Context) => void;

interface ActionDefinition {
	roles: Role[];
	handler: ActionHandler;
}

/**
 * Single registry for all actions
 * Maps action keys to their allowed roles AND handler functions
 */
export const ACTION_REGISTRY: Record<string, ActionDefinition> = {
	// ============================================================================
	// CHARACTER ACTIONS
	// ============================================================================
	"character:create": {
		roles: ["dm", "player"],
		handler: CharacterActions.create,
	},
	"character:spawn": {
		roles: ["dm"],
		handler: CharacterActions.spawn,
	},
	"character:createAndSpawn": {
		roles: ["dm", "player"],
		handler: CharacterActions.createAndSpawn,
	},
	"character:remove": {
		roles: ["dm"],
		handler: CharacterActions.remove,
	},
	"character:edit": {
		roles: ["dm", "player"], // Players can update their own, validation in action
		handler: CharacterActions.edit,
	},
	"character:delete": {
		roles: ["dm"], // Players can delete their own, validation in action
		handler: CharacterActions.delete,
	},
	"character:move": {
		roles: ["dm", "player"],
		handler: CharacterActions.move,
	},
	"character:bulkEditTags": {
		roles: ["dm"], // Players can organize their own characters
		handler: CharacterActions.bulkEditTags,
	},

	// ============================================================================
	// ITEM ACTIONS (uncomment when ItemActions is implemented)
	// ============================================================================
	// 'item:use': {
	//   roles: ['dm', 'player'],
	//   handler: ItemActions.use
	// },
	// 'item:equip': {
	//   roles: ['dm', 'player'],
	//   handler: ItemActions.equip
	// },
	// 'item:unequip': {
	//   roles: ['dm', 'player'],
	//   handler: ItemActions.unequip
	// },
	// 'item:discard': {
	//   roles: ['dm', 'player'],
	//   handler: ItemActions.discard
	// },
	// 'item:restore': {
	//   roles: ['dm'],
	//   handler: ItemActions.restore
	// },
	// 'item:give': {
	//   roles: ['dm'],
	//   handler: ItemActions.give
	// },
	// 'item:transfer': {
	//   roles: ['dm', 'player'],
	//   handler: ItemActions.transfer
	// },
	"item:create": {
		roles: ["dm"],
		handler: ItemActions.create,
	},
	"item:edit": {
		roles: ["dm"],
		handler: ItemActions.edit,
	},
	"item:delete": {
		roles: ["dm"],
		handler: ItemActions.delete,
	},

	// ============================================================================
	// SKILL ACTIONS (uncomment when SkillActions is implemented)
	// ============================================================================
	"skill:create": {
		roles: ["dm"],
		handler: SkillActions.create,
	},
	"skill:edit": {
		roles: ["dm"],
		handler: SkillActions.edit,
	},
	"skill:delete": {
		roles: ["dm"],
		handler: SkillActions.delete,
	},
	"skill:bulkEditTags": {
		roles: ["dm"],
		handler: SkillActions.bulkEditTags,
	},

	//   ============================================================================
	//   ENTITY ACTIONS (uncomment when EntityActions is implemented)
	//   ============================================================================
	"entity:create": {
		roles: ["dm"],
		handler: EntityActions.create,
	},
	"entity:edit": {
		roles: ["dm"],
		handler: EntityActions.edit,
	},
	"entity:delete": {
		roles: ["dm"],
		handler: EntityActions.delete,
	},
	"entity:spawn": {
		roles: ["dm"],
		handler: EntityActions.spawn,
	},
	"entity:remove": {
		roles: ["dm"],
		handler: EntityActions.remove,
	},
	"entity:move": {
		roles: ["dm"],
		handler: EntityActions.move,
	},

	// ============================================================================
	// COMBAT ACTIONS (uncomment when CombatActions is implemented)
	// ============================================================================
	// 'combat:start': {
	//   roles: ['dm'],
	//   handler: CombatActions.start
	// },
	// 'combat:end': {
	//   roles: ['dm'],
	//   handler: CombatActions.end
	// },
	// 'combat:nextTurn': {
	//   roles: ['dm'],
	//   handler: CombatActions.nextTurn
	// },
	// 'combat:previousTurn': {
	//   roles: ['dm'],
	//   handler: CombatActions.previousTurn
	// },

	// ============================================================================
	// AUDIO ACTIONS (uncomment when AudioActions is implemented)
	// ============================================================================
	...registerDomain("audio", AudioActions, ["dm"]),
	// ============================================================================
	// IMAGE/SCENE ACTIONS
	// ============================================================================
	'scene:setEnvironmentImage': {
	  roles: ['dm'],
	  handler: SceneActions.setEnvironmentImage
	},
	'scene:setFocusImage': {
	  roles: ['dm'],
	  handler: SceneActions.setFocusImage
	},
	"image:create": {
		roles: ["dm", "player"],
		handler: ImageActions.create,
	},
	"image:bulkCreate": {
		roles: ["dm", "player"],
		handler: ImageActions.bulkCreate,
	},
	"image:delete": {
		roles: ["dm"],
		handler: ImageActions.delete,
	},
	"image:bulkEditTags": {
		roles: ["dm"],
		handler: ImageActions.bulkEditTags,
	},

	// ============================================================================
	// STATUS EFFECT ACTIONS (uncomment when StatusActions is implemented)
	// ============================================================================
	// 'status:apply': {
	//   roles: ['dm'],
	//   handler: StatusActions.apply
	// },
	// 'status:remove': {
	//   roles: ['dm'],
	//   handler: StatusActions.remove
	// },
	// 'status:create': {
	//   roles: ['dm'],
	//   handler: StatusActions.create
	// },
	// 'status:edit': {
	//   roles: ['dm'],
	//   handler: StatusActions.edit
	// },
	// 'status:delete': {
	//   roles: ['dm'],
	//   handler: StatusActions.delete
	// },
	// ============================================================================
	// LOG ACTIONS
	// ============================================================================
	"log:create": {
		roles: ["dm", "player"],
		handler: LogActions.create,
	},
	"log:log": {
		roles: ["dm", "player"],
		handler: LogActions.log,
	},
	// NOTE ACTIONS
	"note:create": {
		roles: ["player"],
		handler: NoteActions.create,
	},
	"note:edit": {
		roles: ["player"],
		handler: NoteActions.edit,
	},
	"note:delete": {
		roles: ["player"],
		handler: NoteActions.delete,
	},
	// ============================================================================
	// CAMPAIGN SETTING ACTIONS
	// ============================================================================
	...registerDomain("setting", CampaignSettingActions, ["dm"]),

	// ============================================================================
	// CAMPAIGN SETTING ACTIONS
	// ============================================================================
	...registerDomain("calendar", CalendarActions, ["dm"]),
	// ============================================================================
	//TERRAIN ACTIONS
	// ============================================================================

	"terrain:create": {
		roles: ["dm"],
		handler: TerrainActions.create,
	},
	"terrain:edit": {
		roles: ["dm"],
		handler: TerrainActions.edit,
	},
	"terrain:delete": {
		roles: ["dm"],
		handler: TerrainActions.delete,
	},
	"terrain:setActive": {
		roles: ["dm"],
		handler: TerrainActions.setActive,
	},
	"terrain:bulkEditTags": {
		roles: ["dm"],
		handler: TerrainActions.bulkEditTags,
	},
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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
 * Gets all action keys for a specific role
 */
export function getActionsForRole(role: Role): string[] {
	return Object.entries(ACTION_REGISTRY)
		.filter(([_, action]) => action.roles.includes(role))
		.map(([key, _]) => key);
}

/**
 * Helper to register all actions from a domain with specific roles
 */
function registerDomain(
	domain: string,
	actions: Record<string, ActionHandler>,
	roles: Role[]
) {
	const registered: Record<string, ActionDefinition> = {};
	for (const [actionName, handler] of Object.entries(actions)) {
		// only include handlers that look like (params, context)
		if (typeof handler === "function" && handler.length >= 2) {
			registered[`${domain}:${actionName}`] = { roles, handler };
		}
	}
	return registered;
}
