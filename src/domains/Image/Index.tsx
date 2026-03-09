// domains/Image/Index.tsx

import { useState } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { ImageUpload } from "../../components/inputs/ImageUpload";
import { ImageDisplay } from "./ImageDisplay";
import { IndexView, IndexViewItem } from "../../components/IndexView/IndexView";

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
				renderEditForm={(item) => {
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
						<div className="space-y-4">
							<h2 className="text-2xl font-bold">{image.Name}</h2>

							{/* Full Size Image Display */}
							<div
								className="w-full bg-base-200 rounded-lg overflow-hidden flex items-center justify-center"
								style={{ maxHeight: "70vh" }}
							>
								<ImageDisplay
									imageId={image.Id}
									className="w-full h-full object-contain"
									alt={image.Name}
								/>
							</div>

							{/* Metadata */}
							<div className="card bg-base-200">
								<div className="card-body">
									<h3 className="font-semibold mb-2">Details</h3>
									<div className="space-y-2 text-sm">
										<div className="flex justify-between">
											<span className="opacity-70">Size:</span>
											<span className="font-mono">
												{formatFileSize(image.FileSize)}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="opacity-70">Dimensions:</span>
											<span className="font-mono">
												{image.Width}×{image.Height}
											</span>
										</div>
										<div className="flex justify-between">
											<span className="opacity-70">Format:</span>
											<span className="font-mono">
												{image.MimeType.split("/")[1].toUpperCase()}
											</span>
										</div>
									</div>
								</div>
							</div>

							{/* Tags Display */}
							{image.Tags && image.Tags.length > 0 && (
								<div className="card bg-base-200">
									<div className="card-body">
										<h3 className="font-semibold mb-2">Tags</h3>
										<div className="flex flex-wrap gap-2">
											{image.Tags.map((tag) => (
												<div key={tag} className="badge badge-outline">
													{tag}
												</div>
											))}
										</div>
									</div>
								</div>
							)}
						</div>
					);
				}}
			/>
		</div>
	);
}
