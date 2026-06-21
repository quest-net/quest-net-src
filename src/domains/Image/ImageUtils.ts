import type { Campaign } from "../Campaign/Campaign";
import type { Image } from "./Image";
import { resolveByNameOrId } from "../../utils/resolveByNameOrId";

export const ImageUtils = {
	/**
	 * Resolve an image NAME or Id to its Image record on the campaign. Images live
	 * at `campaign.Images` (metadata only; the binary lives in IndexedDB). Resolution
	 * order is the shared contract: Id exact -> Name exact (case-insensitive) ->
	 * first glob match -> undefined. The single shared image resolver; every facade
	 * that takes an image ref routes through here.
	 */
	findImage(campaign: Campaign, ref: string): Image | undefined {
		return resolveByNameOrId(campaign.Images, ref);
	},
};
