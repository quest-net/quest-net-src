// domains/Scenario/ScenarioUtils.ts

import { Campaign } from "../Campaign/Campaign";
import { ActorPlacement } from "./Scenario";
import { EntityUtils } from "../Entity/EntityUtils";
import { isItemEntity, getItemDataFromEntity } from "../Item/ItemDropUtils";

/**
 * Builds the placement snapshot for a scenario capture from the live GameState.
 *
 * Multi-terrain capture rule: the entire party is always saved (every active
 * character, wherever it stands), but entities and dropped items are saved ONLY
 * when they share a terrain with at least one party member. This keeps a
 * scenario focused on what is around the party — a room the DM prepped on some
 * far-off terrain the party hasn't reached is left out of the snapshot (and so
 * is left untouched on load).
 *
 * Pure and side-effect free so the capture modal can preview exactly what
 * `ScenarioActions.capture` will store.
 */
export function buildCapturePlacements(campaign: Campaign): ActorPlacement[] {
    const gs = campaign.GameState;

    // Terrains any party member currently occupies. Only entities/items on
    // these terrains are captured.
    const partyTerrainIds = new Set(
        gs.Characters.map((c) => c.Position.terrainId)
    );

    const placements: ActorPlacement[] = [];

    // Characters keep their stable roster Id; they are relocated (not
    // re-created) on load. The whole party is captured regardless of terrain.
    for (const character of gs.Characters) {
        placements.push({
            Type: "character",
            ActorId: character.Id,
            Position: { ...character.Position },
        });
    }

    for (const entity of gs.Entities) {
        // Skip entities the party isn't sharing a terrain with.
        if (!partyTerrainIds.has(entity.Position.terrainId)) continue;

        if (isItemEntity(entity)) {
            // Templateless item entity — capture instance Id + template ref +
            // uses + position. The item snapshot lives in a tag; pull the
            // template ID and remaining uses out of it. Skip if unreadable.
            const snapshot = getItemDataFromEntity(entity);
            if (snapshot) {
                placements.push({
                    Type: "item",
                    ActorId: entity.Id,
                    TemplateId: snapshot.Id,
                    UsesLeft: snapshot.UsesLeft,
                    Position: { ...entity.Position },
                });
            }
            continue;
        }

        // Regular entity — capture instance Id plus the template it was
        // spawned from (matched by base name), so it can be re-created if
        // it is no longer on the field at load time.
        const baseName = EntityUtils.getBaseName(entity.Name);
        const template = campaign.EntityTemplates.find(
            (t) => EntityUtils.getBaseName(t.Name) === baseName
        );

        if (template) {
            placements.push({
                Type: "entity",
                ActorId: entity.Id,
                TemplateId: template.Id,
                Position: { ...entity.Position },
            });
        }
    }

    return placements;
}
