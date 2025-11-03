// domains/Audio/AudioDisplay.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { AppSettingActions } from "../AppSetting/AppSettingActions";
import { isDmAccess } from "../../utils/UrlParser";
import { AudioVisualizer } from "./AudioVisualizer";
import { extractPathTags } from "../../utils/FolderUtils";
import { useAudioState } from "./AudioContext";

export function AudioDisplay() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = isDmAccess();

	// Get current audio(s)
	const currentAudioIds = campaign.GameState.Audio;
	const currentAudios = currentAudioIds
		.map((id) => campaign.Audios.find((a) => a.Id === id))
		.filter(Boolean);

	const isPlaylist = currentAudios.length > 1;
	const { currentTrackIndex } = useAudioState();

	// Get the actual currently playing track
	const currentAudio = isPlaylist
		? currentAudios[currentTrackIndex]
		: currentAudios[0];

	// Get all folders for playlist dropdown
	const allFolders = Array.from(
		new Set(
			campaign.Audios.flatMap((audio) =>
				extractPathTags(audio.Tags).map((path) => path)
			)
		)
	).sort();

	// Volume state
	const dmVolume = campaign.GameState.Volume;
	const playerVolume = AppSettingActions.getPlayerVolume(context);
	const displayVolume = isDM ? dmVolume : playerVolume;

	const [localVolume, setLocalVolume] = useState(displayVolume * 100);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Update local volume when external volume changes
	useEffect(() => {
		setLocalVolume(displayVolume * 100);
	}, [displayVolume]);

	// Debounced volume change
	const handleVolumeChange = (value: number) => {
		setLocalVolume(value);
		const normalizedVolume = value / 100;

		if (isDM) {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}

			debounceTimerRef.current = setTimeout(() => {
				actionService?.execute("audio:setVolume", {
					volume: normalizedVolume,
				});
			}, 150);
		} else {
			AppSettingActions.setPlayerVolume({ volume: normalizedVolume }, context);
		}
	};

	const handleStop = () => {
		if (!actionService) return;
		actionService.execute("audio:stopTrack", {});
	};

	const handlePlayFolder = (folderPath: string) => {
		if (!actionService) return;

		// Get all tracks in this folder (exact path match, no nested)
		const tracksInFolder = campaign.Audios.filter((audio) => {
			const paths = extractPathTags(audio.Tags);
			return paths.includes(folderPath);
		}).sort((a, b) => a.Name.localeCompare(b.Name)); // Alphabetical

		const audioIds = tracksInFolder.map((t) => t.Id);

		if (audioIds.length > 0) {
			actionService.execute("audio:setTrack", { audioId: audioIds });
		}
	};

	return (
		<div className="space-y-4 relative">
			{/* Floating Playlist Dropdown (DM only) */}
			{isDM && allFolders.length > 0 && (
				<div className="absolute top-1 right-1 z-10">
					<div className="dropdown dropdown-end">
						<label
							tabIndex={0}
							className="btn btn-outline btn-square"
							title="Play playlist"
						>
							<span className="icon-[mdi--playlist-music] w-5 h-5" />
						</label>
						<ul
							tabIndex={0}
							className="dropdown-content menu p-2 shadow bg-base-100 rounded-box w-52 max-h-64 overflow-y-auto"
						>
							<li className="menu-title">
								<span>Play Playlist</span>
							</li>
							{allFolders.map((folder) => (
								<li key={folder}>
									<a onClick={() => handlePlayFolder(folder)}>{folder}</a>
								</li>
							))}
						</ul>
					</div>
				</div>
			)}

			{currentAudio ? (
				<>
					{/* Track Info */}
					<div className="flex items-center gap-3">
						<div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
							<span className="icon-[mdi--music-note] w-6 h-6 text-primary" />
						</div>
						<div className="flex-1 min-w-0">
							<h3 className="font-semibold text-lg truncate">
								{currentAudio?.Name || "Unknown Track"}
							</h3>
							<p className="text-sm opacity-60">
								{isPlaylist
									? `Playlist (${currentTrackIndex + 1}/${
											currentAudios.length
									  })`
									: "Now Playing"}
							</p>
						</div>
						{isDM && (
							<button
								onClick={handleStop}
								className="btn btn-square btn-neutral mr-14"
								title="Stop music"
							>
								<span className="icon-[mdi--stop] w-6 h-6" />
							</button>
						)}
					</div>

					{/* Visualizer (fake, volume-aware) */}
					<div className="px-10">
						<AudioVisualizer
							level={localVolume / 100}
							bars={40}
							height={56}
							className="mt-1"
						/>
					</div>

					{/* Volume Control */}
					<div className="space-y-2">
						<div className="flex items-center gap-3">
							<span className="icon-[mdi--volume-low] w-5 h-5 opacity-60" />
							<input
								type="range"
								min="0"
								max="100"
								value={localVolume}
								onChange={(e) => handleVolumeChange(Number(e.target.value))}
								className="range range-primary flex-1"
							/>
							<span className="icon-[mdi--volume-high] w-5 h-5 opacity-60" />
						</div>
					</div>
				</>
			) : (
				<>
					{/* No Music Playing */}
					<div className="text-center">
						<div className="w-16 h-16 bg-base-300 rounded-full flex items-center justify-center mx-auto mb-2">
							<span className="icon-[mdi--music-off] w-8 h-8" />
						</div>
						<h3 className="font-semibold mb-1">No Music Playing</h3>
						<p className="text-sm opacity-60">
							It's awfully silent right now...
						</p>
					</div>

					{/* Volume Control */}
					<div className="space-y-2 mt-4">
						<div className="flex items-center gap-3">
							<span className="icon-[mdi--volume-low] w-5 h-5 opacity-60" />
							<input
								type="range"
								min="0"
								max="100"
								value={localVolume}
								onChange={(e) => handleVolumeChange(Number(e.target.value))}
								className="range range-primary flex-1"
							/>
							<span className="icon-[mdi--volume-high] w-5 h-5 opacity-60" />
						</div>
					</div>
				</>
			)}
		</div>
	);
}
