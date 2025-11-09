// domains/Calendar/CalendarActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { Calendar } from "./Calendar";
import { CalendarSettings } from "../CampaignSetting/CampaignSetting";
import { Character } from "../Character/Character";
import { Item } from "../Item/Item";
import { Skill } from "../Skill/Skill";

export const CalendarActions = {
	/**
	 * Resolve the current calendar config.
	 */
	getConfig(context: Context): CalendarSettings {
		const campaign = CampaignActions.getActiveCampaign(context) as any;
		return campaign.Settings.CalendarSettings;
	},

	/**
	 * Directly set absolute day (can be negative to represent pre-epoch).
	 * DM-only (enforced by ActionService / UI layer).
	 */
	setAbsolute(params: { absoluteDay: number }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		if (
			typeof params.absoluteDay !== "number" ||
			!Number.isFinite(params.absoluteDay)
		) {
			console.warn(
				"[Calendar] setAbsolute: invalid absoluteDay",
				params.absoluteDay
			);
			return;
		}
		campaign.GameState.CalendarDay = Math.trunc(params.absoluteDay);
	},

	/**
	 * Set date using Y/M/D (1-based). Values are clamped to valid ranges.
	 * DM-only (enforced by ActionService / UI layer).
	 */
	setDate(
		params: { year: number; month: number; day: number },
		context: Context
	): void {
		const cfg = CalendarActions.getConfig(context);
		const absolute = ymdToAbsolute(params, cfg);
		const campaign = CampaignActions.getActiveCampaign(context);
		campaign.GameState.CalendarDay = absolute;
	},

	/**
	 * Advance by a delta (can be negative). Weeks only apply if daysPerWeek > 0.
	 * DM-only (enforced by ActionService / UI layer).
	 */
	advance(
		params: { days?: number; weeks?: number; months?: number; years?: number },
		context: Context
	): void {
		const cfg = CalendarActions.getConfig(context);
		const campaign = CampaignActions.getActiveCampaign(context);

		const d = params.days ?? 0;
		const w = params.weeks ?? 0;
		const m = params.months ?? 0;
		const y = params.years ?? 0;

		let delta = d;

		if (cfg.daysPerWeek > 0) {
			delta += w * cfg.daysPerWeek;
		} else if (w !== 0) {
			console.warn(
				"[Calendar] weeks provided but weeks are disabled by config"
			);
		}

		delta += m * cfg.daysPerMonth;
		delta += y * daysPerYear(cfg);

		campaign.GameState.CalendarDay = Math.trunc(
			campaign.GameState.CalendarDay + delta
		);
	},

	/**
	 * Performs a short rest for all characters in GameState.
	 * Restores stats/items/skills based on their RestoreRule.shortRest values.
	 * Decrements RemainingShortRests.
	 * DM-only (enforced by ActionService / UI layer).
	 */
	shortRest(_params: {}, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

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
		const campaign = CampaignActions.getActiveCampaign(context);
		const restSettings = campaign.Settings.RestSettings;

		// Restore all characters
		campaign.GameState.Characters.forEach((character) => {
			restoreCharacter(character, "longRest", campaign);
		});

		// Reset short rests for the new day
		campaign.GameState.RemainingShortRests = restSettings.shortRestsPerDay;

		// Advance calendar if configured
		if (restSettings.autoAdvanceDayOnLongRest) {
			campaign.GameState.CalendarDay++;
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Restores a character's stats, items, and skills based on the specified rest type
 * Exported for use by CombatActions
 */
export function restoreCharacter(
	character: Character,
	restType: "shortRest" | "longRest" | "combatEnd",
	campaign: any,
): void {
	const statDefinitions = campaign.Settings.StatDefinitions;

	// Restore stats
	character.Stats.forEach((stat) => {
		const definition = statDefinitions.find((d: any) => d.Id === stat.Id);
		if (!definition?.RestoreRule) return;

		const restoreAmount = definition.RestoreRule[restType];
		if (restoreAmount === undefined) return;

		if (restoreAmount === "max") {
			stat.Current = stat.Max;
		} else {
			// Increment by amount, capped at Max
			stat.Current = Math.min((stat.Current || 0) + restoreAmount, stat.Max);
		}
	});

	// Restore inventory items
	character.Inventory.forEach((slot) => {
		const itemTemplate = campaign.ItemTemplates.find(
			(it: Item) => it.Id === slot.Id
		);
		if (!itemTemplate?.RestoreRule || !itemTemplate.MaxUses) return;

		const restoreAmount = itemTemplate.RestoreRule[restType];
		if (restoreAmount === undefined) return;

		if (restoreAmount === "max") {
			slot.UsesLeft = itemTemplate.MaxUses;
		} else {
			// Increment by amount, capped at MaxUses
			slot.UsesLeft = Math.min(
				(slot.UsesLeft || 0) + restoreAmount,
				itemTemplate.MaxUses
			);
		}
	});

	// Restore equipment items
	character.Equipment.forEach((slot) => {
		const itemTemplate = campaign.ItemTemplates.find(
			(it: Item) => it.Id === slot.Id
		);
		if (!itemTemplate?.RestoreRule || !itemTemplate.MaxUses) return;

		const restoreAmount = itemTemplate.RestoreRule[restType];
		if (restoreAmount === undefined) return;

		if (restoreAmount === "max") {
			slot.UsesLeft = itemTemplate.MaxUses;
		} else {
			// Increment by amount, capped at MaxUses
			slot.UsesLeft = Math.min(
				(slot.UsesLeft || 0) + restoreAmount,
				itemTemplate.MaxUses
			);
		}
	});

	// Restore skills
	character.Skills.forEach((slot) => {
		const skillTemplate = campaign.SkillTemplates.find(
			(sk: Skill) => sk.Id === slot.Id
		);
		if (!skillTemplate?.RestoreRule || !skillTemplate.MaxUses) return;

		const restoreAmount = skillTemplate.RestoreRule[restType];
		if (restoreAmount === undefined) return;

		if (restoreAmount === "max") {
			slot.UsesLeft = skillTemplate.MaxUses;
		} else {
			// Increment by amount, capped at MaxUses
			slot.UsesLeft = Math.min(
				(slot.UsesLeft || 0) + restoreAmount,
				skillTemplate.MaxUses
			);
		}
	});
}

export function daysPerYear(cfg: CalendarSettings): number {
	return cfg.monthsPerYear * cfg.daysPerMonth;
}

export function absoluteToYMD(
	absoluteDay: number,
	cfg: CalendarSettings
): Calendar {
	const dpy = daysPerYear(cfg);

	const year = Math.floor(absoluteDay / dpy) + 1;
	const dayOfYear = absoluteDay % dpy;

	const monthIndex = Math.floor(dayOfYear / cfg.daysPerMonth); // 0-based
	const dayIndex = dayOfYear % cfg.daysPerMonth; // 0-based

	const result: Calendar = {
		year,
		month: monthIndex + 1,
		day: dayIndex + 1,
	};

	// Optional week math
	if (cfg.daysPerWeek > 0) {
		result.dayOfWeekIndex = absoluteDay % cfg.daysPerWeek;

		result.weekOfMonth = Math.floor(dayIndex / cfg.daysPerWeek) + 1;

		const weeksPerMonth = Math.ceil(cfg.daysPerMonth / cfg.daysPerWeek);
		const monthStartWeekIndex = monthIndex * weeksPerMonth;
		result.weekOfYear = monthStartWeekIndex + result.weekOfMonth;
	}

	return result;
}

export function ymdToAbsolute(
	ymd: { year: number; month: number; day: number },
	cfg: CalendarSettings
): number {
	// Clamp to valid ranges
	const m = Math.min(Math.max(1, ymd.month), cfg.monthsPerYear);
	const d = Math.min(Math.max(1, ymd.day), cfg.daysPerMonth);
	const y = Math.max(1, ymd.year);

	const daysBeforeYear = (y - 1) * daysPerYear(cfg);
	const daysBeforeMonth = (m - 1) * cfg.daysPerMonth;
	const daysBeforeDay = d - 1;

	return daysBeforeYear + daysBeforeMonth + daysBeforeDay;
}

export function ordinal(n: number): string {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/** Convenience: names for the given absolute day. */
export function resolveNames(absoluteDay: number, cfg: CalendarSettings) {
	const parts = absoluteToYMD(absoluteDay, cfg);
	const monthName = cfg.monthNames[parts.month - 1] ?? `Month ${parts.month}`;
	const dayName =
		cfg.daysPerWeek > 0 && parts.dayOfWeekIndex !== undefined
			? cfg.dayNames[parts.dayOfWeekIndex] ?? `Day ${parts.dayOfWeekIndex + 1}`
			: undefined;

	return { parts, monthName, dayName };
}