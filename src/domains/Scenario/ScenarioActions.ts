// domains/Scenario/ScenarioActions.ts

import { Context } from "../Context/Context";
import { Scenario, ActorPlacement, countPlacements } from "./Scenario";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { EntityActions } from "../Entity/EntityActions";
import { CharacterActions } from "../Character/CharacterActions";
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

        // Snapshot every actor on the field by identity into one unified list.
        const placements: ActorPlacement[] = [];

        // Characters keep their stable roster Id; they are relocated (not
        // re-created) on load.
        for (const character of gs.Characters) {
            placements.push({
                Type: "character",
                ActorId: character.Id,
                Position: { ...character.Position },
            });
        }

        for (const entity of gs.Entities) {
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
            const baseName = EntityActions.getBaseName(entity.Name);
            const template = campaign.EntityTemplates.find(
                (t) => EntityActions.getBaseName(t.Name) === baseName
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

        const scenario: Scenario = {
            Id: crypto.randomUUID(),
            Name: params.name,
            TerrainId: gs.VoxelTerrainId,
            Scene: { ...gs.Scene },
            AudioPlaylist: [...gs.Audio],
            ActorPlacements: placements,
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

            const counts = countPlacements(placements);
            LogActions.create(
                {
                    action: "Scenario captured",
                    details: `${params.name} saved with ${counts.characters} characters, ${counts.entities} entities, ${counts.items} items`,
                    category: "system",
                    level: "info",
                    visibility: ["dm"],
                },
                context
            );
        }
    },

    /**
     * Loads a scenario, reproducing its saved layout exactly.
     *
     * Every saved actor ends up at its saved position: characters are relocated
     * (or spawned from the roster) by identity, entities/items already on the
     * field are kept as-is and just repositioned, and absent ones are re-created
     * from their templates (preserving the saved instance Id so re-loading is
     * idempotent). Actors on the field that are NOT in the scenario are removed:
     * characters return to the roster, entities/items are despawned.
     */
    async load(params: { scenarioId: string }, context: Context): Promise<void> {
        const campaign = CampaignActions.getActiveCampaign(context);
        const scenario = campaign.Scenarios.find((s) => s.Id === params.scenarioId);

        if (!scenario) {
            console.warn(`Scenario not found: ${params.scenarioId}`);
            return;
        }

        // 1. Set terrain (skip if deleted). Defer actor repair until after this
        // scenario has fully replaced the layout, otherwise the previous
        // encounter can be judged against the new terrain.
        const terrainExists = campaign.VoxelTerrains.some(
            (t) => t.Id === scenario.TerrainId
        );
        if (terrainExists) {
            await VoxelTerrainActions.setActive(
                { terrainId: scenario.TerrainId, repairActors: false },
                context
            );
        }

        const placements = scenario.ActorPlacements ?? [];
        const placedCharacterIds = new Set(
            placements.filter((p) => p.Type === "character").map((p) => p.ActorId)
        );
        const placedInstanceIds = new Set(
            placements.filter((p) => p.Type !== "character").map((p) => p.ActorId)
        );

        // 2. Remove field actors not in the scenario. Characters return to the
        // roster (state preserved); iterate a copy since remove() mutates the
        // Characters array. Entities/items are simply despawned.
        for (const character of [...campaign.GameState.Characters]) {
            if (!placedCharacterIds.has(character.Id)) {
                CharacterActions.remove(
                    { characterId: character.Id },
                    context
                );
            }
        }
        campaign.GameState.Entities = campaign.GameState.Entities.filter((e) =>
            placedInstanceIds.has(e.Id)
        );

        // 3. Apply placements — relocate what is present, re-create what is not.
        for (const placement of placements) {
            if (placement.Type === "character") {
                const onField = campaign.GameState.Characters.find(
                    (c) => c.Id === placement.ActorId
                );
                if (onField) {
                    onField.Position = { ...placement.Position };
                } else if (
                    campaign.CharacterRoster.some((c) => c.Id === placement.ActorId)
                ) {
                    CharacterActions.spawn(
                        {
                            characterId: placement.ActorId,
                            position: placement.Position,
                        },
                        context
                    );
                }
                // else: character deleted from the campaign — skip
                continue;
            }

            if (placement.Type === "entity") {
                const onField = campaign.GameState.Entities.find(
                    (e) => e.Id === placement.ActorId
                );
                if (onField) {
                    // Already present — keep its state as-is, just reposition.
                    onField.Position = { ...placement.Position };
                } else if (
                    campaign.EntityTemplates.some((t) => t.Id === placement.TemplateId)
                ) {
                    // Re-create fresh from the template, preserving the saved
                    // instance Id so a second load does not duplicate it.
                    EntityActions.spawn(
                        {
                            entityId: placement.TemplateId!,
                            position: placement.Position,
                            instanceId: placement.ActorId,
                            repairActors: false,
                        },
                        context
                    );
                }
                // else: template deleted — skip
                continue;
            }

            // Item entity
            const onField = campaign.GameState.Entities.find(
                (e) => e.Id === placement.ActorId
            );
            if (onField) {
                onField.Position = { ...placement.Position };
                continue;
            }
            const template = campaign.ItemTemplates.find(
                (t) => t.Id === placement.TemplateId
            );
            if (!template) continue;

            const entity = createItemEntity(
                template,
                { Id: template.Id, UsesLeft: placement.UsesLeft },
                placement.Position,
                campaign.Settings.StatDefinitions,
                campaign.Settings.ActionDefinitions
            );
            // Preserve the saved instance Id for idempotent re-loads.
            entity.Id = placement.ActorId;
            campaign.GameState.Entities.push(entity);
        }

        // 4. Set scene images
        campaign.GameState.Scene = { ...scenario.Scene };

        // 5. Set audio (filter to only existing tracks)
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
