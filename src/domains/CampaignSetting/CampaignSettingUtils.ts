import type { StatSlot, ActionSlot, AttributeSlot } from "../Actor/Actor";
import type {
	StatDefinition,
	ActionDefinition,
	AttributeDefinition,
	CampaignSettings,
	RestoreRule,
} from "./CampaignSetting";
import type { Campaign } from "../Campaign/Campaign";
import {
	MAX_HEIGHT,
	createDefaultVoxelTerrainEnvironmentPresets,
} from "../VoxelTerrain/VoxelTerrain";
import * as math from "mathjs";

/**
 * Ensures actor stat slots match the current template set.
 * - New templates get default slots added.
 * - Removed templates have their slots dropped.
 * - Existing slots preserve their instance data.
 */
export function syncStatSlots(
	slots: StatSlot[],
	templates: StatDefinition[]
): StatSlot[] {
	const existingMap = new Map(slots.map((s) => [s.Id, s]));

	return templates.map((t) => {
		const existing = existingMap.get(t.Id);
		if (existing) return existing;
		return { Id: t.Id, Current: t.Max, Max: t.Max };
	});
}

/**
 * Ensures actor action slots match the current template set.
 */
export function syncActionSlots(
	slots: ActionSlot[],
	templates: ActionDefinition[]
): ActionSlot[] {
	const existingMap = new Map(slots.map((s) => [s.Id, s]));

	return templates.map((t) => {
		const existing = existingMap.get(t.Id);
		if (existing) return existing;
		return { Id: t.Id, Max: t.Max, Current: t.Max };
	});
}

/**
 * Ensures actor attribute slots match the current template set.
 */
export function syncAttributeSlots(
	slots: AttributeSlot[],
	templates: AttributeDefinition[]
): AttributeSlot[] {
	const existingMap = new Map(slots.map((s) => [s.Id, s]));

	return templates.map((t) => {
		const existing = existingMap.get(t.Id);
		if (existing) return existing;
		return { Id: t.Id, Value: "" };
	});
}

// ============================================================================
// FORMULA VALIDATION
// ============================================================================

export interface ValidationResult {
	valid: boolean;
	lookup?: number[];
	error?: string;
}

/**
 * Validates a height cost formula and builds the lookup table
 * Returns validation result with pre-computed costs for h=0 to MAX_HEIGHT
 */
export function validateAndBuildHeightCostLookup(
	formula: string
): ValidationResult {
	const lookup = new Array(MAX_HEIGHT);

	// Start from h=1 since h=0 (no height change) doesn't use the lookup
	for (let h = 1; h <= MAX_HEIGHT; h++) {
		try {
			const scope = { h };
			const result = math.evaluate(formula, scope);

			// Validation checks
			if (!Number.isFinite(result)) {
				return {
					valid: false,
					error: `Formula produces invalid value at h=${h} (got: ${result})`,
				};
			}

			if (result < 0) {
				return {
					valid: false,
					error: `Formula produces negative cost at h=${h} (got: ${result})`,
				};
			}

			// Increased limit to 10,000 to allow exponential formulas
			if (result > 10000) {
				return {
					valid: false,
					error: `Formula produces unreasonably high cost at h=${h} (got: ${result}). Maximum allowed is 10,000.`,
				};
			}

			// Floor the result to get integer movement cost
			// Store at index h-1 (so lookup[0] = cost for h=1, lookup[1] = cost for h=2, etc.)
			lookup[h - 1] = Math.max(0, Math.floor(result));
		} catch (error) {
			return {
				valid: false,
				error: `Invalid formula at h=${h}: ${error instanceof Error ? error.message : "Unknown error"
					}`,
			};
		}
	}

	return { valid: true, lookup };
}

/**
 * Formats a RestoreRule into human-readable text
 * Returns an array of strings, one per restore type
 */
export function formatRestoreRule(rule?: RestoreRule): string[] {
	if (!rule) return [];

	const lines: string[] = [];

	const formatValue = (val: RestoreRule["shortRest"], restLabel: string) => {
		if (val === undefined) return;
		if (val === "max") {
			lines.push(`Restores fully ${restLabel}`);
		} else if (typeof val === "object" && "setTo" in val) {
			lines.push(`Sets to ${val.setTo} ${restLabel}`);
		} else {
			lines.push(`Restores ${val} use${val === 1 ? '' : 's'} ${restLabel}`);
		}
	};

	formatValue(rule.shortRest, "on short rest");
	formatValue(rule.longRest, "on long rest");
	formatValue(rule.combatEnd, "at combat end");

	return lines;
}

/**
 * Propagates template changes to all actor slots in the campaign.
 * When templates are added, actors get new default slots.
 * When templates are removed, orphaned slots are dropped.
 * Existing slot instance data (Current, Max, overrides) is preserved.
 */
export function propagateTemplatesToActors(campaign: Campaign): void {
	const settings = campaign.Settings;

	const actors = [
		...campaign.CharacterRoster,
		...campaign.GameState.Characters,
		...campaign.EntityTemplates,
		...campaign.GameState.Entities,
	];

	for (const actor of actors) {
		actor.Stats = syncStatSlots(actor.Stats ?? [], settings.StatDefinitions);
		actor.Actions = syncActionSlots(actor.Actions ?? [], settings.ActionDefinitions);
		actor.Attributes = syncAttributeSlots(actor.Attributes ?? [], settings.AttributeDefinitions ?? []);
	}
}

// ============================================================================
// CAMPAIGN SETTING UTILS OBJECT
// ============================================================================

export const CampaignSettingUtils = {
	/**
	 * Creates default campaign settings
	 */
	createDefault(): CampaignSettings {
		// Default formula: gentle slopes (2 height = 1 movement)
		const defaultFormula = "floor(h/2)";
		const defaultLookup = validateAndBuildHeightCostLookup(defaultFormula);

		// This should never fail, but safety check
		if (!defaultLookup.valid) {
			console.error("Default formula failed validation:", defaultLookup.error);
			// Fallback to linear if somehow default fails
			const fallback = validateAndBuildHeightCostLookup("h");
			return {
				StatDefinitions: [
					{
						Id: "health",
						Name: "Health",
						Color: "#ff0000",
						Max: 50,
						RestoreRule: {
							longRest: "max",
						},
					},
					{
						Id: "mana",
						Name: "Mana",
						Color: "#0066ff",
						Max: 20,
						RestoreRule: {
							longRest: "max",
						},
					},
				],
				ActionDefinitions: [
					{ Id: "combat", Name: "Combat Action", Color: "#ef4444", Max: 1 },
					{ Id: "noncombat", Name: "Non-Combat Action", Color: "#3b82f6", Max: 1 },
				],
				AttributeDefinitions: [],
				SharedInventories: [],
				VisibilitySettings: {
					playersSeeDMRolls: false,
					playersSeePeerRolls: true,
					playersSeeEntityHealth: false,
					playersSeeEntityDescriptions: true,
					playersSeeEntityAttributes: true,
					playersSeeEntityActions: true,
				},
				CalendarSettings: {
					enabled: true,
					daysPerWeek: 7,
					daysPerMonth: 30,
					monthsPerYear: 12,
					dayNames: [
						"Sunday",
						"Monday",
						"Tuesday",
						"Wednesday",
						"Thursday",
						"Friday",
						"Saturday",
					],
					monthNames: [
						"January",
						"February",
						"March",
						"April",
						"May",
						"June",
						"July",
						"August",
						"September",
						"October",
						"November",
						"December",
					],
					weekLabel: "week",
					monthLabel: "month",
					yearLabel: "Year",
				},
				RestSettings: {
					shortRestsPerDay: 2,
					autoAdvanceDayOnLongRest: true,
				},
				MovementSettings: {
					heightCostFormula: "h",
					heightCostLookup: fallback.lookup!,
					flyingIgnoresHeight: true,
					restrictPlayerMovementToRange: false,
				},
				TerrainEnvironmentPresets: createDefaultVoxelTerrainEnvironmentPresets(),
			};
		}

		return {
			StatDefinitions: [
				{
					Id: "health",
					Name: "Health",
					Color: "#ff0000",
					Max: 50,
					RestoreRule: {
						longRest: "max",
					},
				},
				{
					Id: "mana",
					Name: "Mana",
					Color: "#0066ff",
					Max: 20,
					RestoreRule: {
						longRest: "max",
					},
				},
			],
			ActionDefinitions: [
				{ Id: "combat", Name: "Combat Action", Color: "#ef4444", Max: 1 },
				{ Id: "noncombat", Name: "Non-Combat Action", Color: "#3b82f6", Max: 1 },
			],
			AttributeDefinitions: [],
			SharedInventories: [],
			VisibilitySettings: {
				playersSeeDMRolls: false,
				playersSeePeerRolls: true,
				playersSeeEntityHealth: false,
				playersSeeEntityDescriptions: true,
				playersSeeEntityAttributes: true,
				playersSeeEntityActions: true,
			},
			CalendarSettings: {
				enabled: true,
				daysPerWeek: 7,
				daysPerMonth: 30,
				monthsPerYear: 12,
				dayNames: [
					"Sunday",
					"Monday",
					"Tuesday",
					"Wednesday",
					"Thursday",
					"Friday",
					"Saturday",
				],
				monthNames: [
					"January",
					"February",
					"March",
					"April",
					"May",
					"June",
					"July",
					"August",
					"September",
					"October",
					"November",
					"December",
				],
				weekLabel: "week",
				monthLabel: "month",
				yearLabel: "Year",
			},
			RestSettings: {
				shortRestsPerDay: 2,
				autoAdvanceDayOnLongRest: true,
			},
			MovementSettings: {
				heightCostFormula: defaultFormula,
				heightCostLookup: defaultLookup.lookup!,
				flyingIgnoresHeight: true,
				restrictPlayerMovementToRange: false,
			},
			TerrainEnvironmentPresets: createDefaultVoxelTerrainEnvironmentPresets(),
		};
	},
};
