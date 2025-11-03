// domains/Character/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CharacterActions } from "./CharacterActions";
import { Character } from "./Character";
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
import { isDmAccess } from "../../utils/UrlParser";

interface CharacterEditProps {
	character?: Character;
	initialTags?: string[];
	onClose: () => void;
}

export function CharacterEdit({
	character,
	initialTags,
	onClose,
}: CharacterEditProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();

	const defaultCharacter = CharacterActions.createDefault(context);
	if (initialTags && !character) {
		defaultCharacter.Tags = initialTags;
	}

	const initialData = character || defaultCharacter;

	const handleSave = (data: Character) => {
		if (!actionService) return;

		if (!character) {
			// Create mode
			if (isDmAccess())
			actionService.execute("character:create", {
				character: data,
			});
			else
			actionService.execute("character:createAndSpawn", {
				character: data,
			});
		} else {
			// Edit mode
			actionService.execute("character:edit", {
				characterId: data.Id,
				updates: data,
			});
		}
	};

	const handleClone = (data: Character) => {
		if (!actionService) return;

		// Use the clone action we just created
		actionService.execute("character:create", {
			character: {
				...data,
				Id: crypto.randomUUID(),
				Name: `${data.Name} (Copy)`,
			},
		});

		// Close the current form after cloning
		onClose();
	};

	const handleDelete = () => {
		if (!actionService || !character) return;

		actionService.execute("character:delete", {
			characterId: character.Id,
		});
	};

	return (
		<FormWrapper
			domain="character"
			entityId={character?.Id}
			initialData={initialData}
			onSave={handleSave}
			onClose={onClose}
			onClone={character ? handleClone : undefined}
			onDelete={character ? handleDelete : undefined}
			createTitle="Create Character"
			editTitle="Edit Character"
			viewTitle="View Character"
		>
			<CharacterForm />
		</FormWrapper>
	);
}

// ============================================================================
// CHARACTER FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface CharacterFormProps {
	data?: Character;
	onChange?: (data: Character) => void;
}

function CharacterForm({ data, onChange }: CharacterFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Character, value: any) => {
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
				description="Character identity and description"
			>
				<FormGrid cols={2}>
					<FormField label="Name">
						<input
							type="text"
							value={data.Name}
							onChange={(e) => handleFieldChange("Name", e.target.value)}
							className="input input-bordered w-full"
							placeholder="Character Name"
						/>
					</FormField>

					<FormField label="Image">
						<ImagePicker
							value={data.Image}
							onChange={(imageId) => handleFieldChange("Image", imageId)}
							label=""
						/>
					</FormField>

					<FormField label="Description" span={2}>
						<textarea
							value={data.Description || ""}
							onChange={(e) => handleFieldChange("Description", e.target.value)}
							className="textarea textarea-bordered w-full"
							rows={3}
							placeholder="Character description..."
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
						<select defaultValue="small" className="select" onChange={(e) => handleFieldChange("Size", e.target.value)}>
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
				description="Character statistics (HP, Mana, etc.)"
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
				description="Organizational tags for this character"
			>
				<TagEditor
					tags={data.Tags || []}
					onChange={(tags) => handleFieldChange("Tags", tags)}
				/>
			</FormSection>
		</>
	);
}
