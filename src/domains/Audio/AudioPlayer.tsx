// domains/Audio/AudioPlayer.tsx

import { useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { AppSettingActions } from "../AppSetting/AppSettingActions";

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
	const currentVideoIdRef = useRef<string>("");
	const playerContainerRef = useRef<HTMLDivElement>(null);

	// Get volumes
	const dmVolume = campaign.GameState.Volume;
	const playerVolume = AppSettingActions.getPlayerVolume(context);
	const finalVolume = dmVolume * playerVolume * 0.5 * 100; // YouTube uses 0-100 scale

	// Get current audio
	const currentAudioId = campaign.GameState.Audio;
	const currentAudio = currentAudioId
		? campaign.Audios.find((a) => a.Id === currentAudioId)
		: null;
	const youtubeId = currentAudio?.YoutubeId || "";

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
			},
			events: {
				onReady: onPlayerReady,
				onStateChange: onPlayerStateChange,
			},
		});
	};

	const onPlayerReady = () => {
		// Player is ready, load video if we have one
		if (youtubeId && youtubeId !== currentVideoIdRef.current) {
			loadAndPlayVideo(youtubeId);
		}
	};

	const onPlayerStateChange = (event: any) => {
		// Loop video when it ends
		if (event.data === window.YT.PlayerState.ENDED) {
			playerRef.current?.playVideo();
		}
	};

	const loadAndPlayVideo = (videoId: string) => {
		if (!playerRef.current || !videoId) return;

		try {
			playerRef.current.loadVideoById(videoId);
			playerRef.current.setVolume(finalVolume);
			currentVideoIdRef.current = videoId;
		} catch (e) {
			console.error("Error loading video:", e);
		}
	};

	// Handle video changes
	useEffect(() => {
		if (!playerRef.current) return;

		if (youtubeId && youtubeId !== currentVideoIdRef.current) {
			loadAndPlayVideo(youtubeId);
		} else if (!youtubeId && currentVideoIdRef.current) {
			// Stop playback
			try {
				playerRef.current.stopVideo();
				currentVideoIdRef.current = "";
			} catch (e) {
				console.warn("Error stopping video:", e);
			}
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [youtubeId]);

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