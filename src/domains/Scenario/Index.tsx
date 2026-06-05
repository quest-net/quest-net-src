// domains/Scenario/Index.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ScenarioEdit } from "./Edit";
import { countPlacements } from "./Scenario";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { replacePathTag } from "../../utils/FolderUtils";
import { useViewedTerrain } from "../../components/Map/useViewedTerrain";

export function ScenarioIndex() {
    const context = useQuestContext();
    const { actionService } = useActionService();
    const campaign = CampaignActions.getActiveCampaign(context);
    const { setViewedTerrain } = useViewedTerrain();

    const handleLoad = (scenarioId: string) => {
        if (!actionService) return;

        actionService.execute("scenario:load", {
            scenarioId: scenarioId,
        });

        // Focus the DM's view on the terrain of the scenario's first character
        // placement (falling back to the first placement of any type).
        const scenario = campaign.Scenarios.find((s) => s.Id === scenarioId);
        const placements = scenario?.ActorPlacements ?? [];
        const focus =
            placements.find((p) => p.Type === "character") ?? placements[0];
        if (focus?.Position.terrainId) {
            setViewedTerrain(focus.Position.terrainId);
        }
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

    const items: IndexViewItem[] = campaign.Scenarios.map((scenario) => {
        const counts = countPlacements(scenario.ActorPlacements ?? []);
        return {
        id: scenario.Id,
        label: scenario.Name,
        icon: "icon-[mdi--map-marker-multiple]",
        iconColor: "#10b981",
        details: `${counts.characters} characters, ${counts.entities} entities, ${counts.items} items`,
        tags: scenario.Tags || [],
        action: {
            label: "Load",
            icon: "icon-[mdi--play]",
            onClick: () => handleLoad(scenario.Id),
        },
        };
    });

    return (
        <>
            {/* Scenario List */}
            <IndexView
                items={items}
                title="Saved Scenarios"
                sortKey="scenarios-sort"
                description="Quick-load pre-configured game states"
                searchEnabled={true}
                searchPlaceholder="Search scenarios by name..."
                emptyMessage="No scenarios yet. Use the camera button on the map toolbar to capture one."
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
