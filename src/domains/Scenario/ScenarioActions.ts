// domains/Scenario/ScenarioActions.ts

import { Context } from "../Context/Context";
import { Scenario, countPlacements } from "./Scenario";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { LogActions } from "../Log/LogActions";
import { EntityActions } from "../Entity/EntityActions";
import { CharacterActions } from "../Character/CharacterActions";
import { VoxelTerrainUtils } from "../VoxelTerrain/VoxelTerrainUtils";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { createItemEntity } from "../Item/ItemDropUtils";
import { buildCapturePlacements } from "./ScenarioUtils";

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
        const campaign = CampaignUtils.getActiveCampaign(context);
        const gs = campaign.GameState;

        const placements = buildCapturePlacements(campaign);

        const scenario: Scenario = {
            Id: crypto.randomUUID(),
            Name: params.name,
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
     * Loads a scenario, reproducing its saved layout on the terrains it touches.
     *
     * Every saved actor ends up at its saved position: characters are relocated
     * (or spawned from the roster) by identity, entities/items already on the
     * field are kept as-is and just repositioned, and absent ones are re-created
     * from their templates (preserving the saved instance Id so re-loading is
     * idempotent).
     *
     * Multi-terrain scoping: only the terrains the scenario references are reset.
     * Entities/items on those terrains that aren't part of the scenario are
     * despawned; everything on other terrains is left untouched. Characters are
     * never despawned — a character active now but absent from the scenario
     * simply stays where it is.
     */
    async load(params: { scenarioId: string }, context: Context): Promise<void> {
        const campaign = CampaignUtils.getActiveCampaign(context);
        const scenario = campaign.Scenarios.find((s) => s.Id === params.scenarioId);

        if (!scenario) {
            console.warn(`Scenario not found: ${params.scenarioId}`);
            return;
        }

        // Each placement carries its own terrainId (multi-terrain worlds), so a
        // scenario may span several terrains. Actor repair is deferred until the
        // layout is fully restored, then runs per occupied terrain below.
        const placements = scenario.ActorPlacements ?? [];
        const placedInstanceIds = new Set(
            placements.filter((p) => p.Type !== "character").map((p) => p.ActorId)
        );

        // Terrains this scenario touches. On load only these terrains are reset;
        // everywhere else is left exactly as the DM left it — a room prepped on a
        // distant terrain the party never reached stays intact.
        const referencedTerrainIds = new Set(
            placements.map((p) => p.Position.terrainId)
        );

        // Clear the referenced terrains of entities/items that aren't part of
        // this scenario. Scenario entities are kept (matched by instance Id) and
        // merely repositioned by the placement loop below — even one already on
        // its target terrain is preserved, not despawned-and-respawned. Entities
        // on unreferenced terrains are left untouched, and characters are never
        // despawned: a character active now but not in the scenario stays put.
        campaign.GameState.Entities = campaign.GameState.Entities.filter(
            (e) =>
                placedInstanceIds.has(e.Id) ||
                !referencedTerrainIds.has(e.Position.terrainId)
        );

        // Apply placements — relocate what is present, re-create what is not.
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

        // Set scene images
        campaign.GameState.Scene = { ...scenario.Scene };

        // Set audio (filter to only existing tracks)
        campaign.GameState.Audio = scenario.AudioPlaylist.filter((id) =>
            campaign.Audios.some((a) => a.Id === id)
        );

        // Hydrate every terrain the scenario placed actors on, then validate all
        // placements against their terrain geometry (per-terrain repair pass).
        for (const terrainId of referencedTerrainIds) {
            if (campaign.VoxelTerrains.some((t) => t.Id === terrainId)) {
                await TerrainStorageService.hydrateTerrain(campaign, terrainId);
            }
        }
        VoxelTerrainUtils.repairActors(context);

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
        const campaign = CampaignUtils.getActiveCampaign(context);

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
        const campaign = CampaignUtils.getActiveCampaign(context);

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
        const campaign = CampaignUtils.getActiveCampaign(context);

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
