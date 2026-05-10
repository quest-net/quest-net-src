import { useState } from "react";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { replacePathTag } from "../../utils/FolderUtils";
import { getMostCommonVoxelTerrainColor } from "../../utils/VoxelTerrainEditorUtils";
import { CampaignActions } from "../Campaign/CampaignActions";
import { useQuestContext } from "../Context/ContextProvider";
import { TerrainEdit } from "./Edit";
import { TerrainStorageService } from "../../services/TerrainStorageService";

export function TerrainIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);

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

	const handleSetActive = (terrainId: string) => {
		if (!actionService) return;

		actionService.execute("terrain:setActive", {
			terrainId,
		});
	};

	const items: IndexViewItem[] = campaign.VoxelTerrains.map((terrain) => {
		const isActive = campaign.GameState.VoxelTerrainId === terrain.Id;

		return {
			id: terrain.Id,
			label: terrain.Name,
			details: `${terrain.Width}x${terrain.Length}${terrain.VoxelCount !== undefined ? ` - ${terrain.VoxelCount.toLocaleString()} voxels` : ""}${isActive ? " - Active" : ""}`,
			icon: "icon-[mdi--terrain]",
			iconColor: TerrainStorageService.isHydrated(terrain)
				? getMostCommonVoxelTerrainColor(terrain)
				: terrain.PreviewColor,
			tags: terrain.Tags || [],
			action: isActive
				? undefined
				: {
					label: "Activate",
					icon: "icon-[mdi--play]",
					onClick: () => handleSetActive(terrain.Id),
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
				const isActive = terrain?.Id === campaign.GameState.VoxelTerrainId;
				const initialTags =
					currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

				return (
					<TerrainEdit
						key={item?.id || `create-${createCounter}`}
						terrain={terrain}
						isDeleteProtected={isActive}
						initialTags={initialTags}
						onClose={() => closeDrawer?.()}
					/>
				);
			}}
		/>
	);
}
