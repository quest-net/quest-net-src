// domains/Calendar/CalendarActions.ts

import { Context } from "../Context/Context";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { LogActions } from "../Log/LogActions";
import {
	setCalendarDay,
	clearStatusesByExpirationType,
	restoreCharacter,
	restoreSharedInventories,
	decrementDayStatuses,
} from "./CalendarUtils";

export const CalendarActions = {
	/**
	 * The single canonical date mutation, matching every other domain's `edit`.
	 * Takes the target absolute day in `updates.CalendarDay` (callers do any
	 * Y/M/D or delta math, e.g. via ymdToAbsolute). The "the day moved forward"
	 * consequence -- decrementing day-based statuses -- is centralized here in
	 * `setCalendarDay`, so it happens no matter how the date is edited (steppers,
	 * text input, day-of-week jump, or a long rest that auto-advances). DM-only
	 * (enforced by ActionService / UI).
	 */
	edit(params: { updates: { CalendarDay?: number } }, context: Context): void {
		const next = params.updates?.CalendarDay;
		if (typeof next !== "number" || !Number.isFinite(next)) {
			console.warn("[Calendar] edit: invalid CalendarDay", next);
			return;
		}
		const campaign = CampaignUtils.getActiveCampaign(context);
		setCalendarDay(campaign, next);
	},

	/**
	 * Performs a short rest for all characters in GameState.
	 * Restores stats/items/skills based on their RestoreRule.shortRest values.
	 * Decrements RemainingShortRests.
	 * DM-only (enforced by ActionService / UI layer).
	 */
	shortRest(_params: {}, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Check if short rests are available
		if (campaign.GameState.RemainingShortRests <= 0) {
			LogActions.create(
				{
					action: "Short rest failed",
					details: "No short rests remaining for today",
					category: "character",
					level: "important",
					visibility: ["all"],
				},
				context
			);
			return;
		}

		// Restore all characters
		campaign.GameState.Characters.forEach((character) => {
			restoreCharacter(character, "shortRest", campaign);
		});

		// Restore shared inventory stats
		restoreSharedInventories(campaign, "shortRest");

		// Clear "until short rest" statuses from all characters and entities
		clearStatusesByExpirationType(campaign, ["shortRest"]);

		// Decrement remaining short rests
		campaign.GameState.RemainingShortRests--;

		LogActions.create(
			{
				action: "Short rest",
				details: `Party took a short rest. ${campaign.GameState.RemainingShortRests} short rest(s) remaining today.`,
				category: "character",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Performs a long rest for all characters in GameState.
	 * Restores stats/items/skills based on their RestoreRule.longRest values.
	 * Optionally advances the calendar by 1 day and resets RemainingShortRests.
	 * DM-only (enforced by ActionService / UI layer).
	 */
	longRest(_params: {}, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const restSettings = campaign.Settings.RestSettings;

		// Restore all characters
		campaign.GameState.Characters.forEach((character) => {
			restoreCharacter(character, "longRest", campaign);
		});

		// Restore shared inventory stats
		restoreSharedInventories(campaign, "longRest");

		// Clear "until short rest" and "until long rest" statuses (long rest is a superset)
		clearStatusesByExpirationType(campaign, ["shortRest", "longRest"]);

		// Reset short rests for the new day
		campaign.GameState.RemainingShortRests = restSettings.shortRestsPerDay;

		// A long rest counts as a day passing for day-based statuses. If the day
		// also auto-advances, route through setCalendarDay so it decrements those
		// statuses in the one canonical place; otherwise just tick the statuses
		// (no calendar move).
		if (restSettings.autoAdvanceDayOnLongRest) {
			setCalendarDay(campaign, campaign.GameState.CalendarDay + 1);
		} else {
			decrementDayStatuses(campaign);
		}

		LogActions.create(
			{
				action: "Long rest",
				details: restSettings.autoAdvanceDayOnLongRest
					? "Party took a long rest. A new day has begun."
					: "Party took a long rest.",
				category: "character",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},
};
