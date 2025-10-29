// domains/Terrain/Index.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { TerrainEdit } from "./Edit";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { useState } from "react";
import { Terrain, TerrainType, TERRAIN_COLORS } from "./Terrain";
import { replacePathTag } from "../../utils/FolderUtils";

/**
 * Calculates the most common terrain type in a ColorMap
 * and returns its corresponding hex color
 */
function getMostCommonTerrainColor(terrain: Terrain): string {
	const colorCounts: Record<TerrainType, number> = {
		green: 0,
		white: 0,
		blue: 0,
		yellow: 0,
		brown: 0,
		red: 0,
		grey: 0,
		black: 0,
	};

	// Count occurrences of each color
	for (let y = 0; y < terrain.Length; y++) {
		for (let x = 0; x < terrain.Width; x++) {
			const terrainType = terrain.ColorMap[y][x];
			colorCounts[terrainType]++;
		}
	}

	// Find the most common color
	let mostCommonType: TerrainType = "green";
	let maxCount = 0;

	for (const [type, count] of Object.entries(colorCounts)) {
		if (count > maxCount) {
			maxCount = count;
			mostCommonType = type as TerrainType;
		}
	}
	if (mostCommonType == "white") return "black";
	return TERRAIN_COLORS[mostCommonType];
}

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
			terrainId: terrainId,
		});
	};

	const items: IndexViewItem[] = campaign.Terrains.map((terrain) => {
		const isActive = campaign.GameState.TerrainId === terrain.Id;
		const isDefault = terrain.Id === "DEFAULT_TERRAIN";

		return {
			id: terrain.Id,
			label: terrain.Name,
			details: `${terrain.Width}×${terrain.Length}${
				isActive ? " • Active" : ""
			}${isDefault ? " • Default" : ""}`,
			// Use terrain icon with the most common color from the terrain
			icon: "icon-[mdi--terrain]",
			iconColor: getMostCommonTerrainColor(terrain),
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
			description="Manage campaign terrains and maps"
			createLabel="Create Terrain"
			onCreateClick={() => setCreateCounter((prev) => prev + 1)}
			searchEnabled={true}
			searchPlaceholder="Search terrains by name..."
			emptyMessage="No terrains yet. Create one to get started!"
			onBulkUpdateItemTags={handleBulkUpdateItemTags}
			renderEditForm={(item, { currentPath, closeDrawer }) => {
				const terrain = item
					? campaign.Terrains.find((t) => t.Id === item.id)
					: undefined;

				const initialTags =
					currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;
				// Check if trying to edit default terrain
				const isDefault = terrain?.Id === "DEFAULT_TERRAIN";

				return (
					<TerrainEdit
						key={item?.id || `create-${createCounter}`}
						terrain={terrain}
						isDefault={isDefault}
						initialTags={initialTags}
						onClose={() => closeDrawer?.()}
					/>
				);
			}}
		/>
	);
}
