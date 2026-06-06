import { useState } from "react";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { replacePathTag } from "../../utils/FolderUtils";
import { CampaignActions } from "../Campaign/CampaignActions";
import { useQuestContext } from "../Context/ContextProvider";
import { VoxelTerrainActions } from "../VoxelTerrain/VoxelTerrainActions";
import { TerrainEdit } from "./Edit";
import { useViewedTerrain } from "../../components/Map/useViewedTerrain";

export function TerrainIndex({
	onViewTerrain,
}: {
	/** Called after the DM picks a terrain to view, so the parent can switch
	 *  back to the Main tab and show it. */
	onViewTerrain?: () => void;
} = {}) {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const { viewedTerrainId, setViewedTerrain } = useViewedTerrain();
	const effectiveViewedTerrainId = viewedTerrainId ?? undefined;

	const [createCounter, setCreateCounter] = useState(0);

	const handleBulkUpdateItemTags = (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => {
		if (!actionService) return;

		actionService.execute("terrain:bulkEditTags", {
			updates: updates.map((update) => ({
				terrainId: update.itemId,
				tags: update.newTags,
			})),
		});
	};

	// "View Terrain" is purely local UI state — it switches which terrain the DM
	// is looking at (and which terrain spawns target). It does not broadcast or
	// move any actor.
	// Also jump to the Main tab so the DM immediately sees the terrain they
	// just selected to view.
	const handleView = (terrainId: string) => {
		setViewedTerrain(terrainId);
		onViewTerrain?.();
	};

	const items: IndexViewItem[] = campaign.VoxelTerrains.map((terrain) => {
		const isViewing = effectiveViewedTerrainId === terrain.Id;

		return {
			id: terrain.Id,
			label: terrain.Name,
			details: `${terrain.Width}x${terrain.Length}${terrain.VoxelCount !== undefined ? ` - ${terrain.VoxelCount.toLocaleString()} voxels` : ""}${isViewing ? " - Viewing" : ""}`,
			icon: "icon-[mdi--terrain]",
			iconColor: terrain.PreviewColor,
			tags: terrain.Tags || [],
			action: isViewing
				? undefined
				: {
					label: "View",
					icon: "icon-[mdi--eye]",
					onClick: () => handleView(terrain.Id),
				},
		};
	});

	return (
		<IndexView
			items={items}
			title="Terrains"
			sortKey="terrain-sort"
			description="Manage campaign terrains and maps"
			createLabel="Create Terrain"
			onCreateClick={() => setCreateCounter((prev) => prev + 1)}
			searchEnabled={true}
			searchPlaceholder="Search terrains by name..."
			emptyMessage="No terrains yet. Create one to get started!"
			onBulkUpdateItemTags={handleBulkUpdateItemTags}
			editFormFullWidth
			renderEditForm={(item, { currentPath, closeDrawer }) => {
				const terrain = item
					? campaign.VoxelTerrains.find((t) => t.Id === item.id)
					: undefined;
				const initialTags =
					currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

				return (
					<TerrainEdit
						key={item?.id || `create-${createCounter}`}
						terrain={terrain}
						isDeleteProtected={
							terrain
								? VoxelTerrainActions.isDeleteProtected(campaign, terrain.Id)
								: false
						}
						initialTags={initialTags}
						onClose={() => closeDrawer?.()}
					/>
				);
			}}
		/>
	);
}
