// domains/Item/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { ItemActions } from "./ItemActions";
import { Item } from "./Item";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { RestoreRuleEditor } from "../../components/inputs/RestoreRuleEditor";
import { StatCostEditor } from "../../components/inputs/StatCostEditor";
import { ActionCostEditor } from "../../components/inputs/ActionCostEditor";

interface ItemEditProps {
	item?: Item;
	initialTags?: string[];
	onClose: () => void;
}

export function ItemEdit({ item, initialTags, onClose }: ItemEditProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();

	const defaultItem = ItemActions.createDefault(context);
	if (initialTags && !item) {
		defaultItem.Tags = initialTags;
	}
	const initialData = item || defaultItem;

	const handleSave = (data: Item) => {
		if (!actionService) return;

		if (!item) {
			// Create mode
			actionService.execute("item:create", { item: data });
		} else {
			// Edit mode
			actionService.execute("item:edit", {
				itemId: data.Id,
				updates: data,
			});
		}
	};

	const handleClone = (data: Item) => {
		if (!actionService) return;

		actionService.execute("item:create", {
			item: {
				...data,
				Id: crypto.randomUUID(),
				Name: `${data.Name} (Copy)`,
			},
		});

		onClose();
	};

	const handleDelete = () => {
		if (!actionService || !item) return;

		actionService.execute("item:delete", { itemId: item.Id });
	};

	return (
		<FormWrapper
			domain="item"
			entityId={item?.Id}
			initialData={initialData}
			onSave={handleSave}
			onClose={onClose}
			onClone={item ? handleClone : undefined}
			onDelete={item ? handleDelete : undefined}
			createTitle="Create Item"
			editTitle="Edit Item"
			viewTitle="View Item"
		>
			<ItemForm />
		</FormWrapper>
	);
}

// ============================================================================
// ITEM FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface ItemFormProps {
	data?: Item;
	onChange?: (data: Item) => void;
}

function ItemForm({ data, onChange }: ItemFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Item, value: any) => {
		onChange({
			...data,
			[field]: value,
		});
	};

	return (
		<>
			{/* Basic Info */}
			<FormSection
				title="Basic Information"
				description="Item identity and description"
			>
				<FormGrid cols={2}>
					<FormField label="Name">
						<input
							type="text"
							value={data.Name}
							onChange={(e) => handleFieldChange("Name", e.target.value)}
							className="input input-bordered w-full"
							placeholder="Item Name"
						/>
					</FormField>

					<FormField label="Image">
						<ImagePicker
							value={data.Image}
							onChange={(imageId) => handleFieldChange("Image", imageId)}
							generationContext={{
								objectType: "item",
								name: data.Name,
								description: data.Description ?? "",
							}}
						/>
					</FormField>

					<FormField label="Description" span={2}>
						<textarea
							value={data.Description || ""}
							onChange={(e) => handleFieldChange("Description", e.target.value)}
							className="textarea textarea-bordered w-full"
							rows={6}
							placeholder="Item description..."
						/>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Properties */}
			<FormSection
				title="Item Properties"
				description="Cost, usage limits, equipment, and dice behavior"
			>
				<FormGrid cols={2}>
					<FormField label="Stat Cost" span={2}>
						<StatCostEditor
							value={data.StatCost}
							onChange={(cost) => handleFieldChange("StatCost", cost)}
						/>
					</FormField>

					<FormField label="Action Cost" span={2}>
						<ActionCostEditor
							value={data.ActionCost}
							onChange={(cost) => handleFieldChange("ActionCost", cost)}
						/>
					</FormField>

					<FormField label="Max Uses">
						<input
							type="number"
							value={data.MaxUses ?? ""}
							onChange={(e) => {
								const raw = e.target.value;
								const val = raw === "" ? undefined : Math.max(0, Number(raw));
								handleFieldChange(
									"MaxUses",
									Number.isFinite(val as number) ? val : undefined
								);
							}}
							className="input input-bordered w-full"
							min={0}
							placeholder="Unlimited"
						/>
					</FormField>

					<FormField label="Is Equippable">
						<input
							type="checkbox"
							checked={data.IsEquippable}
							onChange={(e) =>
								handleFieldChange("IsEquippable", e.target.checked)
							}
							className="toggle toggle-primary"
						/>
					</FormField>

					<FormField label="Dice Roll" span={2}>
						<input
							type="text"
							value={data.DiceRoll ?? ""}
							onChange={(e) => handleFieldChange("DiceRoll", e.target.value)}
							className="input input-bordered w-full"
							placeholder={`e.g., "1d20+5", "3d6", "2d10-2"`}
						/>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Restore Rules */}
			<FormSection
				title="Restore Rules"
				description="Configure how this item's uses restore after rests"
			>
				<RestoreRuleEditor
					value={data.RestoreRule}
					onChange={(rule) => handleFieldChange("RestoreRule", rule)}
				/>
			</FormSection>

			{/* Tags */}
			<FormSection title="Tags" description="Organize this item with tags">
				<TagEditor
					tags={data.Tags || []}
					onChange={(tags) => handleFieldChange("Tags", tags)}
				/>
			</FormSection>
		</>
	);
}
