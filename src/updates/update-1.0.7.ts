import { Context } from "../domains/Context/Context";
import { VersionedMigration } from "./types";

export const migration_1_0_7: VersionedMigration = {
    version: "1.0.7",
    update: (context: Context): Context => {
        // Add Scenarios array to all campaigns that don't have it
        const updatedCampaigns = context.Campaigns.map(campaign => {
            // Check if campaign already has Scenarios array
            if ((campaign as any).Scenarios !== undefined) {
                return campaign;
            }

            return {
                ...campaign,
                Scenarios: [],
            };
        });

        return {
            ...context,
            Campaigns: updatedCampaigns,
            version: "1.0.7",
        };
    },
    reset: (context: Context): Context => {
        // Downgrade: remove Scenarios from campaigns
        const downgradedCampaigns = context.Campaigns.map(campaign => {
            const { Scenarios, ...rest } = campaign as any;
            return rest;
        });

        return {
            ...context,
            Campaigns: downgradedCampaigns,
            version: "1.0.6",
        };
    },
};
