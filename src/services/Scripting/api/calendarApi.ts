/**
 * Calendar singleton facade.
 *
 * Shape: SINGLETON (one in-world date + rest state per campaign). Namespaced
 * under `game.calendar`, alongside `game.combat` / `game.scene` / `game.audio`.
 * `makeCalendarApi` closes over the run context; reads pull live from
 * `GameState.CalendarDay` (+ `Settings.CalendarSettings` for the Y/M/D view),
 * mutations dispatch the already-scriptable `calendar:*` actions.
 *
 * The date is stored as a single ABSOLUTE day counter (`GameState.CalendarDay`);
 * Y/M/D is a derived view (`CalendarUtils.absoluteToYMD`). `calendar:edit` is the
 * one canonical date mutation and takes the target absolute day in
 * `updates.CalendarDay` — `advanceDays`/`setDate` do the day math here and dispatch
 * that. Resting goes through `calendar:shortRest` / `calendar:longRest`, which own
 * the restore/cleanup consequences (see CalendarActions).
 */
import type { ScriptApiContext } from "./apiContext";
import type { Calendar } from "../../../domains/Calendar/Calendar";
import { absoluteToYMD, ymdToAbsolute } from "../../../domains/Calendar/CalendarUtils";

export interface CalendarApi {
	/** The current absolute day counter. -> GameState.CalendarDay */
	readonly day: number;
	/** The current date as a derived Y/M/D view. -> CalendarUtils.absoluteToYMD */
	readonly date: Calendar;

	/** Jump to an absolute day. -> calendar:edit */
	setDay(absoluteDay: number): Promise<void>;
	/** Move the date by `days` (negative rewinds). -> calendar:edit */
	advanceDays(days: number): Promise<void>;
	/** Jump to a Y/M/D date (1-based, clamped to the calendar config). -> calendar:edit */
	setDate(date: { year: number; month: number; day: number }): Promise<void>;

	/** Take a party short rest (restores per RestoreRule, decrements rests). -> calendar:shortRest */
	shortRest(): Promise<void>;
	/** Take a party long rest (restores, clears rest-bound statuses, may advance a day). -> calendar:longRest */
	longRest(): Promise<void>;
}

/** Build the calendar singleton for one script run. */
export function makeCalendarApi(api: ScriptApiContext): CalendarApi {
	return {
		// ---- Reads: pull live every access; never cache GameState/Settings ----
		get day() {
			return api.campaign().GameState.CalendarDay;
		},
		get date() {
			const campaign = api.campaign();
			return absoluteToYMD(
				campaign.GameState.CalendarDay,
				campaign.Settings.CalendarSettings
			);
		},

		// ---- Mutations: the one canonical date action + the rest verbs --------
		setDay: (absoluteDay) =>
			// setCalendarDay truncates; pass through and let the handler validate.
			api.action("calendar:edit", { updates: { CalendarDay: absoluteDay } }),
		advanceDays: (days) =>
			// Read the live day at call time (a prior cascade action may have moved it).
			api.action("calendar:edit", {
				updates: { CalendarDay: api.campaign().GameState.CalendarDay + days },
			}),
		setDate: (date) =>
			api.action("calendar:edit", {
				updates: {
					CalendarDay: ymdToAbsolute(date, api.campaign().Settings.CalendarSettings),
				},
			}),

		shortRest: () => api.action("calendar:shortRest", {}),
		longRest: () => api.action("calendar:longRest", {}),
	};
}
