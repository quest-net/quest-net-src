import { Campaign } from "../Campaign/Campaign";
import { CampaignInfo } from "../Campaign/CampaignInfo";
import { User } from "../User/User";

export interface Context {
	// User data
	User: User;
	// Lightweight metadata for every campaign the user has on this device.
	// Full campaign payloads live in IndexedDB and are only unpacked into
	// ActiveCampaign while we are actively viewing/playing them.
	Campaigns: CampaignInfo[];
	// The campaign that is currently "unpacked" — either because we are on
	// its URL, or because it was the most recently opened campaign and has
	// not yet been displaced by another. Null when no campaign is active.
	ActiveCampaign: Campaign | null;
	// App Preferences
	AppSettings: Record<string, string>;
	// version
	version: string;
	// Runtime flag to indicate if we are in an optimistic update
	IsOptimistic?: boolean;
	// Runtime flag for DM to prevent broadcasting changes per campaign ID
	SecretModes?: Record<string, boolean>;
}
