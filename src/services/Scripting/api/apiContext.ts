/**
 * Per-run handle threaded into every facade. Types only — the factory that builds
 * one is `ScriptEngine.makeApiContext`, called once per script run.
 *
 * Every facade (actor/item/status/skill/combat/scene/audio/game) closes over a
 * single `ScriptApiContext` for the duration of one script body, so:
 *   - mutations route through the run's action sink (the same sequencing/draining
 *     `game.action` already gets — see ScriptEngine.createActionSink), and
 *   - read facades share one `facadeCache`, so wrapping the same live actor twice
 *     yields the SAME facade object (`game.find("X") === this.actor`).
 */
import type { Campaign } from "../../../domains/Campaign/Campaign";
import type { Context } from "../../../domains/Context/Context";

export interface ScriptApiContext {
	/**
	 * Dispatch a scriptable action through the run's sink (the same path as
	 * `game.action`): sequenced in call order and drained before the mutation
	 * commits, even when the author forgets to `await`.
	 */
	action(key: string, params?: any): Promise<void>;
	/**
	 * The live active campaign. Re-read on every call (`CampaignUtils.getActiveCampaign`)
	 * — a facade must never cache the campaign object, since a cascade can replace
	 * collections out from under it.
	 */
	campaign(): Campaign;
	/** Underlying Context, for tier-1 utils that take it (e.g. ActorUtils.*). */
	context: Context;
	/**
	 * Per-run identity cache keyed by the LIVE object a facade wraps, so the same
	 * actor always wraps to the same facade within one run. Built fresh per run.
	 */
	facadeCache: WeakMap<object, unknown>;
}
