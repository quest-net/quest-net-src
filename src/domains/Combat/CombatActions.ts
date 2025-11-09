// domains/Combat/CombatActions.ts

import { Context } from "../Context/Context";
import { CampaignActions } from "../Campaign/CampaignActions";
import { LogActions } from "../Log/LogActions";
import { restoreCharacter } from "../Calendar/CalendarActions";
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
	 * Ends combat and restores characters based on combatEnd restore rules
	 * DM-only
	 */
	end(_params: {}, context: Context): void {
		const campaign = CampaignActions.getActiveCampaign(context);

		// Restore all characters based on combatEnd rules
		campaign.GameState.Characters.forEach((character) => {
			restoreCharacter(character, "combatEnd", campaign);
		});

		campaign.GameState.CombatState = {
			isActive: false,
			currentTurn: 0,
			initiativeSide: "party",
		};

		LogActions.create(
			{
				action: "Combat ended",
				details: "Combat has ended.",
				category: "combat",
				level: "important",
				visibility: ["all"],
			},
			context
		);
	},

	/**
	 * Increments the turn counter, switches initiative, and applies regen
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
	 * Decrements the turn counter, switches initiative back, and reverses regen
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

			// Clamp between 0 and Max
			stat.Current = Math.max(0, Math.min(newValue, stat.Max));
		});
	});
}