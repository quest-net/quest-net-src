// domains/Combat/CombatActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { restoreCharacter, restoreSharedInventories } from "../Calendar/CalendarActions";
import { Actor } from "../Actor/Actor";
import { resolveStat } from "../../utils/ActorResolvers";

export const CombatActions = {
	/**
	 * Starts combat with the specified starting side
	 * DM-only
	 */
	start(params: { startingSide: "party" | "enemies" }, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		campaign.GameState.CombatState = {
			isActive: true,
			currentTurn: 1,
			initiativeSide: params.startingSide,
			PartyTurnsCompleted: [],
			EnemyTurnsCompleted: [],
		};

		// Snapshot turn-start positions for everyone. Both sides are entering
		// their first turn fresh — even the side that doesn't go first benefits
		// from having an anchor (it just won't be consulted until their turn).
		snapshotTurnStartForActors(campaign.GameState.Characters);
		snapshotTurnStartForActors(campaign.GameState.Entities);

		LogActions.create(
			{
				action: "Combat started",
				details: `Combat begins! ${params.startingSide === "party" ? "Party" : "Enemies"} have initiative.`,
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
			currentTurn: 0,
			initiativeSide: "party",
			PartyTurnsCompleted: [],
			EnemyTurnsCompleted: [],
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
	 * Increments the turn counter, switches initiative, applies regen, and decrements status durations
	 * DM-only
	 */
	incrementTurn(_params: {}, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const combatState = campaign.GameState.CombatState;

		if (!combatState.isActive) {
			console.warn("[Combat] Cannot increment turn - combat is not active");
			return;
		}

		// Increment turn
		combatState.currentTurn++;

		// Switch initiative
		combatState.initiativeSide =
			combatState.initiativeSide === "party" ? "enemies" : "party";

		// Clear the *destination* side's "turn done" list so the next turn
		// starts with everyone unmarked. Initiative order itself is recomputed
		// live at render time, so there's nothing else to refresh.
		clearTurnsCompletedForSide(combatState, combatState.initiativeSide);

		// Snapshot turn-start positions for the side whose turn is now
		// beginning, so remaining-movement UI re-anchors at this position.
		// Note: decrementTurn deliberately does NOT do this — rewinding loses
		// historical turn-start data, matching the existing "we don't perfectly
		// reverse complex state" stance for that direction.
		snapshotTurnStartForSide(campaign, combatState.initiativeSide);

		// Apply regen to all actors with regen rates
		applyRegenToAllActors(campaign, 1);

		// Apply regen to shared inventory pools
		applyRegenToSharedInventories(campaign, 1);

		// Reset actions for all actors
		resetActions(campaign);

		// Decrement status durations and remove expired statuses
		decrementAndRemoveStatuses(campaign);

		LogActions.create(
			{
				action: "Turn incremented",
				details: `Turn ${combatState.currentTurn}. ${combatState.initiativeSide === "party" ? "Party" : "Enemies"} have initiative.`,
				category: "combat",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Decrements the turn counter, switches initiative back, reverses regen, and reverses status decrements
	 * DM-only
	 */
	decrementTurn(_params: {}, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const combatState = campaign.GameState.CombatState;

		if (!combatState.isActive) {
			console.warn("[Combat] Cannot decrement turn - combat is not active");
			return;
		}

		if (combatState.currentTurn <= 1) {
			console.warn("[Combat] Cannot decrement below turn 1");
			return;
		}

		// Decrement turn
		combatState.currentTurn--;

		// Switch initiative back
		combatState.initiativeSide =
			combatState.initiativeSide === "party" ? "enemies" : "party";

		// Clear the side we're rewinding into — same reasoning as incrementTurn.
		clearTurnsCompletedForSide(combatState, combatState.initiativeSide);

		// Reverse regen from all actors
		applyRegenToAllActors(campaign, -1);

		// Reverse regen from shared inventory pools
		applyRegenToSharedInventories(campaign, -1);

		// Reset actions for all actors
		resetActions(campaign);

		// Note: We don't reverse status decrements as that would be complex
		// and could lead to inconsistent state. DM can manually adjust durations if needed.

		LogActions.create(
			{
				action: "Turn decremented",
				details: `Turn ${combatState.currentTurn}. ${combatState.initiativeSide === "party" ? "Party" : "Enemies"} have initiative.`,
				category: "combat",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Toggles whether an actor's turn is marked "done" for the current side's
	 * turn. Purely visual — used by the party-tab badge click handler and the
	 * battle banner. Allowed for DM and players alike (the UI restricts which
	 * actors a player can click; this handler trusts the call).
	 */
	markActorTurnDone(
		params: { actorId: string; side: "party" | "enemies" },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const combatState = campaign.GameState.CombatState;

		if (!combatState.isActive) {
			console.warn("[Combat] Cannot mark turn done - combat is not active");
			return;
		}

		const key =
			params.side === "party" ? "PartyTurnsCompleted" : "EnemyTurnsCompleted";
		const existing = combatState[key] ?? [];
		const isDone = existing.includes(params.actorId);

		combatState[key] = isDone
			? existing.filter((id) => id !== params.actorId)
			: [...existing, params.actorId];
	},

	/**
	 * Sets which side currently has initiative
	 * DM-only
	 */
	setInitiativeSide(
		params: { side: "party" | "enemies" },
		context: Context
	): void {
		const campaign = CampaignActions.getActiveCampaign(context);
		const combatState = campaign.GameState.CombatState;

		if (!combatState.isActive) {
			console.warn("[Combat] Cannot set initiative - combat is not active");
			return;
		}

		combatState.initiativeSide = params.side;

		LogActions.create(
			{
				action: "Initiative changed",
				details: `${params.side === "party" ? "Party" : "Enemies"} now have initiative.`,
				category: "combat",
				level: "info",
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
 * Clears the "turn done" list for one side. Used when initiative flips so the
 * incoming side starts fresh. The opposite side's list is left intact so a
 * decrementTurn rewind doesn't lose data within a round.
 */
function clearTurnsCompletedForSide(
	combatState: { PartyTurnsCompleted?: string[]; EnemyTurnsCompleted?: string[] },
	side: "party" | "enemies"
): void {
	if (side === "party") combatState.PartyTurnsCompleted = [];
	else combatState.EnemyTurnsCompleted = [];
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