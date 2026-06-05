// domains/Item/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { replacePathTag } from "../../utils/FolderUtils";
import { Item } from "./Item";
import { ItemEdit } from "./Edit";
import { useViewedTerrain } from "../../components/Map/useViewedTerrain";

export function ItemIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const { viewedTerrainId } = useViewedTerrain();

	// Force a fresh key for the create drawer so it resets cleanly each time
	const [createCounter, setCreateCounter] = useState(0);

	const handleBulkUpdateItemTags = (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => {
		if (!actionService) return;

		actionService.execute("item:bulkEditTags", {
			updates: updates.map((update) => ({
				itemId: update.itemId,
				tags: update.newTags,
			})),
		});
	};

	const handleSpawnItem = (itemId: string) => {
		if (!actionService) return;

		actionService.execute("item:spawn", {
			itemId,
			terrainId: viewedTerrainId ?? "",
		});
	};

	const isDM = context.User.Role === "dm";

	const items: IndexViewItem[] = (campaign.ItemTemplates as Item[]).map(
		(it) => ({
			id: it.Id,
			label: it.Name,
			details: it.Description,
			imageId: it.Image,
			tags: it.Tags || [],
			...(isDM
				? {
						action: {
							label: "Spawn",
							icon: "icon-[mdi--map-marker-plus]",
							onClick: () => handleSpawnItem(it.Id),
						},
					}
				: {}),
		})
	);

	return (
		<IndexView
			items={items}
			title="Items"
			sortKey="items-sort"
			description="Manage your item templates"
			createLabel="Create Item"
			onCreateClick={() => setCreateCounter((prev) => prev + 1)}
			searchEnabled={true}
			searchPlaceholder="Search items by name..."
			emptyMessage="No items yet. Create one to get started!"
			onBulkUpdateItemTags={handleBulkUpdateItemTags}
			renderEditForm={(item, { currentPath, closeDrawer }) => {
				const found = item
					? (campaign.ItemTemplates as Item[]).find((i) => i.Id === item.id)
					: undefined;

				const initialTags =
					currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

				return (
					<ItemEdit
						key={item?.id || `create-${createCounter}`}
						item={found}
						initialTags={initialTags}
						onClose={() => closeDrawer?.()}
					/>
				);
			}}
		/>
	);
}
