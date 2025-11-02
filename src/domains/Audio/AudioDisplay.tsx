// domains/Audio/AudioDisplay.tsx

import { useState, useEffect, useRef } from "react";
import { useQuestContext } from "../Context/ContextProvider";
import { useActionService } from "../../services/Actions/ActionServiceProvider";
import { CampaignActions } from "../Campaign/CampaignActions";
import { AppSettingActions } from "../AppSetting/AppSettingActions";
import { isDmAccess } from "../../utils/UrlParser";
import { AudioVisualizer } from "./AudioVisualizer";

export function AudioDisplay() {
	const context = useQuestContext();
	const { actionService } = useActionService();
	const campaign = CampaignActions.getActiveCampaign(context);
	const isDM = isDmAccess();

	// Get current audio
	const currentAudioId = campaign.GameState.Audio;
	const currentAudio = currentAudioId
		? campaign.Audios.find((a) => a.Id === currentAudioId)
		: null;

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

	// Debounced volume change (only for DM, player changes are instant)
	const handleVolumeChange = (value: number) => {
		setLocalVolume(value);
		const normalizedVolume = value / 100;

		if (isDM) {
			// DM volume needs debouncing to avoid excessive state syncs
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}

			debounceTimerRef.current = setTimeout(() => {
				actionService?.execute("audio:setVolume", {
					volume: normalizedVolume,
				});
			}, 150);
		} else {
			// Player volume is local only, no need to debounce
			AppSettingActions.setPlayerVolume(
				{ volume: normalizedVolume },
				context
			);
		}
	};

	const handleStop = () => {
		if (!actionService) return;
		actionService.execute("audio:stopTrack", {});
	};

	return (
		<div className="space-y-4">
		  {currentAudio ? (
			<>
			  {/* Track Info */}
			  <div className="flex items-center gap-3">
				<div className="w-12 h-12 bg-primary/20 rounded-lg flex items-center justify-center">
				  <span className="icon-[mdi--music-note] w-6 h-6 text-primary" />
				</div>
				<div className="flex-1 min-w-0">
				  <h3 className="font-semibold text-lg truncate">
					{currentAudio.Name}
				  </h3>
				  <p className="text-sm opacity-60">Now Playing</p>
				</div>
				{isDM && (
				  <button
					onClick={handleStop}
					className="btn btn-square btn-neutral"
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
				<p className="text-sm opacity-60">It's awfully silent right now...</p>
			  </div>
	
			  {/* Volume Control (kept as-is) */}
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