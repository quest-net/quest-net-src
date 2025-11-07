import { Context } from "../Context/Context";
import { CampaignSettings } from "./CampaignSetting";
import { CampaignActions } from "../Campaign/CampaignActions";
import { MAX_HEIGHT } from "../Terrain/Terrain";
import * as math from "mathjs";

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
				error: `Invalid formula at h=${h}: ${
					error instanceof Error ? error.message : "Unknown error"
				}`,
			};
		}
	}

	return { valid: true, lookup };
}
// ============================================================================
// CAMPAIGN SETTING ACTIONS
// ============================================================================

export const CampaignSettingActions = {
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
				VisibilitySettings: {
					playersSeeDMRolls: false,
					playersSeePeerRolls: true,
					playersSeeEntityHealth: false,
				},
				CalendarSettings: {
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
				},
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
			VisibilitySettings: {
				playersSeeDMRolls: false,
				playersSeePeerRolls: true,
				playersSeeEntityHealth: false,
			},
			CalendarSettings: {
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
			},
		};
	},

	/**
	 * Updates campaign settings
	 * Replaces the entire Settings object or merges partial updates
	 */
	edit(params: { updates: Partial<CampaignSettings> }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		Object.assign(campaign.Settings, params.updates);
	},
};