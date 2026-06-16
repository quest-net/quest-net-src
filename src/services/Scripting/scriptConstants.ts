/**
 * Tunable safety budgets for the scripting engine. Named constants (like
 * threeDMapConstants) so the caps that protect the DM's machine from a runaway
 * cascade are easy to find and adjust.
 *
 * NOTE: without a sandbox there is no per-script wall-clock interrupt, so these
 * bound the *breadth and depth* of a reaction cascade, not a single infinite
 * loop inside one script. A `while(true)` still hangs the tab — the controls
 * against that are author review and the test harness, not these numbers.
 */
export const SCRIPT_BUDGETS = {
	/** Max nesting of action → reacting script → action → … within one mutation. */
	MAX_CASCADE_DEPTH: 16,
	/** Max total game.action() calls across an entire top-level mutation. */
	MAX_TOTAL_ACTIONS: 256,
} as const;

/** AppSettings key for the global kill switch (string "true" disables all scripts). */
export const SCRIPTING_DISABLED_SETTING = "scripting.disabled";
