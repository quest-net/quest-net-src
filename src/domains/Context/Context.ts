import { Campaign } from "../Campaign/Campaign";
import { User } from "../User/User";

export interface Context {
	// User data
	User: User;
	// List of Campaigns
	Campaigns: Campaign[];
	// App Preferences
	AppSettings: Record<string, string>;
	// version
	version: string;
	// Runtime flag to indicate if we are in an optimistic update
	IsOptimistic?: boolean;
}
