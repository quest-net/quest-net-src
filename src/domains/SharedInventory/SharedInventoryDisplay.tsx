// components/display/SharedInventoryDisplay.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { SharedInventory } from "../CampaignSetting/CampaignSetting";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { StatBar } from "../../components/widgets/StatBar";
import { ItemSlotDisplay } from "../Item/ItemSlotDisplay";
import { ActorPicker } from "../../components/pickers/ActorPicker";
import { ToggleButton } from "../../components/ui/ToggleButton";
import { resolveStats } from "../Actor/ActorResolvers";
import { EmptyState } from "../../components/ui/EmptyState";

interface SharedInventoryDisplayProps {
    inventory: SharedInventory;
}

export function SharedInventoryDisplay({
    inventory,
}: SharedInventoryDisplayProps) {
    const context = useQuestContext();
    const { actionService } = useActionService();
    const campaign = CampaignUtils.getActiveCampaign(context);

    const [editingMaxStats, setEditingMaxStats] = useState(false);
    const [showUnsetStats, setShowUnsetStats] = useState(false);
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
                {inventory.Stats.length > 0 && (() => {
                    const resolved = resolveStats(inventory.Stats, campaign.Settings.StatDefinitions);
                    const unsetCount = resolved.filter((s) => s.Current === null).length;
                    const hasAnySet = resolved.some((s) => s.Current !== null);

                    return (
                        <div className="mb-4">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-semibold text-sm opacity-70 flex items-center gap-1">
                                    Pools
                                </h3>
                                <div className="flex items-center gap-1">
                                    {context.User.Role === "dm" && unsetCount > 0 && (
                                        <ToggleButton
                                            active={showUnsetStats}
                                            kind="independent"
                                            quiet
                                            className="btn-xs"
                                            onClick={() => setShowUnsetStats(!showUnsetStats)}
                                            title={
                                                showUnsetStats
                                                    ? "Hide unset stats"
                                                    : `Show ${unsetCount} unset stat${unsetCount === 1 ? "" : "s"}`
                                            }
                                        >
                                            <span className="icon-[mdi--eye-outline] w-4 h-4" />
                                            <span className="ml-1 text-xs">{unsetCount} unset</span>
                                        </ToggleButton>
                                    )}
                                    {context.User.Role === "dm" && (
                                        <ToggleButton
                                            active={editingMaxStats}
                                            kind="independent"
                                            quiet
                                            className="btn-xs btn-circle"
                                            onClick={() => setEditingMaxStats(!editingMaxStats)}
                                            title={editingMaxStats ? "Hide max stat controls" : "Edit max stats"}
                                        >
                                            <span className="icon-[mdi--cog] w-4 h-4" />
                                        </ToggleButton>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3">
                                {resolved.map((stat) => {
                                    // Unset stats are normally hidden. When the DM toggles
                                    // "show unset" they render as a compact row with an
                                    // Enable button so they can be re-added to the pool.
                                    if (stat.Current === null) {
                                        if (!showUnsetStats || context.User.Role !== "dm") return null;
                                        return (
                                            <div
                                                key={stat.Id}
                                                className="flex items-center gap-2 p-2 border border-dashed border-base-300 rounded opacity-70"
                                            >
                                                <div
                                                    className="w-3 h-3 rounded-full shrink-0"
                                                    style={{ backgroundColor: stat.Color }}
                                                />
                                                <span className="flex-1 text-sm font-medium">{stat.Name}</span>
                                                <span className="text-xs italic opacity-70">unset</span>
                                                <button
                                                    className="btn btn-xs btn-outline"
                                                    onClick={() =>
                                                        handleStatChange(stat.Id, "Current", stat.Max)
                                                    }
                                                    title="Enable this stat on the inventory (sets Current = Max)"
                                                >
                                                    Enable
                                                </button>
                                            </div>
                                        );
                                    }

                                    return (
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
                                    );
                                })}
                                {!hasAnySet && !showUnsetStats && (
                                    <EmptyState compact>
                                        No pools currently tracked.
                                    </EmptyState>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {/* Shared Items */}
                <div className="pt-2 border-t border-base-300">
                    <div className="flex items-center justify-between mb-3 mt-2">
                        <h3 className="font-semibold text-sm opacity-70 flex items-center gap-1">
                            Items
                        </h3>
                    </div>

                    {inventory.Inventory.length === 0 ? (
                        <EmptyState compact>Empty</EmptyState>
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
                                        <span className="icon-[mdi--package-variant] w-4 h-4 opacity-70" />
                                        <span className="flex-1 text-left text-sm">{template.Name}</span>
                                        {usesText && <span className="text-xs opacity-70">{usesText}</span>}
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
                    amountMax={transferStat.Current ?? 0}
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
