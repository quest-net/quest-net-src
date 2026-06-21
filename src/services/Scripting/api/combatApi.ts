/**
 * Combat singleton facade.
 *
 * Shape: SINGLETON. There is exactly one combat state per campaign
 * (`GameState.CombatState`), so this is namespaced under `game.combat` rather than
 * held per-object. `makeCombatApi` closes over the run context; reads pull live
 * from `CombatState`, mutations dispatch `combat:*` actions.
 *
 * Backed by `CombatUtils.actorsThisRound(campaign)` (the FULL round roster in
 * initiative order — it does not subtract already-acted actors; see its doc) and
 * the already-scriptable combat:start / combat:end / combat:incrementRound actions.
 */
import type { ScriptApiContext } from "./apiContext";
import { wrapActor, type ActorFacade, type ActorRef } from "./actorApi";
import { actorsThisRound } from "../../../domains/Combat/CombatUtils";
import { ActorUtils } from "../../../domains/Actor/ActorUtils";

export interface CombatApi {
	/** Whether a battle is active. -> CombatState.isActive */
	readonly isActive: boolean;
	/** 1-based round counter. -> CombatState.currentRound */
	readonly round: number;
	/** Side with initiative (party mode), else undefined. -> CombatState.initiativeSide */
	readonly side: "party" | "enemies" | undefined;

	/** Begin combat. -> combat:start */
	start(): Promise<void>;
	/** End combat. -> combat:end */
	end(): Promise<void>;
	/** Advance to the next round (or flip initiative side). -> combat:incrementRound */
	nextRound(): Promise<void>;
	/** Rewind to the previous round (no-op below round 1). -> combat:decrementRound */
	prevRound(): Promise<void>;
	/** Toggle whether an actor (ref) has finished its turn this round. -> combat:markActorTurnDone */
	markTurnDone(actor: ActorRef): Promise<void>;

	/** Actors acting this round, wrapped as facades. -> NEW util CombatUtils.actorsThisRound */
	actorsThisRound(): ActorFacade[];
}

/** Build the combat singleton for one script run. */
export function makeCombatApi(api: ScriptApiContext): CombatApi {
	return {
		// ---- Reads: pull live every access; never cache CombatState ----------
		get isActive() {
			return api.campaign().GameState.CombatState.isActive;
		},
		get round() {
			return api.campaign().GameState.CombatState.currentRound;
		},
		get side() {
			const combat = api.campaign().GameState.CombatState;
			// initiativeSide is only meaningful while combat is active (party mode).
			return combat.isActive ? combat.initiativeSide : undefined;
		},

		// ---- Mutations: dispatch the scriptable combat:* actions -------------
		// combat:start reads params.startingSide directly. The facade takes no
		// args, so default to "party" — matching the UI's individual-mode start
		// (which also passes "party"); in party mode the author flips sides via
		// nextRound() if they want enemies first.
		start: () => api.action("combat:start", { startingSide: "party" }),
		end: () => api.action("combat:end", {}),
		nextRound: () => api.action("combat:incrementRound", {}),
		prevRound: () => api.action("combat:decrementRound", {}),
		markTurnDone: async (actor) => {
			// Resolve the ref to an active actor Id; no-op if it doesn't resolve
			// rather than dispatching a doomed toggle.
			const actorId = ActorUtils.resolveActorId(api.campaign(), actor);
			if (!actorId) return;
			await api.action("combat:markActorTurnDone", { actorId });
		},

		// ---- Derived read: wrap each acting actor into a shared facade -------
		actorsThisRound: () =>
			actorsThisRound(api.campaign()).map((actor) => wrapActor(actor, api)),
	};
}
