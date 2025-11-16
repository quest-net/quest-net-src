// domains/Status/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { StatusActions } from "./StatusActions";
import { Status } from "./Status";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import { ImagePicker } from "../../components/inputs/ImagePicker";

interface StatusEditProps {
	status?: Status;
	initialTags?: string[];
	onClose: () => void;
}

export function StatusEdit({ status, initialTags, onClose }: StatusEditProps) {
	const context = useQuestContext();
	const { actionService } = useActionService();

	const defaultStatus = StatusActions.createDefault(context);
	if (initialTags && !status) {
		defaultStatus.Tags = initialTags;
	}
	const initialData = status || defaultStatus;

	const handleSave = (data: Status) => {
		if (!actionService) return;

		if (!status) {
			// Create mode
			actionService.execute("status:create", { status: data });
		} else {
			// Edit mode
			actionService.execute("status:edit", {
				statusId: data.Id,
				updates: data,
			});
		}
	};

	const handleClone = (data: Status) => {
		if (!actionService) return;

		actionService.execute("status:create", {
			status: {
				...data,
				Id: crypto.randomUUID(),
				Name: `${data.Name} (Copy)`,
			},
		});

		onClose();
	};

	const handleDelete = () => {
		if (!actionService || !status) return;

		actionService.execute("status:delete", { statusId: status.Id });
	};

	return (
		<FormWrapper
			domain="status"
			entityId={status?.Id}
			initialData={initialData}
			onSave={handleSave}
			onClose={onClose}
			onClone={status ? handleClone : undefined}
			onDelete={status ? handleDelete : undefined}
			createTitle="Create Status"
			editTitle="Edit Status"
			viewTitle="View Status"
		>
			<StatusForm />
		</FormWrapper>
	);
}

// ============================================================================
// STATUS FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface StatusFormProps {
	data?: Status;
	onChange?: (data: Status) => void;
}

function StatusForm({ data, onChange }: StatusFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Status, value: any) => {
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
				description="Status identity and description"
			>
				<FormGrid cols={2}>
					<FormField label="Name">
						<input
							type="text"
							value={data.Name}
							onChange={(e) => handleFieldChange("Name", e.target.value)}
							className="input input-bordered w-full"
							placeholder="Status Name"
						/>
					</FormField>

					<FormField label="Image">
						<ImagePicker
							value={data.Image}
							onChange={(imageId) => handleFieldChange("Image", imageId)}
							generationContext={{
								objectType: "status",
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
							placeholder="Status description..."
						/>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Properties */}
			<FormSection
				title="Status Properties"
				description="Duration and behavior"
			>
				<FormGrid cols={2}>
					<FormField label="Duration (turns)" span={2}>
						<>
						<div className="form-control">
							<label className="label cursor-pointer justify-start gap-2">
								<input
									type="checkbox"
									className="toggle toggle-primary"
									checked={data.Duration === undefined}
									onChange={(e) => {
										if (e.target.checked) {
											handleFieldChange("Duration", undefined);
										} else {
											handleFieldChange("Duration", 3);
										}
									}}
								/>
								<span className="label-text">Permanent (never expires)</span>
							</label>
						</div>
						{data.Duration !== undefined && (
							<input
								type="number"
								value={data.Duration ?? ""}
								onChange={(e) => {
									const raw = e.target.value;
									const val = raw === "" ? undefined : Math.max(0, Number(raw));
									handleFieldChange(
										"Duration",
										Number.isFinite(val as number) ? val : undefined
									);
								}}
								className="input input-bordered w-full mt-2"
								min={0}
								placeholder="Duration in turns"
							/>
						)}
						</>
					</FormField>
				</FormGrid>
			</FormSection>

			{/* Tags */}
			<FormSection title="Tags" description="Organize this status with tags">
				<TagEditor
					tags={data.Tags || []}
					onChange={(tags) => handleFieldChange("Tags", tags)}
				/>
			</FormSection>
		</>
	);
}