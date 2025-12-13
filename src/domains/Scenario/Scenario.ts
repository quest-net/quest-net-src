// domains/Scenario/Scenario.ts

import { Position } from "../Actor/Actor";
import { Scene } from "../Scene/Scene";

export interface Scenario {
    Id: string;
    Name: string;

    // Terrain to load
    TerrainId: string;

    // Scene images
    Scene: Scene;

    // Audio playlist (array of Audio IDs)
    AudioPlaylist: string[];

    // Entities to spawn: references EntityTemplates by ID
    EntityPlacements: EntityPlacement[];

    // Spawn positions for characters (first N chars use these, rest overflow)
    SpawnPositions: Position[];

    // Optional
    Tags?: string[];
}

export interface EntityPlacement {
    EntityTemplateId: string;
    Position: Position;
}
