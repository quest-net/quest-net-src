// domains/Combat/CombatActions.ts

import { Context } from "../Context/Context";
import { CampaignUtils } from "../Campaign/CampaignUtils";
import { LogActions } from "../Log/LogActions";
import { restoreCharacter, restoreSharedInventories } from "../Calendar/CalendarUtils";
import { Actor } from "../Actor/Actor";
import {
	getInitiativeMode,
	clearRoundCompleted,
	applyRegenToAllActors,
	applyRegenToSharedInventories,
	decrementAndRemoveStatuses,
	resetActions,
	snapshotTurnStartForActors,
	snapshotTurnStartForSide,
	clearTurnStartForActors,
} from "./CombatUtils";

export const CombatActions = {
	/**
	 * Starts combat. In party mode, startingSide chooses which side acts first.
	 * In individual mode, startingSide is ignored (everyone shares each round)
	 * but is still recorded on the state.
	 * DM-only
	 */
	start(params: { startingSide: "party" | "enemies" }, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const mode = getInitiativeMode(campaign);

		campaign.GameState.CombatState = {
			isActive: true,
			currentRound: 1,
			initiativeSide: params.startingSide,
			RoundCompleted: [],
		};

		// Snapshot turn-start positions for everyone. Both sides are entering
		// their first round fresh — even the side that doesn't go first benefits
		// from having an anchor (it just won't be consulted until their round).
		snapshotTurnStartForActors(campaign.GameState.Characters);
		snapshotTurnStartForActors(campaign.GameState.Entities);

		const startedBy =
			mode === "individual"
				? "All actors"
				: params.startingSide === "party"
					? "Party"
					: "Enemies";
		LogActions.create(
			{
				action: "Combat started",
				details:
					mode === "individual"
						? "Combat begins! All actors share the round."
						: `Combat begins! ${startedBy} have initiative.`,
				category: "combat",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Ends combat, restores characters, and clears non-permanent statuses
	 * DM-only
	 */
	end(_params: {}, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);

		// Restore all characters based on combatEnd rules
		campaign.GameState.Characters.forEach((character) => {
			restoreCharacter(character, "combatEnd", campaign);
		});

		// Restore shared inventory stats
		restoreSharedInventories(campaign, "combatEnd");

		// Reset actions for all actors
		resetActions(campaign);

		// Clear turn-based statuses from all actors (other types survive combat end)
		const allActors: Actor[] = [
			...campaign.GameState.Characters,
			...campaign.GameState.Entities,
		];

		allActors.forEach((actor) => {
			actor.Statuses = actor.Statuses.filter(
				(status) => status.expiration.type !== "turns"
			);
		});

		// Clear turn-start position snapshots — they're a combat-only concept
		clearTurnStartForActors(allActors);

		campaign.GameState.CombatState = {
			isActive: false,
			currentRound: 0,
			initiativeSide: "party",
			RoundCompleted: [],
		};

		LogActions.create(
			{
				action: "Combat ended",
				details: "Combat has ended. Non-permanent status effects cleared.",
				category: "combat",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Advances to the next round: bumps the counter, flips initiative in party
	 * mode (no flip in individual mode), clears the round-completed list,
	 * applies regen, and decrements status durations.
	 * DM-only
	 */
	incrementRound(_params: {}, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const combatState = campaign.GameState.CombatState;
		const mode = getInitiativeMode(campaign);

		if (!combatState.isActive) {
			console.warn("[Combat] Cannot increment round - combat is not active");
			return;
		}

		// Increment round
		combatState.currentRound++;

		// Switch initiative — only in party mode. Individual mode has no sides
		// to flip; everyone shares the round.
		if (mode === "party") {
			combatState.initiativeSide =
				combatState.initiativeSide === "party" ? "enemies" : "party";
		}

		// Clear the round-completed list so the next round starts with everyone
		// unmarked. Initiative order itself is recomputed live at render time,
		// so there's nothing else to refresh.
		clearRoundCompleted(combatState);

		// Snapshot turn-start positions for the actors whose round is now
		// beginning, so remaining-movement UI re-anchors at this position.
		// Note: decrementRound deliberately does NOT do this — rewinding loses
		// historical turn-start data, matching the existing "we don't perfectly
		// reverse complex state" stance for that direction.
		if (mode === "party") {
			snapshotTurnStartForSide(campaign, combatState.initiativeSide);
		} else {
			snapshotTurnStartForActors(campaign.GameState.Characters);
			snapshotTurnStartForActors(campaign.GameState.Entities);
		}

		// Apply regen to all actors with regen rates
		applyRegenToAllActors(campaign, 1);

		// Apply regen to shared inventory pools
		applyRegenToSharedInventories(campaign, 1);

		// Reset actions for all actors
		resetActions(campaign);

		// Decrement status durations and remove expired statuses
		decrementAndRemoveStatuses(campaign);

		const sideLabel =
			mode === "individual"
				? "All actors"
				: combatState.initiativeSide === "party"
					? "Party"
					: "Enemies";
		LogActions.create(
			{
				action: "Round incremented",
				details:
					mode === "individual"
						? `Round ${combatState.currentRound}. All actors share initiative.`
						: `Round ${combatState.currentRound}. ${sideLabel} have initiative.`,
				category: "combat",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Rewinds to the previous round: decrements the counter, flips initiative
	 * back in party mode (no flip in individual mode), clears the
	 * round-completed list, and reverses regen.
	 * DM-only
	 */
	decrementRound(_params: {}, context: Context): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const combatState = campaign.GameState.CombatState;
		const mode = getInitiativeMode(campaign);

		if (!combatState.isActive) {
			console.warn("[Combat] Cannot decrement round - combat is not active");
			return;
		}

		if (combatState.currentRound <= 1) {
			console.warn("[Combat] Cannot decrement below round 1");
			return;
		}

		// Decrement round
		combatState.currentRound--;

		// Switch initiative back — only in party mode.
		if (mode === "party") {
			combatState.initiativeSide =
				combatState.initiativeSide === "party" ? "enemies" : "party";
		}

		// Clear the round we're rewinding into — same reasoning as incrementRound.
		clearRoundCompleted(combatState);

		// Reverse regen from all actors
		applyRegenToAllActors(campaign, -1);

		// Reverse regen from shared inventory pools
		applyRegenToSharedInventories(campaign, -1);

		// Reset actions for all actors
		resetActions(campaign);

		// Note: We don't reverse status decrements as that would be complex
		// and could lead to inconsistent state. DM can manually adjust durations if needed.

		const sideLabel =
			mode === "individual"
				? "All actors"
				: combatState.initiativeSide === "party"
					? "Party"
					: "Enemies";
		LogActions.create(
			{
				action: "Round decremented",
				details:
					mode === "individual"
						? `Round ${combatState.currentRound}. All actors share initiative.`
						: `Round ${combatState.currentRound}. ${sideLabel} have initiative.`,
				category: "combat",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Toggles whether an actor's turn is marked "done" within the current
	 * round. Purely visual — used by the party-tab badge click handler and the
	 * battle banner. Both party and enemy actor IDs feed into the unified
	 * RoundCompleted list.
	 *
	 * Allowed for DM and players alike (the UI restricts which actors a player
	 * can click; this handler trusts the call).
	 */
	markActorTurnDone(
		params: { actorId: string },
		context: Context
	): void {
		const campaign = CampaignUtils.getActiveCampaign(context);
		const combatState = campaign.GameState.CombatState;

		if (!combatState.isActive) {
			console.warn("[Combat] Cannot mark turn done - combat is not active");
			return;
		}

		const existing = combatState.RoundCompleted ?? [];
		const isDone = existing.includes(params.actorId);

		combatState.RoundCompleted = isDone
			? existing.filter((id) => id !== params.actorId)
			: [...existing, params.actorId];
	},

};
