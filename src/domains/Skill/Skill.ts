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

	// Targeting. When set, using the skill enters map "targeting mode" and the
	// chosen target is threaded into the use action (no mechanical effect yet --
	// consumed by the scripting system later). Both may be enabled independently.
	CanTargetActor?: boolean;
	CanTargetPosition?: boolean;

	// Dice roll functionality
	DiceRoll?: string; // "1d20+3", "4d6"
	RestoreRule?: RestoreRule;

	// Scripting. Behavior hooks + DM-tunable param declarations (on the template).
	Scripts?: Script[];
	Parameters?: ScriptParam[];
}
