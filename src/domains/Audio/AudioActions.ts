// domains/Audio/AudioActions.ts

import { Context } from "../Context/Context";
import type { Audio } from "./Audio";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";

/**
 * Extracts YouTube video ID from various URL formats
 * Supports:
 * - youtube.com/watch?v=VIDEO_ID
 * - youtu.be/VIDEO_ID
 * - youtube.com/embed/VIDEO_ID
 * - youtube.com/v/VIDEO_ID
 * - Strips timestamps, playlists, and other parameters
 */
function extractYoutubeId(url: string): string | null {
	// Remove whitespace
	url = url.trim();

	// If it's already just an ID (11 characters, alphanumeric with - and _)
	if (/^[a-zA-Z0-9_-]{11}$/.test(url)) {
		return url;
	}

	// Try different YouTube URL patterns
	const patterns = [
		/(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
		/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
		/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
		/(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
	];

	for (const pattern of patterns) {
		const match = url.match(pattern);
		if (match && match[1]) {
			return match[1];
		}
	}

	return null;
}

/**
 * Audio action handlers
 */
export const AudioActions = {
	/**
	 * Creates a new audio track
	 * Validates and extracts YouTube ID from URL
	 */
	create(params: { audio: Omit<Audio, "Id"> }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Validate YouTube ID
		const youtubeId = extractYoutubeId(params.audio.YoutubeId);
		if (!youtubeId) {
			throw new Error(
				"Invalid YouTube URL. Please provide a valid YouTube video link or ID."
			);
		}

		const audio: Audio = {
			Id: crypto.randomUUID(),
			Name: params.audio.Name,
			YoutubeId: youtubeId,
			Tags: params.audio.Tags || [],
		};

		campaign.Audios.push(audio);

		LogActions.create(
			{
				action: "Audio track added",
				details: audio.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Edits audio metadata
	 */
	edit(
		params: { audioId: string; updates: Partial<Audio> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const audio = campaign.Audios.find((a) => a.Id === params.audioId);
		if (!audio) {
			console.warn(`Audio not found: ${params.audioId}`);
			return;
		}

		// If updating YouTube ID, validate it
		if (params.updates.YoutubeId) {
			const youtubeId = extractYoutubeId(params.updates.YoutubeId);
			if (!youtubeId) {
				throw new Error(
					"Invalid YouTube URL. Please provide a valid YouTube video link or ID."
				);
			}
			params.updates.YoutubeId = youtubeId;
		}

		Object.assign(audio, params.updates);

		LogActions.create(
			{
				action: "Audio track updated",
				details: audio.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Deletes an audio track
	 */
	delete(params: { audioId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const index = campaign.Audios.findIndex((a) => a.Id === params.audioId);
		if (index === -1) {
			console.warn(`Audio not found: ${params.audioId}`);
			return;
		}

		const audio = campaign.Audios[index];
		campaign.Audios.splice(index, 1);

		// If this was the currently playing track, stop it
		if (campaign.GameState.Audio === params.audioId) {
			campaign.GameState.Audio = "";
		}

		LogActions.create(
			{
				action: "Audio track removed",
				details: audio.Name,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},

	/**
	 * Sets the currently playing track
	 * Immediately starts playing the new track
	 */
	setTrack(params: { audioId: string }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		const audio = campaign.Audios.find((a) => a.Id === params.audioId);
		if (!audio) {
			console.warn(`Audio not found: ${params.audioId}`);
			return;
		}

		campaign.GameState.Audio = params.audioId;

		LogActions.create(
			{
				action: "Music changed",
				details: audio.Name,
				category: "system",
				level: "info",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Sets the DM's volume level (0.0 to 1.0)
	 */
	setVolume(params: { volume: number }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Clamp volume between 0 and 1
		const volume = Math.max(0, Math.min(1, params.volume));
		campaign.GameState.Volume = volume;

		// Don't log volume changes (too spammy)
	},

	/**
	 * Stops the currently playing track
	 */
	stopTrack(_params: {}, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		if (!campaign.GameState.Audio) {
			return; // Nothing playing
		}

		campaign.GameState.Audio = "";

		LogActions.create(
			{
				action: "Music stopped",
				details: "",
				category: "system",
				level: "info",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Bulk edit tags for multiple audio tracks
	 */
	bulkEditTags(
		params: { updates: Array<{ audioId: string; tags: string[] }> },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		let successCount = 0;

		params.updates.forEach((update) => {
			const audio = campaign.Audios.find((a) => a.Id === update.audioId);

			if (audio) {
				audio.Tags = update.tags;
				successCount++;
			} else {
				console.warn(`Audio not found for bulk update: ${update.audioId}`);
			}
		});

		LogActions.create(
			{
				action: "Audio tracks organized",
				details: `Updated tags for ${successCount} track(s)`,
				category: "system",
				level: "info",
				visibility: ["dm"],
			},
			context
		);
	},
};