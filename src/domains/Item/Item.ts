import { ActionCost, RestoreRule, StatCost } from "../CampaignSetting/CampaignSetting";
import type { Script, ScriptParam } from "../Script/Script";

export interface Item {
	Id: string;
	Name: string;
	Description?: string;
	Image?: string;
	Tags?: string[];

	// Item properties
	StatCost?: StatCost;
	ActionCost?: ActionCost;
	MaxUses?: number; // undefined = infinite uses
	IsEquippable: boolean;

	// Targeting. When set, using the item enters map "targeting mode" and the
	// chosen target is threaded into the use action (no mechanical effect yet --
	// consumed by the scripting system later). Both may be enabled independently.
	CanTargetActor?: boolean;
	CanTargetPosition?: boolean;

	// Dice roll functionality
	DiceRoll?: string; // "3d6", "1d20+5", "2d10-2"
	RestoreRule?: RestoreRule;

	// Scripting. Behavior hooks + DM-tunable param declarations (on the template).
	Scripts?: Script[];
	Parameters?: ScriptParam[];
}
