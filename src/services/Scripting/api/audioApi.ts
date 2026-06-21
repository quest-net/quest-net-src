/**
 * Audio singleton facade.
 *
 * Shape: SINGLETON (one playing track + volume per campaign). Namespaced under
 * `game.audio`. Tracks are referenced by name|id and resolved internally.
 *
 * Backed by `AudioUtils.findTrack(campaign, nameOrId)` (Id->Name->first glob) and
 * the already-scriptable audio:setTrack / audio:setVolume / audio:stopTrack actions.
 */
import type { Audio } from "../../../domains/Audio/Audio";
import type { ScriptApiContext } from "./apiContext";
import type { RefByNameOrId } from "./actorApi";
import { AudioUtils } from "../../../domains/Audio/AudioUtils";

export interface AudioApi {
	/** Play a track (name|id). -> audio:setTrack */
	setTrack(track: RefByNameOrId): Promise<void>;
	/** Set playback volume (0..1). -> audio:setVolume */
	setVolume(volume: number): Promise<void>;
	/** Stop the current track. -> audio:stopTrack */
	stop(): Promise<void>;
	/** Resolve a track (name|id) to its record, or undefined. -> NEW util AudioUtils.findTrack */
	getTrack(track: RefByNameOrId): Audio | undefined;
}

/** Build the audio singleton for one script run. */
export function makeAudioApi(api: ScriptApiContext): AudioApi {
	return {
		// ---- Mutations (tier 2: registered actions) ----------------------------

		setTrack: async (track) => {
			// Resolve the author-typed name/Id to a real track Id; no-op if nothing
			// matches rather than dispatching a doomed action. The handler takes
			// `{ audioId: string | string[] }` and validates ids itself.
			const audio = AudioUtils.findTrack(api.campaign(), track);
			if (!audio) return;
			await api.action("audio:setTrack", { audioId: audio.Id });
		},
		setVolume: async (volume) => {
			// The handler already clamps to 0..1, so the facade passes through as-is.
			await api.action("audio:setVolume", { volume });
		},
		stop: async () => {
			await api.action("audio:stopTrack", {});
		},

		// ---- Reads (tier 1: pure util) -----------------------------------------

		getTrack: (track) => AudioUtils.findTrack(api.campaign(), track),
	};
}
