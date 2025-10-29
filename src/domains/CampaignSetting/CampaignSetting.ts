export interface CampaignSettings {
	StatDefinitions: StatDefinition[];
	VisibilitySettings: VisibilitySettings;
	MapSettings: MapSettings;
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

export interface MapSettings {
	is3D: boolean;
}
