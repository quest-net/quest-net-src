// domains/Entity/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { EntityEdit } from "./Edit";
import { IndexView, IndexViewItem, SelectionAction } from "../../components/IndexView/IndexView";
import { replacePathTag } from "../../utils/FolderUtils";
import { ObjectPicker, ObjectTypeConfig } from "../../components/inputs/ObjectPicker";
import { useViewedTerrain } from "../../components/Map/useViewedTerrain";

export function EntityIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const { viewedTerrainId } = useViewedTerrain();

	// Add a counter to force new keys on each create
	const [createCounter, setCreateCounter] = useState(0);

	// Object picker state
	const [showObjectPicker, setShowObjectPicker] = useState(false);
	const [selectedActorIds, setSelectedActorIds] = useState<string[]>([]);

	const handleSpawn = (entityId: string) => {
		if (!actionService) return;

		actionService.execute("entity:spawn", {
			entityId: entityId,
			terrainId: viewedTerrainId ?? "",
		});
	};

	const handleBulkUpdateItemTags = (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => {
		if (!actionService) return;

		actionService.execute("entity:bulkEditTags", {
			updates: updates.map((update) => ({
				entityId: update.itemId,
				tags: update.newTags,
			})),
		});
	};

	// Handle Give Objects selection action
	const handleGiveObjectsClick = (selectedIds: string[]) => {
		setSelectedActorIds(selectedIds);
		setShowObjectPicker(true);
	};

	const handleGiveObjects = (
		objectIds: string[],
		objectType: string,
		count: number
	) => {
		if (!actionService || selectedActorIds.length === 0) return;

		// Call the appropriate give action based on object type
		actionService.execute(`${objectType}:give`, {
			[`${objectType}Ids`]: objectIds,
			actorIds: selectedActorIds,
			count: count,
		});

		// Close picker and clear selection
		setShowObjectPicker(false);
		setSelectedActorIds([]);
	};

	// Define selection actions
	const selectionActions: SelectionAction[] = [
		{
			label: "Give Objects",
			icon: "icon-[mdi--gift]",
			onClick: handleGiveObjectsClick,
			variant: "primary",
			requiresSelection: true,
		},
	];

	// Prepare object types for ObjectPicker
	const objectTypes: ObjectTypeConfig<any>[] = [
		{
			label: "Items",
			items: campaign.ItemTemplates,
			icon: "icon-[mdi--sack]",
			typeKey: "item",
		},
		{
			label: "Skills",
			items: campaign.SkillTemplates,
			icon: "icon-[mdi--star]",
			typeKey: "skill",
		},
		{
			label: "Statuses",
			items: campaign.StatusTemplates,
			icon: "icon-[mdi--heart-pulse]",
			typeKey: "status",
		},
	];

	const items: IndexViewItem[] = campaign.EntityTemplates.map((entity) => ({
		id: entity.Id,
		label: entity.Name,
		details: entity.Description,
		imageId: entity.Image,
		tags: entity.Tags || [],
		action: {
			label: "Spawn",
			icon: "icon-[mdi--play]",
			onClick: () => handleSpawn(entity.Id),
		},
	}));

	return (
		<>
			<IndexView
				items={items}
				title="Entity Templates"
				sortKey="entities-sort"
				description="Manage your entity templates"
				createLabel="Create Entity"
				onCreateClick={() => setCreateCounter((prev) => prev + 1)}
				searchEnabled={true}
				searchPlaceholder="Search entities by name..."
				emptyMessage="No entities yet. Create one to get started!"
				onBulkUpdateItemTags={handleBulkUpdateItemTags}
				selectionActions={selectionActions}
				renderEditForm={(item, { currentPath, closeDrawer }) => {
					const entity = item
						? campaign.EntityTemplates.find((e) => e.Id === item.id)
						: undefined;

					const initialTags =
						currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

					return (
						<EntityEdit
							key={item?.id || `create-${createCounter}`}
							entity={entity}
							initialTags={initialTags}
							onClose={() => closeDrawer?.()}
						/>
					);
				}}
			/>

			{/* Object Picker Modal */}
			<ObjectPicker
				isOpen={showObjectPicker}
				types={objectTypes}
				multiSelect={true}
				showCount={true}
				onConfirm={handleGiveObjects}
				onCancel={() => {
					setShowObjectPicker(false);
					setSelectedActorIds([]);
				}}
				title="Give Objects to Selected Entities"
			/>
		</>
	);
}
