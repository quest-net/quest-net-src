// domains/Image/Edit.tsx

import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { Image } from "./Image";
import { ImageDisplay } from "./ImageDisplay";
import {
	FormWrapper,
	FormSection,
	FormField,
	FormGrid,
} from "../../components/Form/Form";
import { TagEditor } from "../../components/inputs/TagEditor";

interface ImageEditProps {
	image: Image;
	onClose: () => void;
}

export function ImageEdit({ image, onClose }: ImageEditProps) {
	const { actionService } = useActionService();

	const handleSave = (data: Image) => {
		if (!actionService) return;

		actionService.execute("image:edit", {
			imageId: data.Id,
			updates: {
				Name: data.Name,
				Tags: data.Tags,
				Cutout: data.Cutout || undefined,
			},
		});
	};

	return (
		<FormWrapper
			domain="image"
			entityId={image.Id}
			initialData={image}
			onSave={handleSave}
			onClose={onClose}
			editTitle="Edit Image"
			viewTitle="View Image"
			createTitle="Create Image"
		>
			<ImageForm />
		</FormWrapper>
	);
}

// ============================================================================
// IMAGE FORM (Receives data and onChange from FormWrapper)
// ============================================================================

interface ImageFormProps {
	data?: Image;
	onChange?: (data: Image) => void;
}

function ImageForm({ data, onChange }: ImageFormProps) {
	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Image, value: any) => {
		onChange({
			...data,
			[field]: value,
		});
	};

	const formatFileSize = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	};

	return (
		<>
			{/* Basic Info */}
			<FormSection
				title="Basic Information"
				description="Image identity and preview"
			>
				<FormGrid cols={1}>
					<FormField label="Name">
						<input
							type="text"
							value={data.Name}
							onChange={(e) => handleFieldChange("Name", e.target.value)}
							className="input input-bordered w-full"
							placeholder="Image name"
						/>
					</FormField>
				</FormGrid>

				{/* Full Size Image Display */}
				<div
					className="w-full bg-base-200 rounded-lg overflow-hidden flex items-center justify-center"
					style={{ maxHeight: "70vh" }}
				>
					<ImageDisplay
						imageId={data.Id}
						className="w-full h-full object-contain"
						alt={data.Name}
					/>
				</div>
			</FormSection>

			{/* Details (read-only metadata) */}
			<FormSection
				title="Details"
				description="File metadata (read-only)"
			>
				<div className="space-y-2 text-sm">
					<div className="flex justify-between">
						<span className="opacity-70">Size:</span>
						<span className="font-mono">{formatFileSize(data.FileSize)}</span>
					</div>
					<div className="flex justify-between">
						<span className="opacity-70">Dimensions:</span>
						<span className="font-mono">
							{data.Width}×{data.Height}
						</span>
					</div>
					<div className="flex justify-between">
						<span className="opacity-70">Format:</span>
						<span className="font-mono">
							{data.MimeType.split("/")[1].toUpperCase()}
						</span>
					</div>
				</div>
			</FormSection>

			{/* Display Options */}
			<FormSection
				title="Display"
				description="Controls how this image renders on the 3D map"
			>
				<label className="flex items-start gap-3 cursor-pointer">
					<input
						type="checkbox"
						className="checkbox checkbox-primary mt-1"
						checked={!!data.Cutout}
						onChange={(e) =>
							handleFieldChange("Cutout", e.target.checked || undefined)
						}
					/>
					<div className="flex-1">
						<div className="font-medium">Cutout (transparent background)</div>
						<div className="text-xs opacity-70">
							When enabled, actor tokens using this image render frameless and
							fit-to-contain so a transparent character image shows through
							cleanly. Auto-detected at upload from the image's alpha channel;
							you can override it here.
						</div>
					</div>
				</label>
			</FormSection>

			{/* Tags */}
			<FormSection title="Tags" description="Organize this image with tags">
				<TagEditor
					tags={data.Tags || []}
					onChange={(tags) => handleFieldChange("Tags", tags)}
				/>
			</FormSection>
		</>
	);
}
