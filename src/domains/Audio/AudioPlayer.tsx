// domains/Audio/AudioPlayer.tsx

import { useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { AppSettingActions } from "../AppSetting/AppSettingActions";
import { useAudioState } from "./AudioContext";

// YouTube IFrame API types
declare global {
	interface Window {
		YT: any;
		onYouTubeIframeAPIReady: () => void;
	}
}

export function AudioPlayer() {
	const context = useQuestContext();
	const campaign = CampaignActions.getActiveCampaign(context);
	const playerRef = useRef<any>(null);
	const currentVideoIdsRef = useRef<string>("");
	const playerContainerRef = useRef<HTMLDivElement>(null);

	// Get volumes
	const dmVolume = campaign.GameState.Volume;
	const playerVolume = AppSettingActions.getPlayerVolume(context);
	const finalVolume = dmVolume * playerVolume * 0.5 * 100; // YouTube uses 0-100 scale

	// Get current audio(s) and convert to YouTube IDs
	const currentAudioIds = campaign.GameState.Audio;
	const youtubeIds = currentAudioIds
		.map(audioId => campaign.Audios.find(a => a.Id === audioId)?.YoutubeId)
		.filter((id): id is string => !!id);

	// Create a stable string representation for comparison
	const youtubeIdsString = youtubeIds.join(',');

	// Load YouTube IFrame API
	useEffect(() => {
		if (window.YT && window.YT.Player) {
			initializePlayer();
			return;
		}

		// Check if script is already loading
		if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
			window.onYouTubeIframeAPIReady = initializePlayer;
			return;
		}

		// Load the script
		const tag = document.createElement("script");
		tag.src = "https://www.youtube.com/iframe_api";
		const firstScriptTag = document.getElementsByTagName("script")[0];
		firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

		window.onYouTubeIframeAPIReady = initializePlayer;

		// Cleanup
		return () => {
			if (playerRef.current) {
				try {
					playerRef.current.destroy();
				} catch (e) {
					console.warn("Error destroying player:", e);
				}
				playerRef.current = null;
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const initializePlayer = () => {
		if (!playerContainerRef.current || playerRef.current) return;

		playerRef.current = new window.YT.Player(playerContainerRef.current, {
			height: "0",
			width: "0",
			videoId: "",
			playerVars: {
				autoplay: 0,
				controls: 0,
				disablekb: 1,
				fs: 0,
				modestbranding: 1,
				playsinline: 1,
				loop: 1,
			},
			events: {
				onReady: onPlayerReady,
				onStateChange: onPlayerStateChange,
			},
		});
	};

	const onPlayerReady = () => {
		// Player is ready, load video(s) if we have any
		if (youtubeIds.length > 0 && youtubeIdsString !== currentVideoIdsRef.current) {
			loadAndPlayVideo(youtubeIds);
		}
	};

	const { setCurrentTrackIndex } = useAudioState();

	const onPlayerStateChange = () => {
		// Update current track index when playlist advances
		if (playerRef.current && youtubeIds.length > 1) {
			try {
				const index = playerRef.current.getPlaylistIndex();
				if (index !== -1) {
					setCurrentTrackIndex(index);
				}
			} catch (e) {
				console.warn("Error getting playlist index:", e);
			}
		}
		// No need for manual loop handling - YouTube handles it now
	};

	const loadAndPlayVideo = (videoIds: string[]) => {
		if (!playerRef.current || videoIds.length === 0) return;
	
		try {
			if (videoIds.length === 1) {
				// Single track mode
				playerRef.current.loadVideoById({
					videoId: videoIds[0],
					startSeconds: 0,
				});
			} else {
				// Playlist mode with loop
				playerRef.current.loadPlaylist({
					playlist: videoIds,
					index: 0,
					startSeconds: 0,
				});
				// Explicitly enable looping for playlists
				playerRef.current.setLoop(true);
			}
			playerRef.current.setVolume(finalVolume);
			currentVideoIdsRef.current = videoIds.join(',');
		} catch (e) {
			console.error("Error loading video:", e);
		}
	};

	// Handle video changes
	useEffect(() => {
		if (!playerRef.current) return;

		if (youtubeIds.length > 0 && youtubeIdsString !== currentVideoIdsRef.current) {
			loadAndPlayVideo(youtubeIds);
		} else if (youtubeIds.length === 0 && currentVideoIdsRef.current) {
			// Stop playback
			try {
				playerRef.current.stopVideo();
				currentVideoIdsRef.current = "";
			} catch (e) {
				console.warn("Error stopping video:", e);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [youtubeIdsString]);

	// Handle volume changes
	useEffect(() => {
		if (!playerRef.current) return;

		try {
			playerRef.current.setVolume(finalVolume);
		} catch (e) {
			console.warn("Error setting volume:", e);
		}
	}, [finalVolume]);

	// Hidden container for the player
	return <div ref={playerContainerRef} style={{ display: "none" }} />;
}