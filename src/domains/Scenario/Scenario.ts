// domains/Scenario/Scenario.ts

import { Position } from "../Actor/Actor";
import { Scene } from "../Scene/Scene";

export interface Scenario {
    Id: string;
    Name: string;

    // Scene images
    Scene: Scene;

    // Audio playlist (array of Audio IDs)
    AudioPlaylist: string[];

    // Unified, identity-based placements for every actor on the field at
    // capture time (characters, entities, and dropped items). On load each
    // placement restores the actor to its exact saved position; actors not in
    // this list are removed from the field. Replaces the old by-index
    // SpawnPositions plus the separate EntityPlacements/ItemPlacements.
    ActorPlacements: ActorPlacement[];

    // Optional
    Tags?: string[];
}

export type ScenarioActorType = "character" | "entity" | "item";

export interface ActorPlacement {
    Type: ScenarioActorType;

    // Stable identity. Character: the roster character Id. Entity/item: the
    // spawned instance Id, preserved across re-spawns so loading the same
    // scenario twice is idempotent (no duplicate spawns).
    ActorId: string;

    // Source template to re-create the actor from when it is absent from the
    // field. Entity: EntityTemplate Id. Item: ItemTemplate Id. Unused for
    // characters (they live in the roster, keyed by ActorId).
    TemplateId?: string;

    // Item entities only: remaining uses at capture time. Undefined means
    // unlimited (matches InventorySlot.UsesLeft semantics).
    UsesLeft?: number;

    Position: Position;
}

/** The distinct terrains a scenario places actors on. A scenario is only valid
 *  while every one of these still exists — a missing terrain invalidates it. */
export function getScenarioTerrainIds(scenario: Scenario): Set<string> {
    return new Set(
        (scenario.ActorPlacements ?? []).map((p) => p.Position.terrainId)
    );
}

/** Tally a scenario's placements by actor type (for logs and UI summaries). */
export function countPlacements(placements: ActorPlacement[]): {
    characters: number;
    entities: number;
    items: number;
} {
    const counts = { characters: 0, entities: 0, items: 0 };
    for (const p of placements) {
        if (p.Type === "character") counts.characters++;
        else if (p.Type === "entity") counts.entities++;
        else counts.items++;
    }
    return counts;
}
