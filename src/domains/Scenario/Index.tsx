// domains/Scenario/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ScenarioEdit } from "./Edit";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { replacePathTag } from "../../utils/FolderUtils";

export function ScenarioIndex() {
    const context = useQuestContext();
    const { actionService } = useActionService();
    const campaign = CampaignActions.getActiveCampaign(context);

    const [captureName, setCaptureName] = useState("");

    // Check if scenario with this name already exists
    const existingScenario = campaign.Scenarios.find(
        (s) => s.Name.toLowerCase() === captureName.toLowerCase().trim()
    );

    const handleLoad = (scenarioId: string) => {
        if (!actionService) return;

        actionService.execute("scenario:load", {
            scenarioId: scenarioId,
        });
    };

    const handleCapture = () => {
        if (!actionService || !captureName.trim()) return;

        actionService.execute("scenario:capture", {
            name: captureName.trim(),
        });

        setCaptureName("");
    };

    const handleBulkUpdateItemTags = (
        updates: Array<{ itemId: string; newTags: string[] }>
    ) => {
        if (!actionService) return;

        actionService.execute("scenario:bulkEditTags", {
            updates: updates.map((update) => ({
                scenarioId: update.itemId,
                tags: update.newTags,
            })),
        });
    };

    const items: IndexViewItem[] = campaign.Scenarios.map((scenario) => ({
        id: scenario.Id,
        label: scenario.Name,
        icon: "icon-[mdi--map-marker-multiple]",
        iconColor: "#10b981",
        details: `${scenario.EntityPlacements.length} entities, ${scenario.SpawnPositions.length} spawn points`,
        tags: scenario.Tags || [],
        action: {
            label: "Load",
            icon: "icon-[mdi--play]",
            onClick: () => handleLoad(scenario.Id),
        },
    }));

    return (
        <>
            {/* Capture Section */}
            <div className="card border-2 bg-base-100 m-6">
                <div className="card-body">
                    <h3 className="card-title text-lg">
                        <span className="icon-[mdi--camera] w-5 h-5" />
                        Capture Current State
                    </h3>
                    <p className="text-sm opacity-70 mb-4">
                        Save the current terrain, entities, audio, scene images, and character positions as a scenario.
                    </p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={captureName}
                            onChange={(e) => setCaptureName(e.target.value)}
                            className="input input-bordered flex-1"
                            placeholder="Enter scenario name..."
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleCapture();
                            }}
                        />
                        <button
                            onClick={handleCapture}
                            disabled={!captureName.trim()}
                            className={`btn ${existingScenario ? "btn-warning" : "btn-primary"}`}
                        >
                            <span className={`w-5 h-5 ${existingScenario ? "icon-[mdi--refresh]" : "icon-[mdi--content-save]"}`} />
                            {existingScenario ? "Update" : "Create"}
                        </button>
                    </div>
                    {existingScenario && (
                        <div className="text-warning text-sm mt-2">
                            <span className="icon-[mdi--alert] w-4 h-4 inline-block mr-1" />
                            A scenario with this name already exists. Clicking "Update" will overwrite it.
                        </div>
                    )}
                </div>
            </div>

            {/* Scenario List */}
            <IndexView
                items={items}
                title="Saved Scenarios"
                sortKey="scenarios-sort"
                description="Quick-load pre-configured game states"
                searchEnabled={true}
                searchPlaceholder="Search scenarios by name..."
                emptyMessage="No scenarios yet. Capture your first one above!"
                onBulkUpdateItemTags={handleBulkUpdateItemTags}
                renderEditForm={(item, { currentPath, closeDrawer }) => {
                    const scenario = item
                        ? campaign.Scenarios.find((s) => s.Id === item.id)
                        : undefined;

                    const initialTags =
                        currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

                    return (
                        <ScenarioEdit
                            key={item?.id}
                            scenario={scenario}
                            initialTags={initialTags}
                            onClose={() => closeDrawer?.()}
                        />
                    );
                }}
            />
        </>
    );
}
