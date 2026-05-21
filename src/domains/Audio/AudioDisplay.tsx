// domains/Audio/AudioDisplay.tsx

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { AppSettingActions } from "../AppSetting/AppSettingActions";
import { isDmAccess } from "../../utils/UrlParser";
import { AudioVisualizer } from "./AudioVisualizer";
import { extractPathTags } from "../../utils/FolderUtils";
import { useAudioState } from "./AudioContext";

type SearchResult =
	| { kind: "playlist"; key: string; name: string; trackCount: number }
	| { kind: "track"; key: string; name: string; audioId: string };

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

	// All folders (playlists) on the campaign
	const allFolders = useMemo(
		() =>
			Array.from(
				new Set(
					campaign.Audios.flatMap((audio) =>
						extractPathTags(audio.Tags).map((path) => path)
					)
				)
			).sort(),
		[campaign.Audios]
	);

	// Volume state
	const dmVolume = campaign.GameState.Volume;
	const playerVolume = AppSettingActions.getPlayerVolume(context);
	const displayVolume = isDM ? dmVolume : playerVolume;

	const [localVolume, setLocalVolume] = useState(displayVolume * 100);
	const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

	// Search state
	const [isSearching, setIsSearching] = useState(false);
	const [searchQuery, setSearchQuery] = useState("");
	const containerRef = useRef<HTMLDivElement>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);

	// Update local volume when external volume changes
	useEffect(() => {
		setLocalVolume(displayVolume * 100);
	}, [displayVolume]);

	// Auto-focus search input when search mode is opened
	useEffect(() => {
		if (isSearching) {
			searchInputRef.current?.focus();
		}
	}, [isSearching]);

	// Close search when clicking outside the AudioDisplay
	useEffect(() => {
		if (!isSearching) return;

		const handleClickOutside = (e: MouseEvent) => {
			if (
				containerRef.current &&
				!containerRef.current.contains(e.target as Node)
			) {
				exitSearch();
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		return () => document.removeEventListener("mousedown", handleClickOutside);
	}, [isSearching]);

	// Build combined results (playlists + tracks), filtered by query, sorted by name
	const searchResults = useMemo<SearchResult[]>(() => {
		const query = searchQuery.trim().toLowerCase();

		const playlistResults: SearchResult[] = allFolders
			.filter((folder) => query === "" || folder.toLowerCase().includes(query))
			.map((folder) => ({
				kind: "playlist",
				key: `pl:${folder}`,
				name: folder,
				trackCount: campaign.Audios.filter((a) =>
					extractPathTags(a.Tags).includes(folder)
				).length,
			}));

		const trackResults: SearchResult[] = campaign.Audios.filter(
			(audio) => query === "" || audio.Name.toLowerCase().includes(query)
		).map((audio) => ({
			kind: "track",
			key: `tr:${audio.Id}`,
			name: audio.Name,
			audioId: audio.Id,
		}));

		// Playlists float to the top, with each group sorted alphabetically.
		playlistResults.sort((a, b) => a.name.localeCompare(b.name));
		trackResults.sort((a, b) => a.name.localeCompare(b.name));
		return [...playlistResults, ...trackResults];
	}, [allFolders, campaign.Audios, searchQuery]);

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

	const exitSearch = () => {
		setIsSearching(false);
		setSearchQuery("");
	};

	const handleSelectResult = (result: SearchResult) => {
		if (!actionService) {
			exitSearch();
			return;
		}

		if (result.kind === "playlist") {
			const tracksInFolder = campaign.Audios.filter((audio) =>
				extractPathTags(audio.Tags).includes(result.name)
			).sort((a, b) => a.Name.localeCompare(b.Name));
			const audioIds = tracksInFolder.map((t) => t.Id);
			if (audioIds.length > 0) {
				actionService.execute("audio:setTrack", { audioId: audioIds });
			}
		} else {
			actionService.execute("audio:setTrack", { audioId: result.audioId });
		}

		exitSearch();
	};

	const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
		if (e.key === "Escape") {
			e.preventDefault();
			exitSearch();
		}
	};

	const showSearchButton = isDM && campaign.Audios.length > 0 && !isSearching;

	return (
		<div ref={containerRef} className="space-y-4 relative">
			{/* Floating Search Button (DM only, hidden while searching) */}
			{showSearchButton && (
				<div className="absolute top-1 right-1 z-10">
					<button
						onClick={() => setIsSearching(true)}
						className="btn btn-outline btn-square"
						title="Search playlists and tracks"
					>
						<span className="icon-[mdi--magnify] w-5 h-5" />
					</button>
				</div>
			)}

			{isSearching ? (
				/* Search Mode: takes over the whole display */
				<>
					<div className="flex items-center gap-2">
						<label className="input input-bordered input-sm flex items-center gap-2 flex-1">
							<span className="icon-[mdi--magnify] w-4 h-4 opacity-60" />
							<input
								ref={searchInputRef}
								type="text"
								placeholder="Search playlists or tracks..."
								value={searchQuery}
								onChange={(e) => setSearchQuery(e.target.value)}
								onKeyDown={handleSearchKeyDown}
								className="grow"
							/>
						</label>
						<button
							onClick={exitSearch}
							className="btn btn-sm btn-square btn-ghost"
							title="Close search (Esc)"
						>
							<span className="icon-[mdi--close] w-4 h-4" />
						</button>
					</div>

					<div className="max-h-64 overflow-y-auto -mx-1">
						{searchResults.length === 0 ? (
							<div className="text-center py-6 opacity-60 text-sm">
								No matches found
							</div>
						) : (
							<ul className="menu menu-sm p-0 [&_li>*]:rounded-md">
								{searchResults.map((result) => (
									<li key={result.key}>
										<a
											onClick={() => handleSelectResult(result)}
											className="flex items-center gap-2"
										>
											{result.kind === "playlist" ? (
												<span className="icon-[mdi--playlist-music] w-4 h-4 opacity-70 shrink-0" />
											) : (
												<span className="icon-[mdi--music-note] w-4 h-4 opacity-70 shrink-0" />
											)}
											<span className="flex-1 truncate">{result.name}</span>
											{result.kind === "playlist" && (
												<span className="text-xs opacity-50 shrink-0">
													{result.trackCount}
												</span>
											)}
										</a>
									</li>
								))}
							</ul>
						)}
					</div>
				</>
			) : currentAudio ? (
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
