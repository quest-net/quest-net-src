import { RestoreRule } from "../CampaignSetting/CampaignSetting";

export interface Skill {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;
	Tags?: string[];

	// Skill properties
	StatCost?: { statId: string; amount: number }
	MaxUses?: number;

	// Dice roll functionality
	DiceRoll?: string; // "1d20+3", "4d6"
	RestoreRule?: RestoreRule;
}
