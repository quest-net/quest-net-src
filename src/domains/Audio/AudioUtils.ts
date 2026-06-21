// domains/Audio/AudioUtils.ts

import type { Campaign } from "../Campaign/Campaign";
import type { Audio } from "./Audio";
import { resolveByNameOrId } from "../../utils/resolveByNameOrId";

/**
 * Pure (tier-1) audio reads/resolvers for the scripting API facade.
 * No dispatch lives here — mutations go through AudioActions.
 */
export const AudioUtils = {
	/**
	 * Resolve a track NAME or Id to its Audio record over `campaign.Audios`.
	 * Order: Id (exact) -> Name (exact, case-insensitive) -> first glob match ->
	 * undefined. Returns the live record straight from the campaign (no clone).
	 */
	findTrack(campaign: Campaign, ref: string): Audio | undefined {
		return resolveByNameOrId(campaign.Audios, ref);
	},
};
