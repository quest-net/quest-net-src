export interface CampaignSettings {
	StatDefinitions: StatDefinition[];
	VisibilitySettings: VisibilitySettings;
}

export interface StatDefinition {
	Id: string;
	Name: string;
	Color: string;
	RegenRate?: number;
	Current?: number;
	Max: number;
}

export interface VisibilitySettings {
	playersSeeDMRolls: boolean;
	playersSeePeerRolls: boolean;
}

//TODO: Calendar Settings
