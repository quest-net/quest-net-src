// src/types/game.ts
import type { Room } from 'trystero/nostr';
import type { ConnectionStatusType } from './connection';
// Base GameObject type that other game elements inherit from
export interface GameObject {
  id: string;
  name: string;
  description: string;
  image?: string;
  tags?: string[];
}

// Item definition
export interface Item extends GameObject {
  uses?: number;  // undefined means infinite uses
  usesLeft?: number;
  isEquippable: boolean;
}

// Skill definition
export interface Skill extends GameObject {
  damage: number;
  spCost: number;
  uses?: number;     // Total number of uses available
  usesLeft?: number; // Current uses remaining
}

// Status Effect definition
export interface StatusEffect extends GameObject {
  isBuff: boolean;
  duration: number;  // turns/rounds remaining
}

// Inventory type as a 2D array of item and count
export type InventorySlot = [Item, number];
export type Inventory = InventorySlot[];

// Equipment is just a list of equipped items
export type Equipment = Item[];

// Base type for beings that can interact with the world
export interface InteractiveActor extends GameObject {
  hp: number;
  maxHp: number;
  sp: number;
  maxSp: number;
  spRegenRate: number;
  inventory: Inventory;
  skills: Skill[];
  statusEffects: StatusEffect[];
}

// Character type (playable)
export interface SerializableCharacter extends InteractiveActor {
  mp: number;
  maxMp: number;
  playerId?: string;
  equipment: Equipment;
}

// NPC type
export interface Entity extends InteractiveActor {
  // Entities have the base interactive properties but no equipment
}

export interface GameImage extends GameObject {
  createdAt: number;
  hash?: string;         // For verification
  size: number;          // File size in bytes
  type: string;         // MIME type
  tags?: string[];       // For categorization
  thumbnail: string;     // Base64 thumbnail for preview
}
// Scene display configuration
export interface SceneDisplay {
  environmentImageId?: string;   // ID of the current environment image
  focusImageId?: string;        // ID of any focused/zoomed image
  showFocusImage: boolean;      // Whether to show the focus image overlay
}

// Global collections for the DM
export interface GlobalCollections {
  items: Item[];
  skills: Skill[];
  statusEffects: StatusEffect[];
  images: GameImage[];
  entities: Entity[];
}
export interface CombatState {
  isActive: boolean;
  currentTurn: number;
  initiativeSide: 'party' | 'enemies';
}
export interface AudioTrack {
  id: string;          
  youtubeId: string;   
  name: string;        
  url: string;         
  status: 'ready' | 'error' | 'loading';
  color?: string;
}

export interface AudioState {
  currentTrackId: string | null;
  volume: number;
  playlist: AudioTrack[];
}

// Game state interface that contains all game-related data
export interface SerializableGameState {
  party: SerializableCharacter[];
  globalCollections: GlobalCollections;
  combat?: CombatState;
  field: Entity[];
  display: SceneDisplay;
  audio: AudioState;
  lastModified: number;
}
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
    initiativeSide: 'party'
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
// Complete save state that includes metadata
export interface SerializableSaveState {
  [key: string]: any; // This makes it satisfy Trystero's DataPayload constraint
  gameState: SerializableGameState;
  lastModified: number;
  roomCreator: string;
}

// Internal types used in the application (aliases for consistency)
export type Character = SerializableCharacter;
export type GameState = SerializableGameState;
export type SaveState = SerializableSaveState;

// Information about saved room states
export interface SavedRoomInfo {
  roomId: string;
  lastModified: Date;
  gameState: GameState;
}

// Component props interfaces
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

// Re-export Room type from trystero for convenience
//import type { Room } from 'trystero/torrent';
export type { Room };

// Utility types for working with collections
export type ItemMap = Map<string, Item>;
export type SkillMap = Map<string, Skill>;
export type StatusEffectMap = Map<string, StatusEffect>;

// Helper type for working with collections
export type ImageMap = Map<string, GameImage>;

// Type guards for runtime type checking
export function isCharacter(entity: GameObject): entity is Character {
  return 'equipment' in entity;
}

export function isEntity(entity: GameObject): entity is Entity {
  return 'hp' in entity && !('equipment' in entity);
}

export function isItem(obj: GameObject): obj is Item {
  return 'isEquippable' in obj;
}

export function isSkill(obj: GameObject): obj is Skill {
  return 'damage' in obj && 'spCost' in obj;
}

export function isStatusEffect(obj: GameObject): obj is StatusEffect {
  return 'isBuff' in obj && 'duration' in obj;
}
export function isGameImage(obj: GameObject): obj is GameImage {
  return 'createdAt' in obj && 'thumbnail' in obj && 'size' in obj;
}