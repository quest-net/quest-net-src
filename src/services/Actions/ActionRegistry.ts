// services/ActionRegistry.ts

import { User } from '../../domains/User/User';
import { Context } from '../../domains/Context/Context';
import { CharacterActions } from '../../domains/Character/CharacterActions';
import { CampaignSettingActions } from '../../domains/CampaignSetting/CampaignSettingActions';
import { LogActions } from '../../domains/Log/LogActions';
import { ImageActions } from '../../domains/Image/ImageActions';
import { TerrainActions } from '../../domains/Terrain/TerrainActions';
import { ItemActions } from '../../domains/Item/ItemActions';
// Import other action modules as they're created
// import { ItemActions } from '../domains/Item/ItemActions';
// import { SkillActions } from '../domains/Skill/SkillActions';
// import { CombatActions } from '../domains/Combat/CombatActions';
// etc.

export type Role = 'dm' | 'player';
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
  'character:create': {
    roles: ['dm', 'player'],
    handler: CharacterActions.create
  },
  'character:spawn': {
    roles: ['dm'],
    handler: CharacterActions.spawn
  },
  'character:remove': {
    roles: ['dm'],
    handler: CharacterActions.remove
  },
  'character:edit': {
    roles: ['dm', 'player'], // Players can update their own, validation in action
    handler: CharacterActions.edit
  },
  'character:delete': {
    roles: ['dm'], // Players can delete their own, validation in action
    handler: CharacterActions.delete
  },
  'character:move': {
    roles: ['dm', 'player'],
    handler: CharacterActions.move
  },
  'character:bulkEditTags': {
    roles: ['dm'], // Players can organize their own characters
    handler: CharacterActions.bulkEditTags
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
    'item:create': {
    roles: ['dm'],
    handler: ItemActions.create
    },
    'item:edit': {
    roles: ['dm'],
    handler: ItemActions.edit
    },
    'item:delete': {
    roles: ['dm'],
    handler: ItemActions.delete
    },
  
  // ============================================================================
  // SKILL ACTIONS (uncomment when SkillActions is implemented)
  // ============================================================================
  // 'skill:use': {
  //   roles: ['dm', 'player'],
  //   handler: SkillActions.use
  // },
  // 'skill:remove': {
  //   roles: ['dm', 'player'],
  //   handler: SkillActions.remove
  // },
  // 'skill:grant': {
  //   roles: ['dm'],
  //   handler: SkillActions.grant
  // },
  // 'skill:restore': {
  //   roles: ['dm'],
  //   handler: SkillActions.restore
  // },
  // 'skill:create': {
  //   roles: ['dm'],
  //   handler: SkillActions.create
  // },
  // 'skill:edit': {
  //   roles: ['dm'],
  //   handler: SkillActions.edit
  // },
  // 'skill:delete': {
  //   roles: ['dm'],
  //   handler: SkillActions.delete
  // },
  
  // ============================================================================
  // ENTITY ACTIONS (uncomment when EntityActions is implemented)
  // ============================================================================
  // 'entity:create': {
  //   roles: ['dm'],
  //   handler: EntityActions.create
  // },
  // 'entity:edit': {
  //   roles: ['dm'],
  //   handler: EntityActions.edit
  // },
  // 'entity:delete': {
  //   roles: ['dm'],
  //   handler: EntityActions.delete
  // },
  // 'entity:spawn': {
  //   roles: ['dm'],
  //   handler: EntityActions.spawn
  // },
  // 'entity:remove': {
  //   roles: ['dm'],
  //   handler: EntityActions.remove
  // },
  // 'entity:move': {
  //   roles: ['dm'],
  //   handler: EntityActions.move
  // },
  
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
  // 'audio:play': {
  //   roles: ['dm'],
  //   handler: AudioActions.play
  // },
  // 'audio:stop': {
  //   roles: ['dm'],
  //   handler: AudioActions.stop
  // },
  // 'audio:setVolume': {
  //   roles: ['dm'],
  //   handler: AudioActions.setVolume
  // },
  // 'audio:create': {
  //   roles: ['dm'],
  //   handler: AudioActions.create
  // },
  // 'audio:delete': {
  //   roles: ['dm'],
  //   handler: AudioActions.delete
  // },
  
  // ============================================================================
  // IMAGE/SCENE ACTIONS (uncomment when SceneActions/ImageActions is implemented)
  // ============================================================================
  // 'scene:setEnvironment': {
  //   roles: ['dm'],
  //   handler: SceneActions.setEnvironment
  // },
  // 'scene:setFocus': {
  //   roles: ['dm'],
  //   handler: SceneActions.setFocus
  // },
    'image:create': {
      roles: ['dm', 'player'],
      handler: ImageActions.create
    },
    'image:bulkCreate': {
      roles: ['dm', 'player'],
      handler: ImageActions.bulkCreate
    },
    'image:delete': {
      roles: ['dm'],
      handler: ImageActions.delete
    },
    'image:bulkEditTags': {
      roles: ['dm'],
      handler: ImageActions.bulkEditTags
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
    'log:create': {
      roles: ['dm', 'player'],
      handler: LogActions.create
    },
    'log:log': {
      roles: ['dm', 'player'],
      handler: LogActions.log
    },
  // ============================================================================
  // CAMPAIGN SETTING ACTIONS
  // ============================================================================
    ...registerDomain('setting', CampaignSettingActions, ['dm']),
  // ============================================================================
  //TERRAIN ACTIONS
  // ============================================================================
    ...registerDomain('terrain', TerrainActions, ['dm']),
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
): Record<string, ActionDefinition> {
  const registered: Record<string, ActionDefinition> = {};
  
  for (const [actionName, handler] of Object.entries(actions)) {
    const key = `${domain}:${actionName}`;
    registered[key] = { roles, handler };
  }
  
  return registered;
}