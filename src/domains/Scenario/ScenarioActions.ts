// domains/Scenario/ScenarioActions.ts

import { Context } from "../Context/Context";
import { Scenario, EntityPlacement, ItemPlacement } from "./Scenario";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { EntityActions } from "../Entity/EntityActions";
import { VoxelTerrainActions } from "../VoxelTerrain/VoxelTerrainActions";
import { getActiveVoxelTerrain } from "../../utils/terrain/data/VoxelTerrainUtils";
import { isItemEntity, getItemDataFromEntity, createItemEntity } from "../Item/ItemDropUtils";

/**
 * Scenario action handlers
 * Scenarios allow DMs to capture and restore game state configurations
 */
export const ScenarioActions = {
    /**
     * Captures the current GameState as a new Scenario
     * If a scenario with the same name exists, it will be overwritten
     */
    capture(params: { name: string }, context: Context): void {
        const campaign = CampaignActions.getActiveCampaign(context);
        const gs = campaign.GameState;

        // Build entity placements by finding the template for each spawned entity.
        // Item entities are templateless (their state lives in a tag) and are
        // captured separately into itemPlacements.
        const entityPlacements: EntityPlacement[] = [];
        const itemPlacements: ItemPlacement[] = [];
        for (const entity of gs.Entities) {
            if (isItemEntity(entity)) {
                // Templateless item entity — capture template ref + uses + position.
                // The item snapshot lives in a tag; pull the ID and remaining
                // uses out of it. Skip if the snapshot is unreadable.
                const snapshot = getItemDataFromEntity(entity);
                if (snapshot) {
                    itemPlacements.push({
                        ItemTemplateId: snapshot.Id,
                        UsesLeft: snapshot.UsesLeft,
                        Position: { ...entity.Position },
                    });
                }
                continue;
            }

            // Find the template by matching base name
            const baseName = EntityActions.getBaseName(entity.Name);
            const template = campaign.EntityTemplates.find(
                (t) => EntityActions.getBaseName(t.Name) === baseName
            );

            if (template) {
                entityPlacements.push({
                    EntityTemplateId: template.Id,
                    Position: { ...entity.Position },
                });
            }
        }

        const scenario: Scenario = {
            Id: crypto.randomUUID(),
            Name: params.name,
            TerrainId: gs.VoxelTerrainId,
            Scene: { ...gs.Scene },
            AudioPlaylist: [...gs.Audio],
            EntityPlacements: entityPlacements,
            ItemPlacements: itemPlacements,
            SpawnPositions: gs.Characters.map((c) => ({ ...c.Position })),
        };

        // Check for existing scenario with same name
        const existingIndex = campaign.Scenarios.findIndex(
            (s) => s.Name === params.name
        );
        if (existingIndex >= 0) {
            // Keep same ID, overwrite the rest
            scenario.Id = campaign.Scenarios[existingIndex].Id;
            scenario.Tags = campaign.Scenarios[existingIndex].Tags;
            campaign.Scenarios[existingIndex] = scenario;

            LogActions.create(
                {
                    action: "Scenario updated",
                    details: `${params.name} has been updated with current state`,
                    category: "system",
                    level: "info",
                    visibility: ["dm"],
                },
                context
            );
        } else {
            campaign.Scenarios.push(scenario);

            LogActions.create(
                {
                    action: "Scenario captured",
                    details: `${params.name} saved with ${entityPlacements.length} entities, ${itemPlacements.length} items, ${scenario.SpawnPositions.length} spawn positions`,
                    category: "system",
                    level: "info",
                    visibility: ["dm"],
                },
                context
            );
        }
    },

    /**
     * Loads a scenario, replacing current game state configuration
     * Clears entities, spawns from placements, relocates characters
     */
    async load(params: { scenarioId: string }, context: Context): Promise<void> {
        const campaign = CampaignActions.getActiveCampaign(context);
        const scenario = campaign.Scenarios.find((s) => s.Id === params.scenarioId);

        if (!scenario) {
            console.warn(`Scenario not found: ${params.scenarioId}`);
            return;
        }

        // 1. Set terrain (skip if deleted). Defer actor repair until
        // after this scenario has fully replaced entities and character
        // positions, otherwise the previous encounter layout can be judged
        // against the new terrain.
        const terrainExists = campaign.VoxelTerrains.some(
            (t) => t.Id === scenario.TerrainId
        );
        if (terrainExists) {
            await VoxelTerrainActions.setActive(
                { terrainId: scenario.TerrainId, repairActors: false },
                context
            );
        }

        // 2. Clear existing entities
        campaign.GameState.Entities = [];

        // 3. Spawn entities from placements (skip if template deleted)
        for (const placement of scenario.EntityPlacements) {
            const templateExists = campaign.EntityTemplates.some(
                (t) => t.Id === placement.EntityTemplateId
            );
            if (templateExists) {
                EntityActions.spawn(
                    {
                        entityId: placement.EntityTemplateId,
                        position: placement.Position,
                        repairActors: false,
                    },
                    context
                );
            }
        }

        // 3b. Restore item entities by rebuilding a fresh entity from the
        // template (skip if template deleted), preserving UsesLeft from capture.
        for (const placement of scenario.ItemPlacements ?? []) {
            const template = campaign.ItemTemplates.find(
                (t) => t.Id === placement.ItemTemplateId
            );
            if (!template) continue;

            const entity = createItemEntity(
                template,
                { Id: template.Id, UsesLeft: placement.UsesLeft },
                placement.Position,
                campaign.Settings.StatDefinitions,
                campaign.Settings.ActionDefinitions
            );
            campaign.GameState.Entities.push(entity);
        }

        // 4. Relocate characters to spawn positions
        const characters = campaign.GameState.Characters;
        for (let i = 0; i < characters.length; i++) {
            if (i < scenario.SpawnPositions.length) {
                characters[i].Position = { ...scenario.SpawnPositions[i] };
            }
            // Overflow characters keep current position, will be validated by terrain change
        }

        // 5. Set scene images
        campaign.GameState.Scene = { ...scenario.Scene };

        // 6. Set audio (filter to only existing tracks)
        campaign.GameState.Audio = scenario.AudioPlaylist.filter((id) =>
            campaign.Audios.some((a) => a.Id === id)
        );

        if (getActiveVoxelTerrain(campaign)) {
            VoxelTerrainActions.repairActors(context);
        }

        LogActions.create(
            {
                action: "Scenario loaded",
                details: `${scenario.Name} has been activated`,
                category: "system",
                level: "important",
                visibility: ["dm"],
            },
            context
        );
    },

    /**
     * Deletes a scenario from the collection
     */
    delete(params: { scenarioId: string }, context: Context): void {
        const campaign = CampaignActions.getActiveCampaign(context);

        const index = campaign.Scenarios.findIndex(
            (s) => s.Id === params.scenarioId
        );
        if (index === -1) {
            console.warn(`Scenario not found: ${params.scenarioId}`);
            return;
        }

        const scenario = campaign.Scenarios[index];
        campaign.Scenarios.splice(index, 1);

        LogActions.create(
            {
                action: "Scenario deleted",
                details: scenario.Name,
                category: "system",
                level: "info",
                visibility: ["dm"],
            },
            context
        );
    },

    /**
     * Edits scenario metadata (name, tags)
     */
    edit(
        params: { scenarioId: string; updates: Partial<Scenario> },
        context: Context
    ): void {
        const campaign = CampaignActions.getActiveCampaign(context);

        const scenario = campaign.Scenarios.find(
            (s) => s.Id === params.scenarioId
        );
        if (!scenario) {
            console.warn(`Scenario not found: ${params.scenarioId}`);
            return;
        }

        Object.assign(scenario, params.updates);

        LogActions.create(
            {
                action: "Scenario updated",
                details: scenario.Name,
                category: "system",
                level: "info",
                visibility: ["dm"],
            },
            context
        );
    },

    /**
     * Bulk edit tags for multiple scenarios
     * More efficient than individual edits - single log entry, single state sync
     */
    bulkEditTags(
        params: { updates: Array<{ scenarioId: string; tags: string[] }> },
        context: Context
    ): void {
        const campaign = CampaignActions.getActiveCampaign(context);

        let successCount = 0;

        // Apply all updates
        params.updates.forEach((update) => {
            const scenario = campaign.Scenarios.find(
                (s) => s.Id === update.scenarioId
            );

            if (scenario) {
                scenario.Tags = update.tags;
                successCount++;
            } else {
                console.warn(
                    `Scenario not found for bulk update: ${update.scenarioId}`
                );
            }
        });

        // Single log entry for the entire bulk operation
        LogActions.create(
            {
                action: "Scenarios organized",
                details: `Updated tags for ${successCount} scenario(s)`,
                category: "system",
                level: "info",
                visibility: ["dm"],
            },
            context
        );
    },
};
