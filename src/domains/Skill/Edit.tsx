// domains/Skill/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { SkillUtils } from "./SkillUtils";
import { Skill } from "./Skill";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/editors/TagEditor";
import { ImagePicker } from "../../components/pickers/ImagePicker";
import { RestoreRuleEditor } from "../../components/editors/RestoreRuleEditor";
import { StatCostEditor } from "../../components/editors/StatCostEditor";
import { ActionCostEditor } from "../../components/editors/ActionCostEditor";
import { ScriptingFields } from "../../components/editors/ScriptingFields";

interface SkillEditProps {
	skill?: Skill;
	initialTags?: string[];
	onClose: () => void;
}

export function SkillEdit({ skill, initialTags, onClose }: SkillEditProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();

	const defaultSkill = SkillUtils.createDefault(context);
	if (initialTags && !skill) {
		defaultSkill.Tags = initialTags;
	}
	const initialData = skill || defaultSkill;

	const handleSave = (data: Skill) => {
		if (!actionService) return;

		if (!skill) {
			// Create mode
			actionService.execute("skill:create", { skill: data });
		} else {
			// Edit mode
			actionService.execute("skill:edit", {
				skillId: data.Id,
				updates: data,
			});
		}
	};

	const handleClone = (data: Skill) => {
		if (!actionService) return;

		actionService.execute("skill:create", {
			skill: {
				...data,
				Id: crypto.randomUUID(),
				Name: `${data.Name} (Copy)`,
			},
		});

		onClose();
	};

	const handleDelete = () => {
		if (!actionService || !skill) return;

		actionService.execute("skill:delete", { skillId: skill.Id });
	};

	return (
		<FormWrapper
			domain="skill"
			entityId={skill?.Id}
			initialData={initialData}
			onSave={handleSave}
			onClose={onClose}
			onClone={skill ? handleClone : undefined}
			onDelete={skill ? handleDelete : undefined}
			createTitle="Create Skill"
			editTitle="Edit Skill"
			viewTitle="View Skill"
		>
			<SkillForm />
		</FormWrapper>
	);
}

// ============================================================================
// SKILL FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface SkillFormProps {
	data?: Skill;
	onChange?: (data: Skill) => void;
}

function SkillForm({ data, onChange }: SkillFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Skill, value: any) => {
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
				description="Skill identity and description"
			>
				<FormGrid cols={2}>
					<FormField label="Name">
						<input
							type="text"
							value={data.Name}
							onChange={(e) => handleFieldChange("Name", e.target.value)}
							className="input input-bordered w-full"
							placeholder="Skill Name"
						/>
					</FormField>

					<FormField label="Image">
						<ImagePicker
							value={data.Image}
							onChange={(imageId) => handleFieldChange("Image", imageId)}
							generationContext={{
								objectType: "skill",
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
							placeholder="Skill description..."
						/>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Properties */}
			<FormSection
				title="Skill Properties"
				description="Cost, usage limits, and dice behavior"
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

			{/* Targeting */}
			<FormSection
				title="Targeting"
				description="When enabled, using this skill prompts for a target on the map"
			>
				<FormGrid cols={2}>
					<FormField label="Can Target Actor">
						<input
							type="checkbox"
							checked={!!data.CanTargetActor}
							onChange={(e) =>
								handleFieldChange("CanTargetActor", e.target.checked)
							}
							className="toggle toggle-primary"
						/>
					</FormField>

					<FormField label="Can Target Position">
						<input
							type="checkbox"
							checked={!!data.CanTargetPosition}
							onChange={(e) =>
								handleFieldChange("CanTargetPosition", e.target.checked)
							}
							className="toggle toggle-primary"
						/>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Restore Rules */}
			<FormSection
				title="Restore Rules"
				description="Configure how this skill's uses restore after rests"
			>
				<RestoreRuleEditor
					value={data.RestoreRule}
					onChange={(rule) => handleFieldChange("RestoreRule", rule)}
				/>
			</FormSection>

			{/* Tags */}
			<FormSection title="Tags" description="Organize this skill with tags">
				<TagEditor
					tags={data.Tags || []}
					onChange={(tags) => handleFieldChange("Tags", tags)}
				/>
			</FormSection>

			{/* Scripting */}
			<ScriptingFields data={data} onChange={onChange} />
		</>
	);
}
