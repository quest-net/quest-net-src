// domains/Audio/AudioActions.ts

import { Context } from "../Context/Context";
import type { Audio } from "./Audio";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { buildPathTag } from "../../utils/FolderUtils";
import {
	extractPlaylistId,
	extractYoutubeId,
	fetchPlaylistIds,
	fetchYoutubePlaylistTitle,
	fetchYoutubeVideoTitle,
	sanitizeYoutubeFolderName,
} from "../../utils/Audio/YouTubeUtils";

const FALLBACK_AUDIO_NAME = "Untitled Audio Track";

/**
 * Audio action handlers
 */
export const AudioActions = {
	/**
	 * Creates a new audio track
	 * Validates and extracts YouTube ID from URL
	 */
	async create(
		params: { audio: Omit<Audio, "Id"> },
		context: Context
	): Promise<void> {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Validate YouTube ID
		const youtubeId = extractYoutubeId(params.audio.YoutubeId);
		if (!youtubeId) {
			throw new Error(
				"Invalid YouTube URL. Please provide a valid YouTube video link or ID."
			);
		}

		const providedName = params.audio.Name.trim();
		const youtubeTitle = providedName.length === 0
			? await fetchYoutubeVideoTitle(youtubeId)
			: null;

		const audio: Audio = {
			Id: crypto.randomUUID(),
			Name: youtubeTitle || providedName || FALLBACK_AUDIO_NAME,
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
	 * Imports a YouTube playlist by ID (no API key required)
	 * Uses YouTube titles when available and falls back to generic names.
	 */
	async importPlaylistByIds(
		params: { playlistUrl: string },
		context: Context
	): Promise<void> {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Extract playlist ID
		const playlistId = extractPlaylistId(params.playlistUrl);
		if (!playlistId) {
			throw new Error("Invalid YouTube playlist URL or ID");
		}

		// Fetch video IDs using iframe API
		const videoIds = await fetchPlaylistIds(playlistId);

		if (videoIds.length === 0) {
			throw new Error("Playlist is empty or could not be loaded");
		}

		const now = new Date();
		const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const playlistTitle = await fetchYoutubePlaylistTitle(playlistId);
		const folderName =
			(playlistTitle && sanitizeYoutubeFolderName(playlistTitle)) ||
			`YoutubePlaylist-${timestamp}`;
		const folderTag = buildPathTag([folderName]);
		const videoTitles = await Promise.all(
			videoIds.map((videoId) => fetchYoutubeVideoTitle(videoId))
		);

		// Create Audio entries
		videoIds.forEach((videoId, index) => {
			const audio: Audio = {
				Id: crypto.randomUUID(),
				Name: videoTitles[index] || `Track No. ${index + 1}`,
				YoutubeId: videoId,
				Tags: [folderTag],
			};
			campaign.Audios.push(audio);
		});

		LogActions.create(
			{
				action: "YouTube playlist imported",
				details: `${videoIds.length} tracks in folder "${folderName}"`,
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

	// Modify setTrack to accept single OR array
	setTrack(params: { audioId: string | string[] }, context: Context): void {
		const audioIds = Array.isArray(params.audioId)
			? params.audioId
			: [params.audioId];

		// Validate all IDs exist
		const campaign = CampaignActions.getActiveCampaign(context);
		const validIds = audioIds.filter((id) =>
			campaign.Audios.find((a) => a.Id === id)
		);

		campaign.GameState.Audio = validIds;

		// Log message
		if (validIds.length > 1) {
			LogActions.create(
				{
					action: "Playlist started",
					details: `${validIds.length} tracks`,
					category: "system",
					level: "info",
					visibility: ["all"],
				},
				context
			);
		} else if (validIds.length === 1) {
			const audio = campaign.Audios.find((a) => a.Id === validIds[0]);
			LogActions.create(
				{
					action: "Music changed",
					details: audio?.Name,
					category: "system",
					level: "info",
					visibility: ["all"],
				},
				context
			);
		}
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

		campaign.GameState.Audio = [];

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
