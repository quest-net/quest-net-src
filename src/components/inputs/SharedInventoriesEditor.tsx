// components/inputs/SharedInventoriesEditor.tsx
import { useState } from "react";
import { SharedInventory } from "../../domains/CampaignSetting/CampaignSetting";
import { useFormReadOnly } from "../Form/Form";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { RestoreRuleEditor } from "./RestoreRuleEditor";
import { Modal } from "../ui/Modal";
import { EmptyState } from "../ui/EmptyState";

interface SharedInventoriesEditorProps {
    inventories: SharedInventory[];
    onChange: (inventories: SharedInventory[]) => void;
    readOnly?: boolean;
}

export function SharedInventoriesEditor({
    inventories,
    onChange,
    readOnly: readOnlyProp,
}: SharedInventoriesEditorProps) {
    const contextReadOnly = useFormReadOnly();
    const readOnly = readOnlyProp ?? contextReadOnly;
    const context = useQuestContext();
    const campaign = CampaignActions.getActiveCampaign(context);
    const globalStats = campaign.Settings.StatDefinitions || [];

    const [editingInventoryId, setEditingInventoryId] = useState<string | null>(null);

    const handleAdd = () => {
        const newInventory: SharedInventory = {
            Id: crypto.randomUUID(),
            Name: "New Shared Inventory",
            Stats: [],
            Inventory: [],
        };
        onChange([...inventories, newInventory]);
    };

    const handleDelete = (id: string) => {
        onChange(inventories.filter((i) => i.Id !== id));
    };

    const handleChange = (id: string, updates: Partial<SharedInventory>) => {
        onChange(
            inventories.map((i) => (i.Id === id ? { ...i, ...updates } : i))
        );
    };

    const editingInventory = inventories.find((i) => i.Id === editingInventoryId);

    return (
        <div className="space-y-4">
            <div className="overflow-x-auto">
                <table className="table table-sm">
                    <thead>
                        <tr>
                            <th>Name</th>
                            <th>Stats Count</th>
                            <th>Items Count</th>
                            {!readOnly && <th>Actions</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {inventories.map((inventory) => (
                            <tr key={inventory.Id}>
                                <td>
                                    <input
                                        type="text"
                                        value={inventory.Name}
                                        onChange={(e) =>
                                            handleChange(inventory.Id, { Name: e.target.value })
                                        }
                                        disabled={readOnly}
                                        className="input input-bordered input-sm w-full"
                                        placeholder="Inventory Name"
                                    />
                                </td>
                                <td>{inventory.Stats.length}</td>
                                <td>{inventory.Inventory.length}</td>
                                {!readOnly && (
                                    <td>
                                        <button
                                            onClick={() => setEditingInventoryId(inventory.Id)}
                                            className="btn btn-sm btn-ghost btn-square"
                                            title="Edit Stats"
                                        >
                                            <span className="icon-[mdi--pencil] w-5 h-5" />
                                        </button>
                                        <button
                                            onClick={() => handleDelete(inventory.Id)}
                                            className="btn btn-ghost btn-sm btn-square text-error"
                                            aria-label="Delete Inventory"
                                        >
                                            <span className="icon-[mdi--close] h-5 w-5" />
                                        </button>
                                    </td>
                                )}
                            </tr>
                        ))}
                        {inventories.length === 0 && (
                            <tr>
                                <td
                                    colSpan={readOnly ? 3 : 4}
                                    className="text-center italic text-base-content/60 py-4"
                                >
                                    No shared inventories defined.
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
            {!readOnly && (
                <button
                    onClick={handleAdd}
                    className="btn btn-sm btn-outline btn-primary"
                >
                    Add Shared Inventory
                </button>
            )}

            {/* Modal for editing Stats of a specific Shared Inventory */}
            {editingInventory && (
                <Modal
                    title={`${editingInventory.Name} Stats`}
                    onClose={() => setEditingInventoryId(null)}
                    size="xl"
                    actions={
                        <button
                            onClick={() => setEditingInventoryId(null)}
                            className="btn btn-primary"
                        >
                            Done
                        </button>
                    }
                >
                        <div className="space-y-2 max-h-[32rem] overflow-y-auto p-2">
                            {globalStats.map(gStat => {
                                const trackedStat = editingInventory.Stats.find(s => s.Id === gStat.Id);
                                const isTracked = !!trackedStat;
                                const isUnset = isTracked && trackedStat.Current === null;
                                // Effective regen: slot override if defined, else template default (may be undefined).
                                const effectiveRegen = trackedStat?.RegenRate ?? gStat.RegenRate;

                                return (
                                    <div key={gStat.Id} className="p-2 border border-base-300 rounded-lg space-y-2">
                                        <div className="flex items-center gap-4">
                                            <input
                                                type="checkbox"
                                                className="checkbox checkbox-primary"
                                                checked={isTracked}
                                                disabled={readOnly}
                                                onChange={(e) => {
                                                    if (e.target.checked) {
                                                        // Add to tracked
                                                        handleChange(editingInventory.Id, {
                                                            Stats: [...editingInventory.Stats, {
                                                                Id: gStat.Id,
                                                                Max: gStat.Max,
                                                                Current: gStat.Max
                                                            }]
                                                        });
                                                    } else {
                                                        // Remove from tracked
                                                        handleChange(editingInventory.Id, {
                                                            Stats: editingInventory.Stats.filter(s => s.Id !== gStat.Id)
                                                        });
                                                    }
                                                }}
                                            />
                                            <div className="flex-1 flex items-center gap-2">
                                                <div className="w-4 h-4 rounded-full" style={{ backgroundColor: gStat.Color }}></div>
                                                <span className="font-semibold">{gStat.Name}</span>
                                                {isUnset && (
                                                    <span className="badge badge-ghost badge-sm">unset</span>
                                                )}
                                            </div>

                                            {isTracked && (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm opacity-70">Max:</span>
                                                    <input
                                                        type="number"
                                                        className="input input-bordered input-sm w-20"
                                                        disabled={readOnly}
                                                        value={trackedStat.Max}
                                                        onChange={e => {
                                                            const newMax = Math.max(1, parseInt(e.target.value) || 1);
                                                            handleChange(editingInventory.Id, {
                                                                Stats: editingInventory.Stats.map(s =>
                                                                    s.Id === gStat.Id
                                                                        ? {
                                                                            ...s,
                                                                            Max: newMax,
                                                                            // If Current was tracking Max, keep them in sync.
                                                                            ...(s.Current !== null && s.Current === s.Max
                                                                                ? { Current: newMax }
                                                                                : {}),
                                                                        }
                                                                        : s
                                                                )
                                                            });
                                                        }}
                                                    />
                                                </div>
                                            )}

                                            {isTracked && (
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm opacity-70">Current:</span>
                                                    <input
                                                        type="number"
                                                        className="input input-bordered input-sm w-20"
                                                        disabled={readOnly}
                                                        value={trackedStat.Current ?? ""}
                                                        onChange={e => {
                                                            const raw = e.target.value;
                                                            const parsed = raw === "" ? null : Number(raw);
                                                            handleChange(editingInventory.Id, {
                                                                Stats: editingInventory.Stats.map(s =>
                                                                    s.Id === gStat.Id ? { ...s, Current: parsed } : s
                                                                )
                                                            });
                                                        }}
                                                        placeholder="unset"
                                                        min={0}
                                                        max={trackedStat.Max}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            handleChange(editingInventory.Id, {
                                                                Stats: editingInventory.Stats.map(s =>
                                                                    s.Id === gStat.Id ? { ...s, Current: null } : s
                                                                )
                                                            });
                                                        }}
                                                        disabled={readOnly || isUnset}
                                                        className="btn btn-ghost btn-sm btn-square shrink-0"
                                                        aria-label="Unset stat"
                                                        title="Unset (inventory doesn't track this stat)"
                                                    >
                                                        <span className="icon-[mdi--close] h-5 w-5" />
                                                    </button>
                                                </div>
                                            )}
                                        </div>

                                        {/* Overrides (Regen + Restore) for tracked stats */}
                                        {isTracked && (
                                            <div className="ml-10 space-y-2">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-sm font-medium opacity-70 min-w-24">
                                                        Regen / Turn
                                                    </span>
                                                    <input
                                                        type="number"
                                                        className="input input-bordered input-sm w-24"
                                                        disabled={readOnly}
                                                        value={trackedStat.RegenRate ?? ""}
                                                        onChange={(e) => {
                                                            const raw = e.target.value;
                                                            const parsed = raw === "" ? undefined : Number(raw);
                                                            handleChange(editingInventory.Id, {
                                                                Stats: editingInventory.Stats.map(s =>
                                                                    s.Id === gStat.Id ? { ...s, RegenRate: parsed } : s
                                                                )
                                                            });
                                                        }}
                                                        placeholder={
                                                            gStat.RegenRate !== undefined
                                                                ? `default: ${gStat.RegenRate}`
                                                                : "none"
                                                        }
                                                    />
                                                    {trackedStat.RegenRate !== undefined && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                handleChange(editingInventory.Id, {
                                                                    Stats: editingInventory.Stats.map(s => {
                                                                        if (s.Id !== gStat.Id) return s;
                                                                        const { RegenRate: _, ...rest } = s;
                                                                        return rest;
                                                                    })
                                                                });
                                                            }}
                                                            disabled={readOnly}
                                                            className="btn btn-ghost btn-xs"
                                                            title="Reset to campaign default"
                                                        >
                                                            Reset
                                                        </button>
                                                    )}
                                                    <span className="text-xs opacity-70">
                                                        Effective: {effectiveRegen ?? "none"}
                                                    </span>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium mb-1 opacity-70">
                                                        Restore Rules
                                                        {trackedStat.RestoreRule === undefined && gStat.RestoreRule && (
                                                            <span className="ml-2 text-xs opacity-70 italic">
                                                                (inheriting from campaign default)
                                                            </span>
                                                        )}
                                                    </p>
                                                    <RestoreRuleEditor
                                                        value={trackedStat.RestoreRule ?? gStat.RestoreRule}
                                                        readOnly={readOnly}
                                                        onChange={(rule) => {
                                                            handleChange(editingInventory.Id, {
                                                                Stats: editingInventory.Stats.map(s =>
                                                                    s.Id === gStat.Id ? { ...s, RestoreRule: rule } : s
                                                                )
                                                            });
                                                        }}
                                                    />
                                                    {trackedStat.RestoreRule !== undefined && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                handleChange(editingInventory.Id, {
                                                                    Stats: editingInventory.Stats.map(s => {
                                                                        if (s.Id !== gStat.Id) return s;
                                                                        const { RestoreRule: _, ...rest } = s;
                                                                        return rest;
                                                                    })
                                                                });
                                                            }}
                                                            disabled={readOnly}
                                                            className="btn btn-ghost btn-xs mt-1"
                                                            title="Reset to campaign default"
                                                        >
                                                            Reset to default
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {globalStats.length === 0 && (
                                <EmptyState>
                                    No global stats defined in campaign settings.
                                </EmptyState>
                            )}
                        </div>
                </Modal>
            )}
        </div>
    );
}
