// domains/SharedInventory/SharedInventoryActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";

export const SharedInventoryActions = {
    /**
     * Transfers an item slot from a shared inventory to an Actor or another Shared Inventory
     */
    transferItem(
        params: {
            sourceInventoryId: string;
            targetId: string; // Could be an ActorId or a SharedInventoryId
            itemId: string;
        },
        context: Context
    ): void {
        const campaign = CampaignActions.getActiveCampaign(context);

        // Resolve source inventory
        const sourceInv = campaign.Settings.SharedInventories?.find(
            (i) => i.Id === params.sourceInventoryId
        );
        if (!sourceInv) {
            console.error(`Source inventory ${params.sourceInventoryId} not found`);
            return;
        }

        // Find the item in source
        const sourceSlotIndex = sourceInv.Inventory.findIndex(
            (s) => s.Id === params.itemId
        );
        if (sourceSlotIndex === -1) {
            console.error(`Item ${params.itemId} not found in source inventory`);
            return;
        }

        const slotToTransfer = sourceInv.Inventory[sourceSlotIndex];
        const itemDef = campaign.ItemTemplates.find((i) => i.Id === params.itemId);

        // Resolve target
        const targetActor = [
            ...campaign.GameState.Characters,
            ...campaign.GameState.Entities,
        ].find((a) => a.Id === params.targetId);

        const targetSharedInv = campaign.Settings.SharedInventories?.find(
            (i) => i.Id === params.targetId
        );

        let targetName = "Unknown";

        if (targetActor) {
            targetName = targetActor.Name;
            targetActor.Inventory.push(slotToTransfer);
        } else if (targetSharedInv) {
            targetName = targetSharedInv.Name;
            targetSharedInv.Inventory.push(slotToTransfer);
        } else {
            console.error(`Target ${params.targetId} not found`);
            return;
        }

        // Remove from source
        sourceInv.Inventory.splice(sourceSlotIndex, 1);

        LogActions.create(
            {
                action: "Item Transferred",
                details: `${itemDef?.Name || "Item"} was transferred from ${sourceInv.Name} to ${targetName}.`,
                category: "item",
                level: "info",
                visibility: ["all"],
            },
            context
        );
    },

    /**
     * Transfers a stat amount from a shared inventory to an Actor or another Shared Inventory
     */
    transferStat(
        params: {
            sourceInventoryId: string;
            sourceStatId: string;
            targetId: string;
            targetStatId: string;
            amount: number;
        },
        context: Context
    ): void {
        const campaign = CampaignActions.getActiveCampaign(context);

        // Resolve source
        const sourceInv = campaign.Settings.SharedInventories?.find(
            (i) => i.Id === params.sourceInventoryId
        );
        if (!sourceInv) return;

        const sourceStat = sourceInv.Stats.find((s) => s.Id === params.sourceStatId);
        if (!sourceStat) return;

        // Ensure source has enough points
        const availableAmount = Math.min(
            sourceStat.Current ?? sourceStat.Max,
            params.amount
        );
        if (availableAmount <= 0) return;

        // Resolve target
        const targetActor = [
            ...campaign.GameState.Characters,
            ...campaign.GameState.Entities,
        ].find((a) => a.Id === params.targetId);

        const targetSharedInv = campaign.Settings.SharedInventories?.find(
            (i) => i.Id === params.targetId
        );

        let targetName = "Unknown";
        let transferSuccess = false;

        if (targetActor) {
            targetName = targetActor.Name;
            const tStat = targetActor.Stats.find((s) => s.Id === params.targetStatId);
            if (tStat) {
                const current = tStat.Current ?? tStat.Max;
                tStat.Current = Math.min(tStat.Max, current + availableAmount);
                transferSuccess = true;
            }
        } else if (targetSharedInv) {
            targetName = targetSharedInv.Name;
            const tStat = targetSharedInv.Stats.find((s) => s.Id === params.targetStatId);
            if (tStat) {
                const current = tStat.Current ?? tStat.Max;
                tStat.Current = Math.min(tStat.Max, current + availableAmount);
                transferSuccess = true;
            }
        }

        if (transferSuccess) {
            // Deduct from source
            const sCurrent = sourceStat.Current ?? sourceStat.Max;
            sourceStat.Current = Math.max(0, sCurrent - availableAmount);

            LogActions.create(
                {
                    action: "Stat Transferred",
                    details: `${availableAmount} ${sourceStat.Name} was transferred from ${sourceInv.Name} to ${targetName}.`,
                    category: "character",
                    level: "info",
                    visibility: ["all"],
                },
                context
            );
        }
    },

    /**
     * Edits a stat in a shared inventory (e.g. changing Current/Max values)
     */
    editStat(
        params: {
            inventoryId: string;
            statId: string;
            updates: { Current?: number; Max?: number };
        },
        context: Context
    ): void {
        const campaign = CampaignActions.getActiveCampaign(context);
        const inv = campaign.Settings.SharedInventories?.find(i => i.Id === params.inventoryId);
        if (!inv) return;

        const stat = inv.Stats.find(s => s.Id === params.statId);
        if (!stat) return;

        if (params.updates.Current !== undefined) stat.Current = params.updates.Current;
        if (params.updates.Max !== undefined) stat.Max = params.updates.Max;
    },
};
