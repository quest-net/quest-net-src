// domains/Character/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { CharacterActions } from "./CharacterActions";
import { Character } from "./Character";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { AttributeEditor } from "../../components/inputs/AttributeEditor";
import { isDmAccess } from "../../utils/UrlParser";
import {
	resolveStats,
	resolveActions,
} from "../../utils/ActorResolvers";

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

		// Clamp stat Current values to their Max before saving.
		// Preserve null (unset) — actor doesn't have this stat.
		// Ensure action Current always equals Max (not editable from this form).
		const validatedData = {
			...data,
			Stats: data.Stats.map(stat => ({
				...stat,
				Current: stat.Current === null
					? null
					: Math.min(stat.Current, stat.Max)
			})),
			Actions: data.Actions.map(action => ({
				...action,
				Current: action.Max
			}))
		};

		if (!character) {
			// Create mode
			if (isDmAccess())
				actionService.execute("character:create", {
					character: validatedData,
				});
			else
				actionService.execute("character:createAndSpawn", {
					character: validatedData,
				});
		} else {
			// Edit mode
			actionService.execute("character:edit", {
				characterId: data.Id,
				updates: validatedData,
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

	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

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

					<FormField
						label="Critical Success Message"
						span={2}
					>
						<input
							type="text"
							value={data.CritMessage || ""}
							onChange={(e) => {
								const value = e.target.value.slice(0, 50);
								handleFieldChange("CritMessage", value || undefined);
							}}
							className="input input-bordered w-full"
							placeholder="e.g., 'Flawless execution!', 'By Pelor's light!'"
							maxLength={50}
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
							<option>extra-small</option>
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
				<div className="space-y-3">
					{resolveStats(
						data.Stats,
						campaign.Settings.StatDefinitions
					).map((stat) => (
						<div key={stat.Id} className="flex items-center gap-4">
							<div className="min-w-32">
								<span
									className="font-medium"
									style={{ color: stat.Color }}
								>
									{stat.Name}
								</span>
							</div>
							<div className="flex-1 flex items-center gap-2">
								<label className="text-sm opacity-70">Max:</label>
								<input
									type="number"
									value={stat.Max}
									onChange={(e) => {
										const updatedSlots = data.Stats.map((s) =>
											s.Id === stat.Id
												? { ...s, Max: Number(e.target.value) }
												: s
										);
										handleFieldChange("Stats", updatedSlots);
									}}
									className="input input-bordered input-sm w-24"
									min={0}
								/>
							</div>
							<div className="flex-1 flex items-center gap-2">
								<label className="text-sm opacity-70">Current:</label>
								<input
									type="number"
									value={stat.Current ?? ""}
									onChange={(e) => {
										const raw = e.target.value;
										const parsed = raw === "" ? null : Number(raw);
										const updatedSlots = data.Stats.map((s) =>
											s.Id === stat.Id
												? { ...s, Current: parsed }
												: s
										);
										handleFieldChange("Stats", updatedSlots);
									}}
									className="input input-bordered input-sm w-24"
									min={0}
									max={stat.Max}
									placeholder="unset"
								/>
								<button
									type="button"
									onClick={() => {
										const updatedSlots = data.Stats.map((s) =>
											s.Id === stat.Id ? { ...s, Current: null } : s
										);
										handleFieldChange("Stats", updatedSlots);
									}}
									disabled={stat.Current === null}
									className="btn btn-ghost btn-sm btn-square shrink-0"
									aria-label="Unset stat"
									title="Unset (character doesn't have this stat)"
								>
									<span className="icon-[mdi--close] h-5 w-5" />
								</button>
							</div>
						</div>
					))}
				</div>
			</FormSection>

			{/* Actions */}
			<FormSection
				title="Actions"
				description="Action economy (Combat Actions, etc.) — resets each turn"
			>
				<div className="space-y-3">
					{resolveActions(
						data.Actions || [],
						campaign.Settings.ActionDefinitions
					).map((action) => (
						<div key={action.Id} className="flex items-center gap-4">
							<div className="min-w-32">
								<span
									className="font-medium"
									style={{ color: action.Color }}
								>
									{action.Name}
								</span>
							</div>
							<div className="flex-1 flex items-center gap-2">
								<label className="text-sm opacity-70">Per Turn:</label>
								<input
									type="number"
									value={action.Max}
									onChange={(e) => {
										const newMax = Number(e.target.value);
										const updatedSlots = (data.Actions || []).map((a) =>
											a.Id === action.Id
												? { ...a, Max: newMax, Current: newMax }
												: a
										);
										handleFieldChange("Actions", updatedSlots);
									}}
									className="input input-bordered input-sm w-24"
									min={0}
								/>
							</div>
						</div>
					))}
				</div>
			</FormSection>

			{/* Attributes */}
			<FormSection
				title="Attributes"
				description="Set values for campaign-defined attributes. Empty attributes are hidden on the character sheet."
			>
				<AttributeEditor
					slots={data.Attributes}
					definitions={campaign.Settings.AttributeDefinitions ?? []}
					onChange={(slots) => handleFieldChange("Attributes", slots)}
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
