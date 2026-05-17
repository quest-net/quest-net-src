// domains/Combat/CombatActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import type { Campaign } from "../Campaign/Campaign";
import { LogActions } from "../Log/LogActions";
import { restoreCharacter, restoreSharedInventories } from "../Calendar/CalendarActions";
import { Actor } from "../Actor/Actor";
import type { InitiativeMode } from "../CampaignSetting/CampaignSetting";
import { resolveStat } from "../../utils/ActorResolvers";

function getInitiativeMode(campaign: Campaign): InitiativeMode {
	const initiativeSettings = campaign.Settings.InitiativeSettings;
	return initiativeSettings ? initiativeSettings.Mode : "party";
}

export const CombatActions = {
	/**
	 * Starts combat. In party mode, startingSide chooses which side acts first.
	 * In individual mode, startingSide is ignored (everyone shares each round)
	 * but is still recorded on the state.
	 * DM-only
	 */
	start(params: { startingSide: "party" | "enemies" }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
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
		const campaign = CampaignActions.getActiveCampaign(context);

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
		const campaign = CampaignActions.getActiveCampaign(context);
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
		const campaign = CampaignActions.getActiveCampaign(context);
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
		const campaign = CampaignActions.getActiveCampaign(context);
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

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Clears the unified RoundCompleted list. Used when a round advances so the
 * next round starts with everyone unmarked.
 */
function clearRoundCompleted(
	combatState: { RoundCompleted?: string[] }
): void {
	combatState.RoundCompleted = [];
}

/**
 * Applies regen to all actors (characters and entities) with RegenRate.
 *
 * Per-actor overrides: RegenRate and OverflowTarget are read through
 * resolveStat so slot-level overrides (including a null OverflowTarget
 * meaning "explicitly disable overflow for this actor") take effect.
 *
 * Overflow scope: only Characters (party members) contribute their
 * surplus to shared inventory pools. Entities (NPCs/enemies) regen
 * normally but any excess beyond Max is simply discarded — they do
 * not feed the party's shared inventory.
 *
 * @param multiplier 1 for normal regen, -1 for reversing regen
 */
function applyRegenToAllActors(campaign: any, multiplier: 1 | -1): void {
	const statDefinitions = campaign.Settings.StatDefinitions;
	const sharedInventories = campaign.Settings.SharedInventories || [];

	const runForActors = (actors: Actor[], overflowAllowed: boolean) => {
		actors.forEach((actor) => {
			actor.Stats.forEach((stat) => {
				// Skip unset stats — actor doesn't have this stat, so no regen.
				if (stat.Current === null) return;

				const definition = statDefinitions.find((d: any) => d.Id === stat.Id);
				if (!definition) return;

				// Resolve through slot so per-actor RegenRate / OverflowTarget
				// overrides win (slot.null for OverflowTarget = explicitly disabled).
				const resolved = resolveStat(stat, definition);
				if (!resolved.RegenRate) return;

				const regenAmount = resolved.RegenRate * multiplier;
				const newValue = stat.Current + regenAmount;

				// Handle overflow only for party members, only on positive regen,
				// and only when the resolved target is defined.
				if (
					overflowAllowed
					&& multiplier === 1
					&& newValue > stat.Max
					&& resolved.OverflowTarget
				) {
					const overflowAmount = newValue - stat.Max;
					const targetInv = sharedInventories.find(
						(inv: any) => inv.Id === resolved.OverflowTarget!.InventoryId
					);

					if (targetInv) {
						const targetStat = targetInv.Stats.find(
							(s: any) => s.Id === resolved.OverflowTarget!.StatId
						);
						// Skip overflow target if it's unset — don't silently
						// materialize points into a stat the inventory doesn't track.
						if (targetStat && targetStat.Current !== null) {
							targetStat.Current = Math.min(
								targetStat.Max,
								targetStat.Current + overflowAmount
							);
						}
					}
				}

				// Clamp between 0 and Max
				stat.Current = Math.max(0, Math.min(newValue, stat.Max));
			});
		});
	};

	// Party members may contribute overflow to shared inventories.
	runForActors(campaign.GameState.Characters, true);
	// Entities regen normally but surplus is discarded (not overflowed).
	runForActors(campaign.GameState.Entities, false);
}

/**
 * Applies regen to stats in all shared inventory pools.
 *
 * Shared inventory stats reference campaign StatDefinitions by Id, so we
 * resolve each slot through its template — slot-level RegenRate wins, else
 * the template default is used. Unset stats (Current === null) are skipped.
 *
 * Shared inventory stats do NOT participate in overflow — they are the
 * terminal destination. If a pool regens past Max, the surplus is discarded.
 *
 * @param multiplier 1 for normal regen, -1 for reversing regen
 */
function applyRegenToSharedInventories(campaign: any, multiplier: 1 | -1): void {
	const statDefinitions = campaign.Settings.StatDefinitions;
	const sharedInventories = campaign.Settings.SharedInventories || [];

	sharedInventories.forEach((inv: any) => {
		inv.Stats.forEach((stat: any) => {
			// Skip unset pool stats.
			if (stat.Current === null) return;

			const definition = statDefinitions.find((d: any) => d.Id === stat.Id);
			if (!definition) return;

			const resolved = resolveStat(stat, definition);
			if (!resolved.RegenRate) return;

			const regenAmount = resolved.RegenRate * multiplier;
			// Clamp between 0 and Max — shared pools never overflow anywhere.
			stat.Current = Math.max(0, Math.min(stat.Current + regenAmount, stat.Max));
		});
	});
}

/**
 * Decrements turn-based status durations by 1 and removes statuses that reach 0.
 * Only affects statuses with expiration type "turns".
 */
function decrementAndRemoveStatuses(campaign: any): void {
	const allActors: Actor[] = [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
	];

	allActors.forEach((actor) => {
		actor.Statuses = actor.Statuses
			.map((status) => {
				// Only decrement turn-based statuses
				if (status.expiration.type !== "turns") return status;

				return {
					...status,
					expiration: {
						type: "turns" as const,
						turnsLeft: status.expiration.turnsLeft - 1,
					},
				};
			})
			.filter((status) => {
				// Remove turn-based statuses that have expired
				if (status.expiration.type === "turns") {
					return status.expiration.turnsLeft > 0;
				}
				// Keep all other types
				return true;
			});
	});
}

/**
 * Resets action counts to Default for all actors
 */
function resetActions(campaign: any): void {
	const allActors: Actor[] = [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
	];

	allActors.forEach((actor) => {
		if (actor.Actions) {
			actor.Actions.forEach((action) => {
				action.Current = action.Max;
			});
		}
	});
}

/**
 * Snapshots the current Position of each actor into TurnStartPosition.
 * Used to anchor the "remaining movement" calculation: spent = cheapest
 * path cost from TurnStartPosition to current Position.
 */
function snapshotTurnStartForActors(actors: Actor[]): void {
	actors.forEach((actor) => {
		actor.TurnStartPosition = { ...actor.Position };
	});
}

/**
 * Snapshots turn-start positions for one side only. Party = Characters,
 * Enemies = Entities. Called when initiative flips to that side so the
 * acting players see their fresh budget zone.
 */
function snapshotTurnStartForSide(
	campaign: any,
	side: "party" | "enemies"
): void {
	const actors: Actor[] =
		side === "party"
			? campaign.GameState.Characters
			: campaign.GameState.Entities;
	snapshotTurnStartForActors(actors);
}

/**
 * Clears TurnStartPosition on every actor — used when combat ends so the
 * field doesn't linger as stale data outside of combat.
 */
function clearTurnStartForActors(actors: Actor[]): void {
	actors.forEach((actor) => {
		delete actor.TurnStartPosition;
	});
}
