// domains/CampaignSetting/CampaignSetting.ts

export interface CampaignSettings {
	StatDefinitions: StatDefinition[];
	VisibilitySettings: VisibilitySettings;
	CalendarSettings: CalendarSettings;
	RestSettings: RestSettings;
}

export interface StatDefinition {
	Id: string;
	Name: string;
	Color: string;
	RegenRate?: number;
	Current?: number;
	Max: number;
	RestoreRule?: RestoreRule;
}

export interface VisibilitySettings {
	playersSeeDMRolls: boolean;
	playersSeePeerRolls: boolean;
	playersSeeEntityHealth: boolean;
}

export interface CalendarSettings {
	/** Number of days in a week. If 0, “weeks” concept is disabled. */
	daysPerWeek: number;
	/** Fixed length for every month. */
	daysPerMonth: number;
	/** Number of months in a year. */
	monthsPerYear: number;

	/** Names for days of week (length should equal daysPerWeek). */
	dayNames: string[];
	/** Names for months (length should equal monthsPerYear). */
	monthNames: string[];

	/** Human labels (can be empty to “hide” the concept in UI). */
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