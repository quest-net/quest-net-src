import { Context } from "../Context/Context";
import { CampaignSettings } from "./CampaignSetting";
import { CampaignActions } from "../Campaign/CampaignActions";

export const CampaignSettingActions = {
	/**
	 * Creates default campaign settings
	 */
	createDefault(): CampaignSettings {
		return {
			StatDefinitions: [
				{ 
					Id: "health", 
					Name: "Health", 
					Color: "#ff0000", 
					Max: 50,
					RestoreRule: {
						longRest: "max"
					}
				},
				{ 
					Id: "mana", 
					Name: "Mana", 
					Color: "#0066ff", 
					Max: 20,
					RestoreRule: {
						longRest: "max"
					}
				},
			],
			VisibilitySettings: {
				playersSeeDMRolls: false,
				playersSeePeerRolls: true,
				playersSeeEntityHealth: false,
			},
			CalendarSettings: {
				// Earth-like defaults (no leap years; every month has 30 days)
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