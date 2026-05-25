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
	const isPlayerReadyRef = useRef(false);
	const currentVideoIdsRef = useRef<string>("");
	const playerContainerRef = useRef<HTMLDivElement>(null);
	const checkIntervalRef = useRef<number | null>(null);

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
	const finalVolumeRef = useRef(finalVolume);
	const youtubeIdsRef = useRef(youtubeIds);
	const youtubeIdsStringRef = useRef(youtubeIdsString);
	finalVolumeRef.current = finalVolume;
	youtubeIdsRef.current = youtubeIds;
	youtubeIdsStringRef.current = youtubeIdsString;

	const { currentTrackIndex, setCurrentTrackIndex } = useAudioState();

	// Load YouTube IFrame API
	useEffect(() => {
		if (window.YT && window.YT.Player) {
			initializePlayer();
		} else if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
			// Check if script is already loading
			window.onYouTubeIframeAPIReady = initializePlayer;
		} else {
			// Load the script
			const tag = document.createElement("script");
			tag.src = "https://www.youtube.com/iframe_api";
			const firstScriptTag = document.getElementsByTagName("script")[0];
			firstScriptTag.parentNode?.insertBefore(tag, firstScriptTag);

			window.onYouTubeIframeAPIReady = initializePlayer;
		}

		// Cleanup
		return () => {
			if (playerRef.current) {
				try {
					playerRef.current.destroy();
				} catch (e) {
					console.warn("Error destroying player:", e);
				}
				playerRef.current = null;
				isPlayerReadyRef.current = false;
			}
			if (checkIntervalRef.current) {
				clearInterval(checkIntervalRef.current);
			}
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const getReadyPlayer = () => {
		const player = playerRef.current;
		if (!player || !isPlayerReadyRef.current) return null;
		return player;
	};

	const setPlayerVolume = (volume = finalVolumeRef.current) => {
		const player = getReadyPlayer();
		if (!player || typeof player.setVolume !== "function") return;

		try {
			player.setVolume(volume);
		} catch (e) {
			console.warn("Error setting volume:", e);
		}
	};

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

	const onPlayerReady = (event?: any) => {
		if (event?.target) {
			playerRef.current = event.target;
		}
		isPlayerReadyRef.current = true;
		setPlayerVolume();

		// Player is ready, load video(s) if we have any
		if (youtubeIdsRef.current.length > 0 && youtubeIdsStringRef.current !== currentVideoIdsRef.current) {
			loadAndPlayVideo(youtubeIdsRef.current);
		}
		
		// Start polling for track changes when playing a playlist
		if (youtubeIdsRef.current.length > 1) {
			startTrackPolling();
		}
	};

	const onPlayerStateChange = (event: any) => {
		// When video starts playing, check the track index
		if (event.data === 1 && youtubeIds.length > 1) { // 1 = playing
			updateCurrentTrackIndex();
		}
	};

	const updateCurrentTrackIndex = () => {
		if (!playerRef.current || youtubeIds.length <= 1) return;

		try {
			// Get the current video URL
			const currentUrl = playerRef.current.getVideoUrl();
			if (!currentUrl) return;

			// Extract video ID from URL
			const match = currentUrl.match(/[?&]v=([^&]+)/);
			if (!match) return;

			const currentVideoId = match[1];

			// Find this video ID in our playlist
			const newIndex = youtubeIds.findIndex(id => id === currentVideoId);
			
			if (newIndex !== -1 && newIndex !== currentTrackIndex) {
				setCurrentTrackIndex(newIndex);
			}
		} catch (e) {
			console.warn("Error updating track index:", e);
		}
	};

	const startTrackPolling = () => {
		// Clear any existing interval
		if (checkIntervalRef.current) {
			clearInterval(checkIntervalRef.current);
		}

		// Poll every second to check if track changed
		checkIntervalRef.current = window.setInterval(() => {
			updateCurrentTrackIndex();
		}, 1000);
	};

	const stopTrackPolling = () => {
		if (checkIntervalRef.current) {
			clearInterval(checkIntervalRef.current);
			checkIntervalRef.current = null;
		}
	};

	const loadAndPlayVideo = (videoIds: string[]) => {
		const player = getReadyPlayer();
		if (!player || videoIds.length === 0) return;
	  
		try {
		  setCurrentTrackIndex(0);
	  
		  if (videoIds.length === 1) {
			// Single video must be loaded as a one-item playlist to loop
			player.loadPlaylist({
			  playlist: videoIds,
			  index: 0,
			  startSeconds: 0,
			});
			player.setLoop(true);
			// no need to poll for track changes in 1-item playlist
			stopTrackPolling();
		  } else {
			// Regular playlist path
			player.loadPlaylist({
			  playlist: videoIds,
			  index: 0,
			  startSeconds: 0,
			});
			player.setLoop(true);
			startTrackPolling();
		  }
	  
		  setPlayerVolume();
		  currentVideoIdsRef.current = videoIds.join(",");
		} catch (e) {
		  console.error("Error loading video:", e);
		}
	  };

	// Handle video changes
	useEffect(() => {
		const player = getReadyPlayer();
		if (!player) return;

		if (youtubeIds.length > 0 && youtubeIdsString !== currentVideoIdsRef.current) {
			loadAndPlayVideo(youtubeIds);
		} else if (youtubeIds.length === 0 && currentVideoIdsRef.current) {
			// Stop playback
			try {
				player.stopVideo();
				currentVideoIdsRef.current = "";
				setCurrentTrackIndex(0);
				stopTrackPolling();
			} catch (e) {
				console.warn("Error stopping video:", e);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [youtubeIdsString]);

	// Handle volume changes
	useEffect(() => {
		setPlayerVolume(finalVolume);
	}, [finalVolume]);

	// Cleanup polling on unmount
	useEffect(() => {
		return () => {
			stopTrackPolling();
		};
	}, []);

	// Hidden container for the player
	return <div ref={playerContainerRef} style={{ display: "none" }} />;
}
