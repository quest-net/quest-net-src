// domains/Entity/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { EntityActions } from "./EntityActions";
import { Entity } from "./Entity";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { AttributeEditor } from "../../components/inputs/AttributeEditor";
import {
	resolveStats,
	resolveActions,
} from "../../utils/ActorResolvers";

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
		// Ensure action Current always equals Max (not editable from this form)
		const validatedData = {
			...data,
			Stats: data.Stats.map(stat => ({
				...stat,
				Current: Math.min(stat.Current ?? stat.Max, stat.Max)
			})),
			Actions: data.Actions.map(action => ({
				...action,
				Current: action.Max
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

	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);

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
							generationContext={{
								objectType: "entity",
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
				description="Entity statistics (HP, Mana, etc.)"
			>
				<div className="space-y-3">
					{resolveStats(
						data.Stats,
						campaign.Settings.StatDefinitions
					).map((stat) => {
						const slot = data.Stats.find((s) => s.Id === stat.Id);
						const isTrackingMax = slot ? slot.Current === slot.Max : true;

						return (
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
											const newMax = Number(e.target.value);
											const updatedSlots = data.Stats.map((s) =>
												s.Id === stat.Id
													? {
														...s,
														Max: newMax,
														// If Current was tracking Max, keep it in sync
														...(s.Current === s.Max ? { Current: newMax } : {}),
													}
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
										value={isTrackingMax ? "" : stat.Current}
										onChange={(e) => {
											const raw = e.target.value;
											const newCurrent = raw === "" ? stat.Max : Number(raw);
											const updatedSlots = data.Stats.map((s) =>
												s.Id === stat.Id
													? { ...s, Current: newCurrent }
													: s
											);
											handleFieldChange("Stats", updatedSlots);
										}}
										className="input input-bordered input-sm w-24"
										min={0}
										max={stat.Max}
										placeholder="same as max"
									/>
								</div>
							</div>
						);
					})}
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
				description="Set values for campaign-defined attributes. Empty attributes are hidden on the entity sheet."
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