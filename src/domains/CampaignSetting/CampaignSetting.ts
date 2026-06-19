// domains/CampaignSetting/CampaignSetting.ts
import { SharedInventory } from "../SharedInventory/SharedInventory";
import {
	createDefaultVoxelTerrainEnvironmentPresets,
	type VoxelTerrainEnvironmentPreset,
} from "../VoxelTerrain/VoxelTerrain";

export interface CampaignSettings {
	StatDefinitions: StatDefinition[];
	ActionDefinitions: ActionDefinition[];
	AttributeDefinitions: AttributeDefinition[];
	VisibilitySettings: VisibilitySettings;
	CalendarSettings: CalendarSettings;
	RestSettings: RestSettings;
	MovementSettings: MovementSettings;
	SharedInventories?: SharedInventory[];
	InitiativeSettings?: InitiativeSettings;
	TerrainEnvironmentPresets?: VoxelTerrainEnvironmentPreset[];
}

export function getCampaignTerrainEnvironmentPresets(
	settings: Pick<CampaignSettings, "TerrainEnvironmentPresets"> | undefined
): VoxelTerrainEnvironmentPreset[] {
	if (Array.isArray(settings?.TerrainEnvironmentPresets)) {
		return settings.TerrainEnvironmentPresets;
	}

	return createDefaultVoxelTerrainEnvironmentPresets();
}

/**
 * InitiativeSettings configures combat round structure and how turn order is
 * determined within a round. Sources is an ordered chain: the first entry is the
 * primary sort key, subsequent entries are tiebreakers applied in order. All
 * sources are sorted greatest-first. Actors with no value for a source are
 * placed at the bottom of the list.
 *
 * Mode chooses the round structure:
 *  - "party": party and enemies alternate. Each side's collective acting period
 *    is one round, and Sources orders actors within their own side only.
 *  - "individual": every actor (party + entities) shares one round, and Sources
 *    orders them all against each other.
 *
 * If undefined or Sources is empty, no initiative ordering is displayed.
 */
export interface InitiativeSettings {
	Sources: InitiativeSource[];
	Mode: InitiativeMode;
}

/**
 * Initiative round-structure mode.
 *  - party: alternating party/enemy rounds.
 *  - individual: a single mixed round across all actors per cycle.
 */
export type InitiativeMode = "party" | "individual";

/**
 * InitiativeSource identifies a single sortable field on an actor.
 * - stat: reads StatSlot.Current (resolved through campaign templates) by Id
 * - attribute: reads AttributeSlot.Value (parsed as a number) by Id
 * - moveSpeed: reads the Actor.MoveSpeed direct field
 */
export type InitiativeSource =
	| { kind: "stat"; statId: string }
	| { kind: "attribute"; attributeId: string }
	| { kind: "moveSpeed" };

/**
 * StatDefinition is a campaign-wide template that defines a stat type.
 * Actors store StatSlots that reference these by Id.
 * Max/RegenRate/RestoreRule serve as defaults for new actors;
 * individual actors can override these in their StatSlot.
 */
export interface StatDefinition {
	Id: string;
	Name: string;
	Color: string;
	Max: number;
	RegenRate?: number;
	RestoreRule?: RestoreRule;
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

export interface StatCost {
	statId: string;
	amount: number;
}

export interface ActionCost {
	actionId: string;
	amount: number;
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
	/**
	 * The following gate what a player sees when inspecting an ENTITY (NPCs/
	 * enemies). They do not affect the DM, nor characters. UI-only gates: the
	 * data is still synced, just not rendered. Treated as visible when undefined
	 * (so existing campaigns are unaffected).
	 */
	playersSeeEntityDescriptions?: boolean;
	playersSeeEntityAttributes?: boolean;
	/** Whether a player sees an entity's per-turn action counts (action bubbles). */
	playersSeeEntityActions?: boolean;
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

	/**
	 * Display-only switch for the in-world calendar. When false, the date/year/
	 * week readout is hidden everywhere (the Calendar tab keeps its rest controls
	 * and the day-tracking math still runs in the background). Treated as enabled
	 * when undefined.
	 */
	enabled?: boolean;

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
	 * Whether flying actors use reduced vertical movement costs. If true, a
	 * CanFly actor's climb cost is capped at 1 per height level while still using
	 * cheaper height-cost formulas when configured.
	 */
	flyingIgnoresHeight: boolean;

	/**
	 * Whether players are restricted to their calculated movement range during
	 * combat. This is enforced by the client UI: world view only offers in-range
	 * moves, first-person applies a soft pullback toward the turn-start position,
	 * and DMs are never restricted by this setting.
	 */
	restrictPlayerMovementToRange: boolean;
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
