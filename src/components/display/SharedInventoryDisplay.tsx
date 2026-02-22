// components/display/SharedInventoryDisplay.tsx

import { useState } from "react";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { SharedInventory } from "../../domains/CampaignSetting/CampaignSetting";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { StatBar } from "../../components/StatBar/StatBar";
import { ItemSlotDisplay } from "../../domains/Item/ItemSlotDisplay";
import { StatTransferModal } from "../../components/modals/StatTransferModal";

interface SharedInventoryDisplayProps {
    inventory: SharedInventory;
}

export function SharedInventoryDisplay({
    inventory,
}: SharedInventoryDisplayProps) {
    const context = useQuestContext();
    const { actionService } = useActionService();
    const campaign = CampaignActions.getActiveCampaign(context);

    const [editingMaxStats, setEditingMaxStats] = useState(false);
    const [transferStat, setTransferStat] = useState<any>(null); // Uses any because StatDefinition uses Current instead of Value

    // --- Handlers ---
    const handleStatChange = (statId: string, field: "Current" | "Max", value: number) => {
        if (!actionService) return;

        actionService.execute("sharedInventory:editStat", {
            inventoryId: inventory.Id,
            statId: statId,
            updates: { [field]: value }
        });
    };

    const handleTransferStat = (targetId: string, amount: number) => {
        if (!actionService || !transferStat) return;

        actionService.execute("sharedInventory:transferStat", {
            sourceInventoryId: inventory.Id,
            sourceStatId: transferStat.Id,
            targetId,
            targetStatId: transferStat.Id, // Assuming same stat ID for simplicity
            amount,
        });
    };

    return (
        <div className="card bg-base-100 border-2 border-base-300 transition-all mb-4">
            <div className="card-body p-4">
                <h3 className="font-bold text-lg flex items-center gap-2 mb-4 pb-2 border-b border-base-300">
                    <span className="icon-[mdi--treasure-chest] w-5 h-5 text-primary" />
                    {inventory.Name}
                </h3>

                {/* Shared Stats */}
                {inventory.Stats.length > 0 && (
                    <div className="mb-4">
                        <div className="flex items-center justify-between mb-2">
                            <h3 className="font-semibold text-sm opacity-70 flex items-center gap-1">
                                Pools
                            </h3>
                            {context.User.Role === "dm" && (
                                <button
                                    className={`btn btn-xs btn-circle ${editingMaxStats ? "btn-primary" : "btn-ghost"
                                        }`}
                                    onClick={() => setEditingMaxStats(!editingMaxStats)}
                                    title={editingMaxStats ? "Hide max stat controls" : "Edit max stats"}
                                >
                                    <span className="icon-[mdi--cog] w-4 h-4" />
                                </button>
                            )}
                        </div>

                        <div className="space-y-3">
                            {inventory.Stats.map((stat) => (
                                <StatBar
                                    key={stat.Id}
                                    stat={stat}
                                    editingMax={editingMaxStats && context.User.Role === "dm"}
                                    onCurrentChange={(value) =>
                                        handleStatChange(stat.Id, "Current", value)
                                    }
                                    onMaxChange={(value) => handleStatChange(stat.Id, "Max", value)}
                                    onTransfer={() => setTransferStat({
                                        Id: stat.Id,
                                        Name: stat.Name,
                                        Color: stat.Color,
                                        Max: stat.Max,
                                        Current: stat.Current,
                                    })}
                                />
                            ))}
                        </div>
                    </div>
                )}

                {/* Shared Items */}
                <div className="pt-2 border-t border-base-300">
                    <div className="flex items-center justify-between mb-3 mt-2">
                        <h3 className="font-semibold text-sm opacity-70 flex items-center gap-1">
                            Items
                        </h3>
                    </div>

                    {inventory.Inventory.length === 0 ? (
                        <div className="text-center py-4 opacity-50 italic text-sm">
                            Empty
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {inventory.Inventory.map((slot, index) => {
                                const template = campaign.ItemTemplates.find(
                                    (t) => t.Id === slot.Id
                                );
                                if (!template) return null;

                                return (
                                    <ItemSlotDisplay
                                        key={slot.Id + index}
                                        isOpen={false}
                                        onClose={() => { }}
                                        slot={slot}
                                        actor={{ Id: inventory.Id, Name: inventory.Name, Inventory: inventory.Inventory, Equipment: [], Stats: inventory.Stats } as any}
                                        mode="shared-inventory"
                                    />
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Transfer Modal */}
            {transferStat && (
                <StatTransferModal
                    isOpen={!!transferStat}
                    onClose={() => setTransferStat(null)}
                    sourceActorId={inventory.Id}
                    sourceStat={transferStat}
                    onTransfer={handleTransferStat}
                />
            )}
        </div>
    );
}
