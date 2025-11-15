// domains/Entity/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { EntityActions } from "./EntityActions";
import { Entity } from "./Entity";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { StatDefinitionsEditor } from "../../components/inputs/StatDefinitionEditor";
import { AttributeEditor } from "../../components/inputs/AttributeEditor";
import { TagEditor } from "../../components/inputs/TagEditor";
import { ImagePicker } from "../../components/inputs/ImagePicker";

interface EntityEditProps {
	entity?: Entity;
	initialTags?: string[];
	onClose: () => void;
}

export function EntityEdit({
	entity,
	initialTags,
	onClose,
}: EntityEditProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();

	const defaultEntity = EntityActions.createDefault(context);
	if (initialTags && !entity) {
		defaultEntity.Tags = initialTags;
	}

	const initialData = entity || defaultEntity;

	const handleSave = (data: Entity) => {
		if (!actionService) return;
	
		// Clamp stat Current values to their Max before saving
		const validatedData = {
			...data,
			Stats: data.Stats.map(stat => ({
				...stat,
				Current: Math.min(stat.Current ?? stat.Max, stat.Max)
			}))
		};
	
		if (!entity) {
			// Create mode
			actionService.execute("entity:create", {
				entity: validatedData,
			});
		} else {
			// Edit mode
			actionService.execute("entity:edit", {
				entityId: data.Id,
				updates: validatedData,
			});
		}
	};

	const handleClone = (data: Entity) => {
		if (!actionService) return;

		actionService.execute("entity:create", {
			entity: {
				...data,
				Id: crypto.randomUUID(),
				Name: `${data.Name} (Copy)`,
			},
		});

		onClose();
	};

	const handleDelete = () => {
		if (!actionService || !entity) return;

		actionService.execute("entity:delete", {
			entityId: entity.Id,
		});
	};

	return (
		<FormWrapper
			domain="entity"
			entityId={entity?.Id}
			initialData={initialData}
			onSave={handleSave}
			onClose={onClose}
			onClone={entity ? handleClone : undefined}
			onDelete={entity ? handleDelete : undefined}
			createTitle="Create Entity"
			editTitle="Edit Entity"
			viewTitle="View Entity"
		>
			<EntityForm />
		</FormWrapper>
	);
}

// ============================================================================
// ENTITY FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface EntityFormProps {
	data?: Entity;
	onChange?: (data: Entity) => void;
}

function EntityForm({ data, onChange }: EntityFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Entity, value: any) => {
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
				description="Entity identity and description"
			>
				<FormGrid cols={2}>
					<FormField label="Name">
						<input
							type="text"
							value={data.Name}
							onChange={(e) => handleFieldChange("Name", e.target.value)}
							className="input input-bordered w-full"
							placeholder="Entity Name"
						/>
					</FormField>

					<FormField label="Image">
						<ImagePicker
							value={data.Image}
							onChange={(imageId) => handleFieldChange("Image", imageId)}
						/>
					</FormField>

					<FormField label="Description" span={2}>
						<textarea
							value={data.Description || ""}
							onChange={(e) => handleFieldChange("Description", e.target.value)}
							className="textarea textarea-bordered w-full"
							rows={3}
							placeholder="Entity description..."
						/>
					</FormField>

					<FormField label="Move Speed">
						<input
							type="number"
							value={data.MoveSpeed}
							onChange={(e) =>
								handleFieldChange("MoveSpeed", Number(e.target.value))
							}
							className="input input-bordered w-full"
							min={0}
							max={99}
						/>
					</FormField>

					<FormField label="Can Fly">
						<input
							type="checkbox"
							checked={data.CanFly}
							onChange={(e) => handleFieldChange("CanFly", e.target.checked)}
							className="toggle toggle-primary"
						/>
					</FormField>

					<FormField label="Size">
						<select
							value={data.Size || "small"}
							className="select select-bordered w-full"
							onChange={(e) => handleFieldChange("Size", e.target.value)}
						>
							<option>small</option>
							<option>medium</option>
							<option>large</option>
						</select>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Stats */}
			<FormSection
				title="Stats"
				description="Entity statistics (HP, Mana, etc.)"
			>
				<StatDefinitionsEditor
					stats={data.Stats}
					onChange={(stats) => handleFieldChange("Stats", stats)}
				/>
			</FormSection>

			{/* Attributes */}
			<FormSection title="Attributes" description="Custom key-value attributes">
				<AttributeEditor
					attributes={data.Attributes}
					onChange={(attributes) => handleFieldChange("Attributes", attributes)}
				/>
			</FormSection>

			{/* Tags */}
			<FormSection
				title="Tags"
				description="Organizational tags for this entity"
			>
				<TagEditor
					tags={data.Tags || []}
					onChange={(tags) => handleFieldChange("Tags", tags)}
				/>
			</FormSection>
		</>
	);
}