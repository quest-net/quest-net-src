// domains/Calendar/CalendarActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { Calendar } from "./Calendar";
import { CalendarSettings } from "../CampaignSetting/CampaignSetting";
import { Character } from "../Character/Character";
import { Item } from "../Item/Item";
import { Skill } from "../Skill/Skill";
import { Actor } from "../Actor/Actor";
import { resolveStat } from "../../utils/ActorResolvers";

export const CalendarActions = {
	/**
	 * Resolve the current calendar config.
	 */
	getConfig(context: Context): CalendarSettings {
		const campaign = CampaignActions.getActiveCampaign(context) as any;
		return campaign.Settings.CalendarSettings;
	},

	/**
	 * The single canonical date mutation, matching every other domain's `edit`.
	 * Takes the target absolute day in `updates.CalendarDay` (callers do any
	 * Y/M/D or delta math, e.g. via ymdToAbsolute). The "the day moved forward"
	 * consequence — decrementing day-based statuses — is centralized here in
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
		const campaign = CampaignActions.getActiveCampaign(context);
		setCalendarDay(campaign, next);
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
		const campaign = CampaignActions.getActiveCampaign(context);
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Largest number of day-status decrement steps for a single forward jump. A
 * normal edit moves the date by a handful of days; this cap only matters for an
 * absurd jump (e.g. editing the year far into the future) so we never freeze the
 * app looping billions of times. No realistic day-based status outlasts it.
 */
const MAX_DAY_DECREMENT_STEPS = 100000;

/**
 * Set the calendar to an absolute day and apply the "the day moved forward"
 * consequence in one place (see CalendarActions.edit): if the day increased,
 * decrement day-based statuses once per advanced day (bounded). Moving backward
 * or staying put does nothing.
 */
function setCalendarDay(campaign: any, newDay: number): void {
	const old = campaign.GameState.CalendarDay;
	const next = Math.trunc(newDay);
	campaign.GameState.CalendarDay = next;

	const advanced = next - old;
	if (advanced <= 0) return;

	const steps = Math.min(advanced, MAX_DAY_DECREMENT_STEPS);
	for (let i = 0; i < steps; i++) decrementDayStatuses(campaign);
}

/**
 * Clears statuses with the specified expiration types from all actors in the game state.
 */
function clearStatusesByExpirationType(
	campaign: any,
	types: string[]
): void {
	const allActors: Actor[] = [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
	];

	allActors.forEach((actor) => {
		actor.Statuses = actor.Statuses.filter(
			(status) => !types.includes(status.expiration.type)
		);
	});
}

/**
 * Decrements daysLeft for all day-based statuses by 1 and removes expired ones.
 */
function decrementDayStatuses(campaign: any): void {
	const allActors: Actor[] = [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
	];

	allActors.forEach((actor) => {
		actor.Statuses = actor.Statuses
			.map((status) => {
				if (status.expiration.type !== "days") return status;
				return {
					...status,
					expiration: {
						type: "days" as const,
						daysLeft: status.expiration.daysLeft - 1,
					},
				};
			})
			.filter((status) => {
				if (status.expiration.type === "days") {
					return status.expiration.daysLeft > 0;
				}
				return true;
			});
	});
}

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
	// Per-actor overrides: RestoreRule is read through resolveStat so
	// slot-level overrides win over the template default.
	// Unset stats (Current === null) are skipped — actor doesn't have this stat.
	character.Stats.forEach((stat) => {
		if (stat.Current === null) return;

		const definition = statDefinitions.find((d: any) => d.Id === stat.Id);
		if (!definition) return;

		const resolved = resolveStat(stat, definition);
		if (!resolved.RestoreRule) return;

		const restoreValue = resolved.RestoreRule[restType];
		if (restoreValue === undefined) return;

		if (restoreValue === "max") {
			stat.Current = stat.Max;
		} else if (typeof restoreValue === "object" && "setTo" in restoreValue) {
			// Set to exact value, clamped to [0, Max]
			stat.Current = Math.min(Math.max(0, restoreValue.setTo), stat.Max);
		} else {
			// Increment by amount, capped at Max
			stat.Current = Math.min((stat.Current ?? 0) + restoreValue, stat.Max);
		}
	});

	// Restore inventory items
	character.Inventory.forEach((slot) => {
		const itemTemplate = campaign.ItemTemplates.find(
			(it: Item) => it.Id === slot.Id
		);
		if (!itemTemplate?.RestoreRule || !itemTemplate.MaxUses) return;

		const restoreValue = itemTemplate.RestoreRule[restType];
		if (restoreValue === undefined) return;

		if (restoreValue === "max") {
			slot.UsesLeft = itemTemplate.MaxUses;
		} else if (typeof restoreValue === "object" && "setTo" in restoreValue) {
			slot.UsesLeft = Math.min(Math.max(0, restoreValue.setTo), itemTemplate.MaxUses);
		} else {
			// Increment by amount, capped at MaxUses
			slot.UsesLeft = Math.min(
				(slot.UsesLeft || 0) + restoreValue,
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

		const restoreValue = itemTemplate.RestoreRule[restType];
		if (restoreValue === undefined) return;

		if (restoreValue === "max") {
			slot.UsesLeft = itemTemplate.MaxUses;
		} else if (typeof restoreValue === "object" && "setTo" in restoreValue) {
			slot.UsesLeft = Math.min(Math.max(0, restoreValue.setTo), itemTemplate.MaxUses);
		} else {
			// Increment by amount, capped at MaxUses
			slot.UsesLeft = Math.min(
				(slot.UsesLeft || 0) + restoreValue,
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

		const restoreValue = skillTemplate.RestoreRule[restType];
		if (restoreValue === undefined) return;

		if (restoreValue === "max") {
			slot.UsesLeft = skillTemplate.MaxUses;
		} else if (typeof restoreValue === "object" && "setTo" in restoreValue) {
			slot.UsesLeft = Math.min(Math.max(0, restoreValue.setTo), skillTemplate.MaxUses);
		} else {
			// Increment by amount, capped at MaxUses
			slot.UsesLeft = Math.min(
				(slot.UsesLeft || 0) + restoreValue,
				skillTemplate.MaxUses
			);
		}
	});
}

/**
 * Restores shared inventory stats based on the specified rest type.
 * Exported for use by CombatActions.
 */
export function restoreSharedInventories(
	campaign: any,
	restType: "shortRest" | "longRest" | "combatEnd",
): void {
	const statDefinitions = campaign.Settings.StatDefinitions;
	const sharedInventories = campaign.Settings.SharedInventories || [];

	sharedInventories.forEach((inv: any) => {
		inv.Stats.forEach((stat: any) => {
			// Skip unset pool stats — inventory doesn't track this stat.
			if (stat.Current === null) return;

			const definition = statDefinitions.find((d: any) => d.Id === stat.Id);
			if (!definition) return;

			// Resolve through slot so inventory-level RestoreRule overrides
			// the campaign template default.
			const resolved = resolveStat(stat, definition);
			if (!resolved.RestoreRule) return;

			const restoreValue = resolved.RestoreRule[restType];
			if (restoreValue === undefined) return;

			if (restoreValue === "max") {
				stat.Current = stat.Max;
			} else if (typeof restoreValue === "object" && "setTo" in restoreValue) {
				stat.Current = Math.min(Math.max(0, restoreValue.setTo), stat.Max);
			} else {
				// Increment by amount, capped at Max
				stat.Current = Math.min((stat.Current ?? 0) + restoreValue, stat.Max);
			}
		});
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