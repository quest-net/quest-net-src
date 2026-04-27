// domains/Image/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageUpload } from "../../components/inputs/ImageUpload";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";
import { ImageEdit } from "./Edit";

export function ImageIndex() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);

	const [uploadingImageId, setUploadingImageId] = useState<string | undefined>(
		undefined
	);

	const handleUploadComplete = () => {
		setUploadingImageId(undefined);
	};

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
			<div className="card border-2 bg-base-100 m-6">
				<div className="card-body">
					<ImageUpload
						value={uploadingImageId}
						onChange={handleUploadComplete}
						multiple={true}
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
				renderEditForm={(item, { closeDrawer }) => {
					const image = item
						? campaign.Images.find((img) => img.Id === item.id)
						: null;

					if (!image) {
						return (
							<div className="text-center py-12">
								<p>Image not found</p>
							</div>
						);
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
