// domains/Audio/AudioActions.ts

import { Context } from "../Context/Context";
import type { Audio } from "./Audio";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { buildPathTag } from "../../utils/FolderUtils";

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
	 * Imports a YouTube playlist by ID (no API key required)
	 * Creates tracks with generic names in a timestamped folder
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

		// Create folder name with timestamp
		const now = new Date();
		const timestamp = now.toISOString().replace(/[:.]/g, "-").slice(0, 19);
		const folderName = `YoutubePlaylist-${timestamp}`;
		const folderTag = buildPathTag([folderName]);

		// Create Audio entries
		videoIds.forEach((videoId, index) => {
			const audio: Audio = {
				Id: crypto.randomUUID(),
				Name: `Track No. ${index + 1}`,
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
// HELPER METHODS
/**
 * Fetches video IDs from a YouTube playlist using the IFrame API
 * No API key required!
 */
export async function fetchPlaylistIds(playlistId: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		// Create a temporary hidden div for the player
		const container = document.createElement("div");
		container.style.display = "none";
		document.body.appendChild(container);

		let player: any = null;
		let timeout: ReturnType<typeof setTimeout>;

		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			if (player) {
				try {
					player.destroy();
				} catch (e) {
					console.warn("Error destroying temp player:", e);
				}
			}
			document.body.removeChild(container);
		};

		// Timeout after 10 seconds
		timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Timeout loading playlist"));
		}, 10000);

		// Wait for YouTube API to be ready
		const initPlayer = () => {
			player = new window.YT.Player(container, {
				height: "0",
				width: "0",
				playerVars: {
					listType: "playlist",
					list: playlistId,
				},
				events: {
					onReady: () => {
						try {
							// Get the playlist
							const videoIds = player.getPlaylist();
							cleanup();

							if (videoIds && videoIds.length > 0) {
								resolve(videoIds);
							} else {
								reject(new Error("Playlist not found or empty"));
							}
						} catch (error) {
							cleanup();
							reject(error);
						}
					},
					onError: (event: any) => {
						cleanup();
						reject(new Error(`YouTube player error: ${event.data}`));
					},
				},
			});
		};

		// Initialize if API is ready, otherwise wait
		if (window.YT && window.YT.Player) {
			initPlayer();
		} else {
			const checkInterval = setInterval(() => {
				if (window.YT && window.YT.Player) {
					clearInterval(checkInterval);
					initPlayer();
				}
			}, 100);
		}
	});
}

/**
 * Extracts playlist ID from various YouTube playlist URL formats
 */
export function extractPlaylistId(url: string): string | null {
	const patterns = [
		/[?&]list=([a-zA-Z0-9_-]+)/, // ?list=PLxxxx or &list=PLxxxx
		/^PL[a-zA-Z0-9_-]+$/, // Just the ID starting with PL
	];

	const trimmed = url.trim();

	for (const pattern of patterns) {
		const match = trimmed.match(pattern);
		if (match && match[1]) {
			return match[1];
		}
	}

	// Maybe they just pasted the ID
	if (/^PL[a-zA-Z0-9_-]+$/.test(trimmed)) {
		return trimmed;
	}

	return null;
}
