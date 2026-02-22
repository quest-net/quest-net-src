// domains/CampaignSetting/CampaignSetting.ts
import { InventorySlot } from "../Actor/Actor";

export interface CampaignSettings {
	StatDefinitions: StatDefinition[];
	ActionDefinitions: ActionDefinition[];
	VisibilitySettings: VisibilitySettings;
	CalendarSettings: CalendarSettings;
	RestSettings: RestSettings;
	MovementSettings: MovementSettings;
	SharedInventories?: SharedInventory[];
}

export interface SharedInventory {
	Id: string;
	Name: string;
	Stats: StatDefinition[];
	Inventory: InventorySlot[];
}

export interface StatDefinition {
	Id: string;
	Name: string;
	Color: string;
	RegenRate?: number;
	Current?: number;
	Max: number;
	RestoreRule?: RestoreRule;
	OverflowTarget?: {
		InventoryId: string;
		StatId: string;
	};
}

export interface ActionDefinition {
	Id: string;
	Name: string;
	Color: string;
	Default: number;
	Current?: number;
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
 * RestoreRule determines how many uses/stats are restored during rests
 * - number: Restore this many uses/points
 * - "max": Restore to maximum uses/points
 * - undefined: No restoration for this rest type
 */
export type RestoreRule = {
	shortRest?: number | "max";
	longRest?: number | "max";
	combatEnd?: number | "max";
}