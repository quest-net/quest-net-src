// components/display/SharedInventoryDisplay.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { SharedInventory } from "../CampaignSetting/CampaignSetting";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { StatBar } from "../../components/StatBar/StatBar";
import { ItemSlotDisplay } from "../Item/ItemSlotDisplay";
import { ActorPicker } from "../../components/inputs/ActorPicker";

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
    const [isDrawerOpen, setDrawerOpen] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<any>(null);

    // --- Handlers ---
    const handleStatChange = (statId: string, field: "Current" | "Max", value: number) => {
        if (!actionService) return;

        actionService.execute("sharedInventory:editStat", {
            inventoryId: inventory.Id,
            statId: statId,
            updates: { [field]: value }
        });
    };

    const handleTransferStat = (targetId: string, amount?: number) => {
        if (!actionService || !transferStat || !amount) return;

        actionService.execute("sharedInventory:transferStat", {
            sourceInventoryId: inventory.Id,
            sourceStatId: transferStat.Id,
            targetId,
            targetStatId: transferStat.Id,
            amount,
        });
        setTransferStat(null);
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

                                const usesText =
                                    slot.UsesLeft !== undefined
                                        ? `${slot.UsesLeft}/${template.MaxUses || "∞"} uses`
                                        : "";

                                return (
                                    <button
                                        key={slot.Id + index}
                                        className="btn btn-ghost w-full justify-start gap-2 h-auto py-2 px-3"
                                        onClick={() => {
                                            setSelectedSlot(slot);
                                            setDrawerOpen(true);
                                        }}
                                    >
                                        <span className="icon-[mdi--package-variant] w-4 h-4 opacity-60" />
                                        <span className="flex-1 text-left text-sm">{template.Name}</span>
                                        {usesText && <span className="text-xs opacity-50">{usesText}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Stat Transfer Picker */}
            {transferStat && (
                <ActorPicker
                    isOpen={!!transferStat}
                    onConfirm={handleTransferStat}
                    onCancel={() => setTransferStat(null)}
                    title={`Transfer ${transferStat.Name}`}
                    excludeActorId={inventory.Id}
                    includeSharedInventories={true}
                    showAmount={true}
                    amountMax={transferStat.Current ?? transferStat.Max}
                />
            )}

            {/* Item Slot Display Drawer */}
            {selectedSlot && (
                <ItemSlotDisplay
                    isOpen={isDrawerOpen}
                    onClose={() => {
                        setDrawerOpen(false);
                        setTimeout(() => setSelectedSlot(null), 300);
                    }}
                    slot={selectedSlot}
                    actor={{ Id: inventory.Id, Name: inventory.Name, Inventory: inventory.Inventory, Equipment: [], Stats: inventory.Stats } as any}
                    mode="shared-inventory"
                />
            )}
        </div>
    );
}
