import { ActionCost, RestoreRule, StatCost } from "../CampaignSetting/CampaignSetting";
import type { Script, ScriptParam } from "../Script/Script";

export interface Skill {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;
	Tags?: string[];

	// Skill properties
	StatCost?: StatCost;
	ActionCost?: ActionCost;
	MaxUses?: number;

	// Dice roll functionality
	DiceRoll?: string; // "1d20+3", "4d6"
	RestoreRule?: RestoreRule;

	// Scripting. Behavior hooks + DM-tunable param declarations (on the template).
	Scripts?: Script[];
	Parameters?: ScriptParam[];
}
