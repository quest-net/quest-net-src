// domains/Character/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { CharacterEdit } from "./Edit";
import { IndexView, IndexViewItem, SelectionAction } from "../../components/IndexView/IndexView";
import { replacePathTag } from "../../utils/FolderUtils";
import { ObjectPicker, ObjectTypeConfig } from "../../components/pickers/ObjectPicker";
import { useViewedTerrain } from "../../components/Map/useViewedTerrain";

export function CharacterIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);
	const { viewedTerrainId } = useViewedTerrain();

	// Add a counter to force new keys on each create
	const [createCounter, setCreateCounter] = useState(0);

	// Object picker state
	const [showObjectPicker, setShowObjectPicker] = useState(false);
	const [selectedActorIds, setSelectedActorIds] = useState<string[]>([]);

	const handleSpawn = (characterId: string) => {
		if (!actionService) return;

		actionService.execute("character:spawn", {
			characterId: characterId,
			terrainId: viewedTerrainId ?? "",
		});
	};

	const handleBulkUpdateItemTags = (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => {
		if (!actionService) return;

		actionService.execute("actor:bulkEditTags", {
			updates: updates.map((update) => ({
				actorId: update.itemId,
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

	const items: IndexViewItem[] = campaign.CharacterRoster.map((character) => ({
		id: character.Id,
		label: character.Name,
		details: character.Description,
		imageId: character.Image,
		tags: character.Tags || [],
		action: {
			label: "Spawn",
			icon: "icon-[mdi--play]",
			onClick: () => handleSpawn(character.Id),
		},
	}));

	return (
		<>
			<IndexView
				items={items}
				title="Character Roster"
				sortKey="characters-sort"
				description="Manage your character roster"
				createLabel="Create Character"
				onCreateClick={() => setCreateCounter((prev) => prev + 1)}
				searchEnabled={true}
				searchPlaceholder="Search characters by name..."
				emptyMessage="No characters yet. Create one to get started!"
				onBulkUpdateItemTags={handleBulkUpdateItemTags}
				selectionActions={selectionActions}
				renderEditForm={(item, { currentPath, closeDrawer }) => {
					const character = item
						? campaign.CharacterRoster.find((c) => c.Id === item.id)
						: undefined;

					const initialTags =
						currentPath.length > 0 ? replacePathTag([], currentPath) : undefined;

					return (
						<CharacterEdit
							key={item?.id || `create-${createCounter}`}
							character={character}
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
				title="Give Objects to Selected Characters"
			/>
		</>
	);
}
