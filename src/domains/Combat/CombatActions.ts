// domains/Combat/CombatActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { restoreCharacter, restoreSharedInventories } from "../Calendar/CalendarActions";
import { Actor } from "../Actor/Actor";

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
		};

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

		campaign.GameState.CombatState = {
			isActive: false,
			currentTurn: 0,
			initiativeSide: "party",
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

		// Apply regen to all actors with regen rates
		applyRegenToAllActors(campaign, 1);

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

		// Reverse regen from all actors
		applyRegenToAllActors(campaign, -1);

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
 * Applies regen to all actors (characters and entities) with RegenRate
 * @param multiplier 1 for normal regen, -1 for reversing regen
 */
function applyRegenToAllActors(campaign: any, multiplier: 1 | -1): void {
	const statDefinitions = campaign.Settings.StatDefinitions;
	const sharedInventories = campaign.Settings.SharedInventories || [];
	const allActors: Actor[] = [
		...campaign.GameState.Characters,
		...campaign.GameState.Entities,
	];

	allActors.forEach((actor) => {
		actor.Stats.forEach((stat) => {
			const definition = statDefinitions.find((d: any) => d.Id === stat.Id);
			if (!definition?.RegenRate) return;

			const regenAmount = definition.RegenRate * multiplier;
			const current = stat.Current ?? stat.Max;
			const newValue = current + regenAmount;

			// Handle overflow if applicable (only when regenerating positively)
			if (multiplier === 1 && newValue > stat.Max && definition.OverflowTarget) {
				const overflowAmount = newValue - stat.Max;
				const targetInv = sharedInventories.find(
					(inv: any) => inv.Id === definition.OverflowTarget.InventoryId
				);

				if (targetInv) {
					const targetStat = targetInv.Stats.find(
						(s: any) => s.Id === definition.OverflowTarget.StatId
					);
					if (targetStat) {
						const tCurrent = targetStat.Current ?? targetStat.Max;
						targetStat.Current = Math.min(
							targetStat.Max,
							tCurrent + overflowAmount
						);
					}
				}
			}

			// Clamp between 0 and Max
			stat.Current = Math.max(0, Math.min(newValue, stat.Max));
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