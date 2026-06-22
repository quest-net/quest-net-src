// domains/Image/ImageActions.ts

import { Context } from "../Context/Context";
import type { Image } from "./Image";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { LogActions } from "../Log/LogActions";

/**
 * Image action handlers
 */
export const ImageActions = {
	/**
	 * Adds an image to the campaign catalog (metadata only)
	 * NOTE: Image blob should already be stored in IndexedDB before calling this
	 */
	create(params: { image: Image }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Simply add the image metadata to the campaign
		campaign.Images.push(params.image);

		LogActions.create(
			{
				action: "Image added",
				details: `${params.image.Name} (${(
					params.image.FileSize / 1024
				).toFixed(1)} KB)`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Adds multiple images to the campaign catalog in one operation
	 * More efficient than individual creates - single log entry, single state sync
	 * NOTE: Image blobs should already be stored in IndexedDB before calling this
	 */
	bulkCreate(params: { images: Image[] }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Add all images at once
		campaign.Images.push(...params.images);

		// Calculate total size for log
		const totalSize = params.images.reduce((sum, img) => sum + img.FileSize, 0);

		// Single log entry for the entire bulk operation
		LogActions.create(
			{
				action: "Images uploaded",
				details: `${params.images.length} image(s) added (${(
					totalSize / 1024
				).toFixed(1)} KB total)`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Removes an image from the campaign catalog (metadata only)
	 * NOTE: IndexedDB cleanup should be handled separately by the service layer
	 */
	delete(params: { imageId: string }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const index = campaign.Images.findIndex((img) => img.Id === params.imageId);
		if (index === -1) {
			console.warn(`Image not found: ${params.imageId}`);
			return;
		}

		const image = campaign.Images[index];
		campaign.Images.splice(index, 1);

		LogActions.create(
			{
				action: "Image removed",
				details: image.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Edits image metadata
	 */
	edit(
		params: { imageId: string; updates: Partial<Image> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		const image = campaign.Images.find((img) => img.Id === params.imageId);
		if (!image) {
			console.warn(`Image not found: ${params.imageId}`);
			return;
		}

		Object.assign(image, params.updates);

		LogActions.create(
			{
				action: "Image updated",
				details: image.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Bulk edit tags for multiple images
	 * More efficient than individual edits - single log entry, single state sync
	 */
	bulkEditTags(
		params: { updates: Array<{ imageId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		let successCount = 0;

		// Apply all updates
		params.updates.forEach((update) => {
			const image = campaign.Images.find((img) => img.Id === update.imageId);

			if (image) {
				image.Tags = update.tags;
				successCount++;
			} else {
				console.warn(`Image not found for bulk update: ${update.imageId}`);
			}
		});

		// Single log entry for the entire bulk operation
		LogActions.create(
			{
				action: "Images organized",
				details: `Updated tags for ${successCount} image(s)`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Permanently deletes multiple images from the campaign catalog (metadata
	 * only) in one operation. Mirrors `bulkEditTags`: single log entry, single
	 * state sync. NOTE: IndexedDB blob cleanup is handled by the caller (the
	 * Index view) — see ImageActions.delete for the per-image rationale.
	 */
	bulkDelete(params: { imageIds: string[] }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		let count = 0;
		params.imageIds.forEach((imageId) => {
			const index = campaign.Images.findIndex((img) => img.Id === imageId);
			if (index !== -1) {
				campaign.Images.splice(index, 1);
				count++;
			} else {
				console.warn(`Image not found for bulk delete: ${imageId}`);
			}
		});

		if (count === 0) return;

		LogActions.create(
			{
				action: "Images removed",
				details: `${count} image(s) deleted`,
				category: "system",
				level: "important",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Reassigns ownership of the given images to `toUserId`. Pass
	 * `toUserId: undefined` to release them back to the shared DM library
	 * (no owner). Mirrors `bulkEditTags`: operates on an explicit set of
	 * selected image ids in a single action.
	 *
	 * The primary use case is a player who rejoins from a different machine and
	 * thus a different user id — their old uploads are orphaned under the stale
	 * id and invisible to them. The DM selects the orphaned images and hands
	 * them to the player's current (connected) id in one operation.
	 */
	reassignOwner(
		params: { imageIds: string[]; toUserId?: string },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		let count = 0;
		params.imageIds.forEach((imageId) => {
			const image = campaign.Images.find((img) => img.Id === imageId);
			if (image) {
				image.UploadedBy = params.toUserId;
				count++;
			} else {
				console.warn(`Image not found for reassign: ${imageId}`);
			}
		});

		if (count === 0) return;

		LogActions.create(
			{
				action: "Image ownership reassigned",
				details: `${count} image(s) reassigned`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},
};
