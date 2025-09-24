// src/types/game.ts
import type { Room } from 'trystero/nostr';
import type { ConnectionStatusType } from './connection';

// =============================================================================
// BASE TYPES & CONSTANTS
// =============================================================================

// Base GameObject type that other game elements inherit from
export interface GameObject {
  id: string;
  name: string;
  description: string;
  image?: string;
  tags?: string[];
}

// Battle map position type
export interface BattleMapPosition {
  x: number;
  y: number;
  lastMoveFrom?: {
    x: number;
    y: number;
  };
}

// Default positions for battle map
export const DEFAULT_CHARACTER_POSITIONS: BattleMapPosition[] = [
  { x: 10, y: 20 },
  { x: 10, y: 30 },
  { x: 10, y: 40 },
  { x: 20, y: 20 },
  { x: 20, y: 30 },
  { x: 20, y: 40 }
];

export const DEFAULT_ENTITY_POSITIONS: BattleMapPosition[] = [
  { x: 40, y: 20 },
  { x: 40, y: 30 },
  { x: 40, y: 40 },
  { x: 50, y: 20 },
  { x: 50, y: 30 },
  { x: 50, y: 40 }
];

// =============================================================================
// REFERENCE TYPES (NEW - for catalog item instances)
// =============================================================================

// Reference to an item in the catalog with instance-specific data
export interface ItemReference {
  catalogId: string;        // Reference to globalCollections.items
  usesLeft?: number;        // Instance-specific: current uses remaining
}

// Reference to a skill in the catalog with instance-specific data
export interface SkillReference {
  catalogId: string;        // Reference to globalCollections.skills
  usesLeft?: number;        // Instance-specific: current uses remaining
}

// Reference to a status effect in the catalog with instance-specific data
export interface StatusEffectReference {
  catalogId: string;        // Reference to globalCollections.statusEffects
  duration: number;         // Instance-specific: turns remaining
}

// Reference to an entity in the catalog with instance-specific data
export interface EntityReference {
  instanceId: string;       // Unique ID for this entity instance
  catalogId: string;        // Reference to globalCollections.entities
  hp: number;              // Instance-specific: current HP
  sp: number;              // Instance-specific: current SP
  inventory: InventorySlot[]; // Instance-specific inventory state
  skills: SkillReference[];   // Instance-specific skill states
  statusEffects: StatusEffectReference[]; // Instance-specific effects
}

// =============================================================================
// CORE GAME OBJECTS (Catalog definitions)
// =============================================================================

// Item definition (catalog template)
export interface Item extends GameObject {
  uses?: number;           // undefined means infinite uses
  isEquippable: boolean;
}

// Skill definition (catalog template)
export interface Skill extends GameObject {
  damage: number;
  spCost: number;
  uses?: number;           // Total number of uses available
}

// Status Effect definition (catalog template)
export interface StatusEffect extends GameObject {
  isBuff: boolean;
}

// Game image definition
export interface GameImage extends GameObject {
  createdAt: number;
  hash?: string;         // For verification
  size: number;          // File size in bytes
  type: string;         // MIME type
}

// =============================================================================
// INVENTORY & EQUIPMENT TYPES (Now using references)
// =============================================================================

// Inventory slot containing item reference and count
export type InventorySlot = [ItemReference, number];
export type Inventory = InventorySlot[];

// Equipment is a list of equipped item references
export type Equipment = ItemReference[];

// =============================================================================
// ACTOR TYPES (Characters & Entities)
// =============================================================================

// Base type for beings that can interact with the world
export interface InteractiveActor extends GameObject {
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  spRegenRate: number;
  inventory: Inventory;
  skills: SkillReference[];
  statusEffects: StatusEffectReference[];
}

// Character type (playable) - now uses references
export interface SerializableCharacter extends InteractiveActor {
  mp: number;
  maxMp: number;
  playerId?: string;
  equipment: Equipment;
}

// Entity type (catalog template for NPCs/enemies)
export interface Entity extends InteractiveActor {
  // Entities have the base interactive properties but no equipment
  // This is the catalog definition - instances use EntityReference
}

// =============================================================================
// COLLECTION & STATE TYPES
// =============================================================================

// Global collections for the DM (catalog definitions)
export interface GlobalCollections {
  items: Item[];
  skills: Skill[];
  statusEffects: StatusEffect[];
  images: GameImage[];
  entities: Entity[];
}

// Combat state
export interface CombatState {
  isActive: boolean;
  currentTurn: number;
  initiativeSide: 'party' | 'enemies';
  positions: {
    [actorId: string]: BattleMapPosition;
  };
}

// Scene display configuration
export interface SceneDisplay {
  environmentImageId?: string;   // ID of the current environment image
  focusImageId?: string;        // ID of any focused/zoomed image
  showFocusImage: boolean;      // Whether to show the focus image overlay
}

// Audio track definition
export interface AudioTrack {
  id: string;          
  youtubeId: string;   
  name: string;        
  url: string;         
  status: 'ready' | 'error' | 'loading';
  color?: string;
}

// Audio state
export interface AudioState {
  currentTrackId: string | null;
  volume: number;
  playlist: AudioTrack[];
}

// Main game state interface (now using references)
export interface SerializableGameState {
  party: SerializableCharacter[];
  globalCollections: GlobalCollections;
  combat?: CombatState;
  field: EntityReference[];        // Changed from Entity[] to EntityReference[]
  display: SceneDisplay;
  audio: AudioState;
  lastModified: number;
}

// Complete save state that includes metadata
export interface SerializableSaveState {
  [key: string]: any; // This makes it satisfy Trystero's DataPayload constraint
  gameState: SerializableGameState;
  lastModified: number;
  roomCreator: string;
}

// Information about saved room states
export interface SavedRoomInfo {
  roomId: string;
  lastModified: Date;
  gameState: GameState;
}

// Initial game state
export const initialGameState: GameState = {
  party: [],
  globalCollections: {
    items: [],
    skills: [],
    statusEffects: [],
    images: [],
    entities: []
  },
  combat: {
    isActive: false,
    currentTurn: 0,
    initiativeSide: 'party',
    positions: {}
  },
  field: [],
  display: {
    environmentImageId: undefined,
    focusImageId: undefined,
    showFocusImage: false
  },
  audio: {
    currentTrackId: 'silence',  // Default to silence
    volume: 70,
    playlist: [{
      id: 'silence',
      youtubeId: '',
      name: 'Silence',
      url: '',
      status: 'ready', 
      color: 'bg-grey/5 dark:bg-offwhite/5'  
    }]
  },
  lastModified: Date.now()
};

// =============================================================================
// TYPE ALIASES (for consistency)
// =============================================================================

export type Character = SerializableCharacter;
export type GameState = SerializableGameState;
export type SaveState = SerializableSaveState;

// Re-export Room type from trystero for convenience
export type { Room };

// =============================================================================
// COMPONENT PROPS INTERFACES
// =============================================================================

export interface DMViewProps {
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  room?: Room;
  isRoomCreator: boolean;
  activeTab?: 'characters' | 'visuals' | 'audio' | 'catalog' | 'encounter' | 'battle' | 'settings';
  onTabChange?: (tab: 'characters' | 'visuals' | 'audio' | 'catalog' | 'encounter' | 'battle' | 'settings') => void;
}

export interface PlayerViewProps {
  gameState: GameState;
  onGameStateChange: (newState: GameState) => void;
  playerId: string;
  onCharacterSelect: (characterId: string) => void;
  room?: Room;
  // Modal control props
  showInventoryModal?: boolean;
  showEquipmentModal?: boolean;
  showSkillsModal?: boolean;
  onShowInventory?: (show: boolean) => void;
  onShowEquipment?: (show: boolean) => void;
  onShowSkills?: (show: boolean) => void;
  // Tab control props
  activeTab?: 'equipment' | 'inventory' | 'skills' | 'settings';
  onTabChange?: (tab: 'equipment' | 'inventory' | 'skills' | 'settings') => void;
  connectionStatus?: ConnectionStatusType;
  localVolume?: number;
}

// Helper type for inventory management
export interface InventoryManagementProps {
  inventory: Inventory;
  onInventoryChange: (newInventory: Inventory) => void;
  isEquipment?: boolean;
}

// Helper types for the DM's global collection management
export interface GlobalCollectionManagementProps {
  collections: GlobalCollections;
  onCollectionsChange: (newCollections: GlobalCollections) => void;
}

// =============================================================================
// UTILITY TYPES
// =============================================================================

export type ItemMap = Map<string, Item>;
export type SkillMap = Map<string, Skill>;
export type StatusEffectMap = Map<string, StatusEffect>;
export type ImageMap = Map<string, GameImage>;

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isCharacter(entity: GameObject): entity is Character {
  return 'equipment' in entity;
}

export function isEntity(entity: GameObject): entity is Entity {
  return 'hp' in entity && !('equipment' in entity);
}

export function isEntityReference(obj: any): obj is EntityReference {
  return obj && typeof obj === 'object' && 'catalogId' in obj && 'instanceId' in obj && 'hp' in obj;
}

export function isItem(obj: GameObject): obj is Item {
  return 'isEquippable' in obj;
}

export function isItemReference(obj: any): obj is ItemReference {
  return obj && typeof obj === 'object' && 'catalogId' in obj && !('hp' in obj);
}

export function isSkill(obj: GameObject): obj is Skill {
  return 'damage' in obj && 'spCost' in obj;
}

export function isSkillReference(obj: any): obj is SkillReference {
  return obj && typeof obj === 'object' && 'catalogId' in obj && !('damage' in obj);
}

export function isStatusEffect(obj: GameObject): obj is StatusEffect {
  return 'isBuff' in obj && 'duration' in obj;
}

export function isStatusEffectReference(obj: any): obj is StatusEffectReference {
  return obj && typeof obj === 'object' && 'catalogId' in obj && 'duration' in obj;
}

export function isGameImage(obj: GameObject): obj is GameImage {
  return 'createdAt' in obj && 'size' in obj && 'type' in obj;
}