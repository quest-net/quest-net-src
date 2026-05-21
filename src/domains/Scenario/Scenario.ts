// domains/Scenario/Scenario.ts

import { Position } from "../Actor/Actor";
import { Scene } from "../Scene/Scene";

export interface Scenario {
    Id: string;
    Name: string;

    // Voxel terrain to load. Kept as TerrainId for save compatibility.
    TerrainId: string;

    // Scene images
    Scene: Scene;

    // Audio playlist (array of Audio IDs)
    AudioPlaylist: string[];

    // Entities to spawn: references EntityTemplates by ID
    EntityPlacements: EntityPlacement[];

    // Item entities (dropped/spawned items) to restore: references ItemTemplates
    // by ID, with UsesLeft preserved per placement. Optional for backward
    // compatibility with scenarios saved before item-entity support was added.
    ItemPlacements?: ItemPlacement[];

    // Spawn positions for characters (first N chars use these, rest overflow)
    SpawnPositions: Position[];

    // Optional
    Tags?: string[];
}

export interface EntityPlacement {
    EntityTemplateId: string;
    Position: Position;
}

export interface ItemPlacement {
    // Reference to the item template. On load a fresh entity is built from
    // the template, mirroring how EntityPlacements work.
    ItemTemplateId: string;
    // Remaining uses at capture time. Undefined means unlimited (matches the
    // semantics of InventorySlot.UsesLeft).
    UsesLeft?: number;
    Position: Position;
}
