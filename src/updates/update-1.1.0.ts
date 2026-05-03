import { CampaignSettingActions } from "../domains/CampaignSetting/CampaignSettingActions";
import { Context } from "../domains/Context/Context";
import { VersionedMigration } from "./types";

export const migration_1_1_0: VersionedMigration = {
    version: "1.1.0",
    update: (context: Context): Context => {
        // Initialize ActionDefinitions if they don't exist
        const updatedCampaigns = context.Campaigns.map(campaign => {
            let settings = campaign.Settings;

            if (!settings.ActionDefinitions) {
                // Get default definitions from the factory
                const defaults = CampaignSettingActions.createDefault().ActionDefinitions;
                settings = {
                    ...settings,
                    ActionDefinitions: defaults,
                };
            }

            // Helper to update actors
            const updateActor = (actor: any) => {
                if (!actor.Actions) {
                    // Safe check to ensure ActionDefinitions exist before mapping
                    const actionDefs = settings.ActionDefinitions || [];
                    return {
                        ...actor,
                        // Initialize Actions from definitions
                        Actions: actionDefs.map((def: any) => ({
                            ...def,
                            Current: (def as any).Default
                        })),
                    };
                }
                return actor;
            };

            // Update Character Roster
            const updatedRoster = campaign.CharacterRoster.map(updateActor);

            // Update GameState Characters
            const updatedGSCharacters = campaign.GameState.Characters.map(updateActor);

            // Update Entity Templates
            const updatedTemplates = campaign.EntityTemplates.map(updateActor);

            // Update GameState Entities
            const updatedGSEntities = campaign.GameState.Entities.map(updateActor);

            return {
                ...campaign,
                Settings: settings,
                CharacterRoster: updatedRoster,
                EntityTemplates: updatedTemplates,
                GameState: {
                    ...campaign.GameState,
                    Characters: updatedGSCharacters,
                    Entities: updatedGSEntities,
                },
            };
        });

        return {
            ...context,
            Campaigns: updatedCampaigns,
            version: "1.1.0",
        };
    },
    reset: (context: Context): Context => {
        // Downgrade: remove ActionDefinitions and Actions arrays
        const downgradedCampaigns = context.Campaigns.map(campaign => {
            // Remove ActionDefinitions
            const { ActionDefinitions, ...restSettings } = campaign.Settings;

            // Helper to downgrade actors
            const downgradeActor = (actor: any) => {
                const { Actions, ...rest } = actor;
                return rest;
            };

            // Remove Actions from Roster
            const downgradedRoster = campaign.CharacterRoster.map(downgradeActor);

            // Remove Actions from GameState Characters
            const downgradedGSCharacters = campaign.GameState.Characters.map(downgradeActor);

            // Remove Actions from Templates
            const downgradedTemplates = campaign.EntityTemplates.map(downgradeActor);

            // Remove Actions from GameState Entities
            const downgradedGSEntities = campaign.GameState.Entities.map(downgradeActor);

            return {
                ...campaign,
                Settings: restSettings,
                CharacterRoster: downgradedRoster,
                EntityTemplates: downgradedTemplates,
                GameState: {
                    ...campaign.GameState,
                    Characters: downgradedGSCharacters,
                    Entities: downgradedGSEntities,
                },
            } as any;
        });

        return {
            ...context,
            Campaigns: downgradedCampaigns,
            version: "1.0.7", // Assuming previous version was 1.0.7
        };
    },
};
