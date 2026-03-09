// components/inputs/SharedInventoriesEditor.tsx
import { useState } from "react";
import { SharedInventory } from "../../domains/CampaignSetting/CampaignSetting";
import { useFormReadOnly } from "../Form/Form";
import { useQuestContext } from "../../domains/Context/ContextProvider";
import { CampaignActions } from "../../domains/Campaign/CampaignActions";
import { RestoreRuleEditor } from "./RestoreRuleEditor";

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
                <dialog open className="modal modal-open">
                    <div className="modal-box w-11/12 max-w-5xl">
                        <h3 className="font-bold text-lg mb-4">
                            {editingInventory.Name} Stats
                        </h3>
                        <div className="space-y-2 max-h-[32rem] overflow-y-auto p-2">
                            {globalStats.map(gStat => {
                                const trackedStat = editingInventory.Stats.find(s => s.Id === gStat.Id);
                                const isTracked = !!trackedStat;

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
                                                                Name: gStat.Name,
                                                                Color: gStat.Color,
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
                                                                    s.Id === gStat.Id ? { ...s, Max: newMax } : s
                                                                )
                                                            });
                                                        }}
                                                    />
                                                </div>
                                            )}
                                        </div>

                                        {/* Restore Rule Editor for tracked stats */}
                                        {isTracked && (
                                            <div className="ml-10">
                                                <p className="text-sm font-medium mb-1 opacity-70">Restore Rules</p>
                                                <RestoreRuleEditor
                                                    value={trackedStat.RestoreRule}
                                                    readOnly={readOnly}
                                                    onChange={(rule) => {
                                                        handleChange(editingInventory.Id, {
                                                            Stats: editingInventory.Stats.map(s =>
                                                                s.Id === gStat.Id ? { ...s, RestoreRule: rule } : s
                                                            )
                                                        });
                                                    }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {globalStats.length === 0 && (
                                <div className="text-center italic opacity-60 p-4">
                                    No global stats defined in campaign settings.
                                </div>
                            )}
                        </div>
                        <div className="modal-action">
                            <button
                                onClick={() => setEditingInventoryId(null)}
                                className="btn btn-primary"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                    <form method="dialog" className="modal-backdrop">
                        <button onClick={() => setEditingInventoryId(null)}>close</button>
                    </form>
                </dialog>
            )}
        </div>
    );
}
