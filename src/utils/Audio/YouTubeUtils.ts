const YOUTUBE_OEMBED_URL = "https://www.youtube.com/oembed";
const TITLE_FETCH_TIMEOUT_MS = 5000;

interface YouTubeOEmbedResponse {
	title?: string;
}

/**
 * Extracts YouTube video ID from common URL formats or an 11-character ID.
 */
export function extractYoutubeId(url: string): string | null {
	const trimmed = url.trim();

	if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
		return trimmed;
	}

	const patterns = [
		/(?:[?&]v=)([a-zA-Z0-9_-]{11})/,
		/(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
		/(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
		/(?:youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
		/(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
	];

	for (const pattern of patterns) {
		const match = trimmed.match(pattern);
		if (match?.[1]) {
			return match[1];
		}
	}

	return null;
}

/**
 * Extracts playlist ID from YouTube playlist URLs or a raw playlist ID.
 */
export function extractPlaylistId(url: string): string | null {
	const trimmed = url.trim();

	const listParamMatch = trimmed.match(/[?&]list=([a-zA-Z0-9_-]+)/);
	if (listParamMatch?.[1]) {
		return listParamMatch[1];
	}

	if (/^PL[a-zA-Z0-9_-]+$/.test(trimmed)) {
		return trimmed;
	}

	return null;
}

export async function fetchYoutubeVideoTitle(
	videoId: string
): Promise<string | null> {
	return fetchYoutubeTitle(`https://www.youtube.com/watch?v=${videoId}`);
}

export async function fetchYoutubePlaylistTitle(
	playlistId: string
): Promise<string | null> {
	return fetchYoutubeTitle(`https://www.youtube.com/playlist?list=${playlistId}`);
}

export function sanitizeYoutubeFolderName(title: string): string {
	return title.replace(/[\\/]+/g, "-").replace(/\s+/g, " ").trim();
}

async function fetchYoutubeTitle(url: string): Promise<string | null> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TITLE_FETCH_TIMEOUT_MS);

	try {
		const params = new URLSearchParams({ format: "json", url });
		const response = await fetch(`${YOUTUBE_OEMBED_URL}?${params.toString()}`, {
			signal: controller.signal,
		});

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as YouTubeOEmbedResponse;
		const title = data.title?.trim();
		return title || null;
	} catch {
		return null;
	} finally {
		clearTimeout(timeout);
	}
}

/**
 * Fetches video IDs from a YouTube playlist using the IFrame API.
 */
export async function fetchPlaylistIds(playlistId: string): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const container = document.createElement("div");
		container.style.display = "none";
		document.body.appendChild(container);

		let player: any = null;
		let timeout: ReturnType<typeof setTimeout>;
		let checkInterval: ReturnType<typeof setInterval> | undefined;

		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			if (checkInterval) clearInterval(checkInterval);
			if (player) {
				try {
					player.destroy();
				} catch (e) {
					console.warn("Error destroying temp player:", e);
				}
			}
			container.remove();
		};

		timeout = setTimeout(() => {
			cleanup();
			reject(new Error("Timeout loading playlist"));
		}, 10000);

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
							const videoIds = player.getPlaylist();
							cleanup();

							if (videoIds?.length > 0) {
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

		if (window.YT?.Player) {
			initPlayer();
		} else {
			checkInterval = setInterval(() => {
				if (window.YT?.Player) {
					clearInterval(checkInterval);
					initPlayer();
				}
			}, 100);
		}
	});
}
