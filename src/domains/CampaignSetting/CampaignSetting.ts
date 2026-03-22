// domains/CampaignSetting/CampaignSetting.ts
import { InventorySlot } from "../Actor/Actor";

export interface CampaignSettings {
	StatDefinitions: StatDefinition[];
	ActionDefinitions: ActionDefinition[];
	AttributeDefinitions: AttributeDefinition[];
	VisibilitySettings: VisibilitySettings;
	CalendarSettings: CalendarSettings;
	RestSettings: RestSettings;
	MovementSettings: MovementSettings;
	SharedInventories?: SharedInventory[];
}

export interface SharedInventory {
	Id: string;
	Name: string;
	Stats: import("../Actor/Actor").StatSlot[];
	Inventory: InventorySlot[];
}

/**
 * StatDefinition is a campaign-wide template that defines a stat type.
 * Actors store StatSlots that reference these by Id.
 * Max/RegenRate/RestoreRule/OverflowTarget serve as defaults for new actors;
 * individual actors can override these in their StatSlot.
 */
export interface StatDefinition {
	Id: string;
	Name: string;
	Color: string;
	Max: number;
	RegenRate?: number;
	RestoreRule?: RestoreRule;
	OverflowTarget?: {
		InventoryId: string;
		StatId: string;
	};
}

/**
 * ActionDefinition is a campaign-wide template that defines an action type.
 * Actors store ActionSlots that reference these by Id.
 * Name and Color always come from the template.
 * Max serves as the default "actions per turn" for new actors.
 */
export interface ActionDefinition {
	Id: string;
	Name: string;
	Color: string;
	Max: number;
}

/**
 * AttributeDefinition is a campaign-wide template that defines an attribute key.
 * Actors store AttributeSlots that reference these by Id.
 * All actors auto-receive a slot for each defined attribute.
 */
export interface AttributeDefinition {
	Id: string;
	Name: string;
}

export interface VisibilitySettings {
	playersSeeDMRolls: boolean;
	playersSeePeerRolls: boolean;
	playersSeeEntityHealth: boolean;
}

export interface CalendarSettings {
	/** Number of days in a week. If 0, "weeks" concept is disabled. */
	daysPerWeek: number;
	/** Fixed length for every month. */
	daysPerMonth: number;
	/** Number of months in a year. */
	monthsPerYear: number;

	/** Names for days of week (length should equal daysPerWeek). */
	dayNames: string[];
	/** Names for months (length should equal monthsPerYear). */
	monthNames: string[];

	/** Human labels (can be empty to "hide" the concept in UI). */
	weekLabel?: string;   // e.g., "week", "tenday"
	monthLabel?: string;  // e.g., "month", "moonth"
	yearLabel?: string;   // e.g., "Year", "Solar Cycle"
}

export interface RestSettings {
	/** Maximum number of short rests allowed per day (0 = unlimited) */
	shortRestsPerDay: number;
	/** Automatically advance calendar by 1 day when long rest is taken */
	autoAdvanceDayOnLongRest: boolean;
}

/**
 * MovementSettings controls how terrain height affects movement costs
 */
export interface MovementSettings {
	/**
	 * Formula for calculating movement cost based on height difference
	 * Uses 'h' as the variable for absolute height difference
	 * Examples: "floor(h/2)", "h", "2*h", "ceil(h/2)"
	 */
	heightCostFormula: string;

	/**
	 * Pre-computed lookup table for movement costs
	 * Index = height difference (0 to MAX_HEIGHT)
	 * Value = movement cost for that height difference
	 * This is built when the formula is saved to avoid runtime evaluation
	 */
	heightCostLookup: number[];

	/**
	 * Whether flying actors ignore vertical movement costs
	 * If true, CanFly actors only pay horizontal movement costs
	 */
	flyingIgnoresHeight: boolean;
}

/**
 * RestoreRuleValue determines how a resource is restored during a rest
 * - number: Restore BY this many uses/points (incremental)
 * - "max": Restore TO maximum uses/points
 * - { setTo: number }: Set TO an exact value
 * - undefined: No restoration for this rest type
 */
export type RestoreRuleValue = number | "max" | { setTo: number };

export type RestoreRule = {
	shortRest?: RestoreRuleValue;
	longRest?: RestoreRuleValue;
	combatEnd?: RestoreRuleValue;
}