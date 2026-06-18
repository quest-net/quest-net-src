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
import { TagEditor } from "../../components/editors/TagEditor";
import {
	UserPicker,
	useConnectedUsers,
	UNASSIGNED_OWNER_ID,
	PickableUser,
} from "../../components/pickers/UserPicker";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";

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
				UploadedBy: data.UploadedBy,
			},
		});
	};

	const handleDelete = () => {
		if (!actionService) return;

		// Remove metadata from the campaign (broadcasts to peers via StateSync).
		actionService.execute("image:delete", { imageId: image.Id });
		// Drop the blob from IndexedDB. Fire-and-forget: the action above has
		// already removed the metadata, so the image is logically gone even if
		// the IDB cleanup happens slightly later or fails. Peer IndexedDB caches
		// are intentionally not cleaned here — a future page-load sweep will
		// reconcile orphaned blobs against the campaign's image list.
		void IndexedDBUtilities.remove(image.Id);
	};

	return (
		<FormWrapper
			domain="image"
			entityId={image.Id}
			initialData={image}
			onSave={handleSave}
			onClose={onClose}
			onDelete={handleDelete}
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
	// Exclude self: this owner picker is DM-only, so the DM's own entry would
	// just duplicate the "DM Library" (no owner) option.
	const connectedUsers = useConnectedUsers({ excludeSelf: true });

	if (!data || !onChange) return null;

	const handleFieldChange = (field: keyof Image, value: any) => {
		onChange({
			...data,
			[field]: value,
		});
	};

	// Candidates: the shared DM library (no owner) plus everyone connected. The
	// returning player is connected on their new machine, so they appear here
	// and the DM can hand the image over directly. Include the current owner if
	// it isn't otherwise listed (e.g. an offline player's stale id) so it shows
	// up highlighted rather than silently missing.
	const ownerCandidates: PickableUser[] = [
		{ Id: UNASSIGNED_OWNER_ID, Name: "DM Library", Description: "No owner" },
		...connectedUsers,
	];
	if (
		data.UploadedBy &&
		!ownerCandidates.some((u) => u.Id === data.UploadedBy)
	) {
		ownerCandidates.push({
			Id: data.UploadedBy,
			Name: `Unknown user (${data.UploadedBy.slice(0, 8)})`,
			Description: "Current owner",
		});
	}

	const ownerName = !data.UploadedBy
		? "DM Library (no owner)"
		: connectedUsers.find((u) => u.Id === data.UploadedBy)?.Name ??
		  `Unknown user (${data.UploadedBy.slice(0, 8)})`;

	const handleOwnerSelect = (userId: string) => {
		handleFieldChange(
			"UploadedBy",
			userId === UNASSIGNED_OWNER_ID ? undefined : userId
		);
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

			{/* Ownership */}
			<FormSection
				title="Ownership"
				description="Who this image belongs to. Players only see their own uploads; the DM sees everything. Reassign here when a player rejoins from a different device under a new user id."
			>
				<div className="flex items-center justify-between gap-3">
					<div className="flex items-center gap-2 text-sm min-w-0">
						<span className="icon-[mdi--account] w-4 h-4 opacity-70 shrink-0" />
						<span className="truncate" title={ownerName}>
							{ownerName}
						</span>
					</div>
					<UserPicker
						users={ownerCandidates}
						currentId={data.UploadedBy ?? UNASSIGNED_OWNER_ID}
						onSelect={handleOwnerSelect}
						buttonLabel="Change Owner"
						title="Assign owner"
					/>
				</div>
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
