// domains/Status/Edit.tsx

import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { StatusActions } from "./StatusActions";
import { Status, StatusExpiration } from "./Status";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";
import { ImagePicker } from "../../components/inputs/ImagePicker";
import { ScriptingFields } from "../../components/inputs/ScriptingFields";

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

type ExpirationType = StatusExpiration["type"];

function StatusForm({ data, onChange }: StatusFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Status, value: any) => {
		onChange({
			...data,
			[field]: value,
		});
	};

	const handleExpirationTypeChange = (type: ExpirationType) => {
		let newExpiration: StatusExpiration;
		switch (type) {
			case "permanent":
				newExpiration = { type: "permanent" };
				break;
			case "turns":
				newExpiration = {
					type: "turns",
					count: data.Expiration.type === "turns" ? data.Expiration.count : 3,
				};
				break;
			case "shortRest":
				newExpiration = { type: "shortRest" };
				break;
			case "longRest":
				newExpiration = { type: "longRest" };
				break;
			case "days":
				newExpiration = {
					type: "days",
					count: data.Expiration.type === "days" ? data.Expiration.count : 3,
				};
				break;
		}
		handleFieldChange("Expiration", newExpiration);
	};

	const handleCountChange = (count: number) => {
		const exp = data.Expiration;
		if (exp.type === "turns") {
			handleFieldChange("Expiration", { type: "turns", count });
		} else if (exp.type === "days") {
			handleFieldChange("Expiration", { type: "days", count });
		}
	};

	const showCountInput = data.Expiration.type === "turns" || data.Expiration.type === "days";
	const countValue = data.Expiration.type === "turns"
		? data.Expiration.count
		: data.Expiration.type === "days"
			? data.Expiration.count
			: 0;
	const countLabel = data.Expiration.type === "turns" ? "turns" : "days";

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
					<FormField label="Expiration" span={2}>
						<>
							<select
								value={data.Expiration.type}
								onChange={(e) =>
									handleExpirationTypeChange(e.target.value as ExpirationType)
								}
								className="select select-bordered w-full"
							>
								<option value="permanent">Permanent (never expires)</option>
								<option value="turns">After X turns (combat)</option>
								<option value="shortRest">Until short rest</option>
								<option value="longRest">Until long rest</option>
								<option value="days">After X days</option>
							</select>

							{showCountInput && (
								<div className="flex items-center gap-2 mt-2">
									<input
										type="number"
										value={countValue}
										onChange={(e) => {
											const val = Math.max(0, Number(e.target.value));
											if (Number.isFinite(val)) {
												handleCountChange(val);
											}
										}}
										className="input input-bordered w-full"
										min={0}
										placeholder={`Duration in ${countLabel}`}
									/>
									<span className="text-sm opacity-70 whitespace-nowrap">
										{countLabel}
									</span>
								</div>
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

			{/* Scripting */}
			<ScriptingFields data={data} onChange={onChange} />
		</>
	);
}
