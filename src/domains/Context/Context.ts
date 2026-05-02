import { Campaign, CampaignInfo } from "../Campaign/Campaign";
import { User } from "../User/User";

export interface Context {
	// User data
	User: User;
	// Lightweight campaign metadata — full Campaign objects live in IndexedDB.
	// Persisted to localStorage. Never contains full Campaign data after v1.6.0.
	Campaigns: CampaignInfo[];
	// The currently loaded campaign. Runtime-only — never written to localStorage.
	// Populated by CampaignView when navigating to a campaign URL.
	ActiveCampaign?: Campaign;
	// App Preferences
	AppSettings: Record<string, string>;
	// version
	version: string;
	// Runtime flag to indicate if we are in an optimistic update
	IsOptimistic?: boolean;
	// Runtime flag for DM to prevent broadcasting changes per campaign ID
	SecretModes?: Record<string, boolean>;
}
