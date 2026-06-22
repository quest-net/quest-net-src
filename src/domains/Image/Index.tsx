// domains/Image/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { ImageUpload } from "../../components/editors/ImageUpload";
import {
	IndexView,
	IndexViewItem,
	SelectionAction,
} from "../../components/IndexView/IndexView";
import { ImageEdit } from "./Edit";
import {
	UserMenu,
	useConnectedUsers,
	UNASSIGNED_OWNER_ID,
	PickableUser,
} from "../../components/pickers/UserPicker";
import { EmptyState } from "../../components/ui/EmptyState";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";

export function ImageIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignUtils.getActiveCampaign(context);

	const [uploadingImageId, setUploadingImageId] = useState<string | undefined>(
		undefined
	);

	// Exclude self: reassignment is DM-only, so the DM's own entry would just
	// duplicate the "DM Library" (no owner) option below.
	const connectedUsers = useConnectedUsers({ excludeSelf: true });

	const handleUploadComplete = () => {
		setUploadingImageId(undefined);
	};

	// Reassign targets: everyone currently connected, plus any other user id
	// already known from existing image ownership (e.g. a player's stale id from
	// a previous machine), plus the shared DM library (no owner). Deduped by id.
	const reassignTargets: PickableUser[] = (() => {
		const list: PickableUser[] = [
			{ Id: UNASSIGNED_OWNER_ID, Name: "DM Library", Description: "No owner" },
			...connectedUsers,
		];
		const seen = new Set(list.map((u) => u.Id));

		campaign.Images.forEach((img) => {
			const id = img.UploadedBy;
			if (!id || seen.has(id)) return;
			seen.add(id);
			list.push({
				Id: id,
				Name: `Unknown user (${id.slice(0, 8)})`,
				Description: "Previous owner",
			});
		});

		return list;
	})();

	const handleReassignSelected = (imageIds: string[], userId: string) => {
		if (!actionService || imageIds.length === 0) return;
		actionService.execute("image:reassignOwner", {
			imageIds,
			toUserId: userId === UNASSIGNED_OWNER_ID ? undefined : userId,
		});
	};

	const selectionActions: SelectionAction[] = [
		{
			label: "Reassign Ownership",
			icon: "icon-[mdi--account-switch]",
			requiresSelection: true,
			renderDropdown: (selectedIds, close) => (
				<UserMenu
					users={reassignTargets}
					title="Assign selected to"
					onSelect={(userId) => {
						handleReassignSelected(selectedIds, userId);
						close();
					}}
				/>
			),
		},
	];

	const handleBulkUpdateImageTags = (
		updates: Array<{ itemId: string; newTags: string[] }>
	) => {
		if (!actionService) return;

		actionService.execute("image:bulkEditTags", {
			updates: updates.map((update) => ({
				imageId: update.itemId,
				tags: update.newTags,
			})),
		});
	};

	const handleBulkDelete = (imageIds: string[]) => {
		if (!actionService) return;

		// Remove metadata from the campaign (broadcasts to peers via StateSync).
		actionService.execute("image:bulkDelete", { imageIds });
		// Drop the blobs from IndexedDB. Fire-and-forget, mirroring the single
		// delete in ImageEdit: the action above has already removed the metadata,
		// so the images are logically gone even if blob cleanup lags or fails.
		imageIds.forEach((id) => void IndexedDBUtilities.remove(id));
	};

	const formatFileSize = (bytes: number): string => {
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
	};

	const items: IndexViewItem[] = campaign.Images.map((image) => ({
		id: image.Id,
		label: image.Name,
		details: `${formatFileSize(image.FileSize)} • ${image.Width}×${
			image.Height
		}`,
		imageId: image.Id,
		tags: image.Tags || [],
		// No action button needed
	}));

	return (
		<div className="space-y-6">
			{/* Upload Section - Above IndexView */}
			<div className="card border-2 bg-base-100 mx-6 mt-6">
				<div className="card-body p-4">
					<ImageUpload
						value={uploadingImageId}
						onChange={handleUploadComplete}
						multiple={true}
						compact={true}
					/>
				</div>
			</div>

			{/* IndexView for Image Grid */}
			<IndexView
				items={items}
				title="Image Library"
				sortKey="images-sort"
				description="Manage campaign images"
				searchEnabled={true}
				searchPlaceholder="Search images by name..."
				emptyMessage="No images yet. Upload one to get started!"
				onBulkUpdateItemTags={handleBulkUpdateImageTags}
				onBulkDelete={handleBulkDelete}
				selectionActions={selectionActions}
				renderEditForm={(item, { closeDrawer }) => {
					const image = item
						? campaign.Images.find((img) => img.Id === item.id)
						: null;

					if (!image) {
						return <EmptyState>Image not found</EmptyState>;
					}

					return (
						<ImageEdit
							key={image.Id}
							image={image}
							onClose={() => closeDrawer?.()}
						/>
					);
				}}
			/>
		</div>
	);
}
