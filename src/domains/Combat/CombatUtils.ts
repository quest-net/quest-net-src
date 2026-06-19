// domains/Combat/CombatUtils.ts

import type { Campaign } from "../Campaign/Campaign";
import { Actor } from "../Actor/Actor";
import type { InitiativeMode } from "../CampaignSetting/CampaignSetting";
import { resolveStat } from "../Actor/ActorResolvers";

export function getInitiativeMode(campaign: Campaign): InitiativeMode {
	const initiativeSettings = campaign.Settings.InitiativeSettings;
	return initiativeSettings ? initiativeSettings.Mode : "party";
}

/**
 * Clears the unified RoundCompleted list. Used when a round advances so the
 * next round starts with everyone unmarked.
 */
export function clearRoundCompleted(
	combatState: { RoundCompleted?: string[] }
): void {
	combatState.RoundCompleted = [];
}

/**
 * Applies regen to all actors (characters and entities) with RegenRate.
 *
 * Per-actor overrides: RegenRate is read through resolveStat so slot-level
 * overrides take effect. Regen is clamped between 0 and Max; any surplus
 * beyond Max is simply discarded.
 *
 * @param multiplier 1 for normal regen, -1 for reversing regen
 */
export function applyRegenToAllActors(campaign: any, multiplier: 1 | -1): void {
	const statDefinitions = campaign.Settings.StatDefinitions;

	const runForActors = (actors: Actor[]) => {
		actors.forEach((actor) => {
			actor.Stats.forEach((stat) => {
				// Skip unset stats — actor doesn't have this stat, so no regen.
				if (stat.Current === null) return;

				const definition = statDefinitions.find((d: any) => d.Id === stat.Id);
				if (!definition) return;

				// Resolve through slot so per-actor RegenRate overrides win.
				const resolved = resolveStat(stat, definition);
				if (!resolved.RegenRate) return;

				const regenAmount = resolved.RegenRate * multiplier;
				const newValue = stat.Current + regenAmount;

				// Clamp between 0 and Max
				stat.Current = Math.max(0, Math.min(newValue, stat.Max));
			});
		});
	};

	runForActors(campaign.GameState.Characters);
	runForActors(campaign.GameState.Entities);
}

/**
 * Applies regen to stats in all shared inventory pools.
 *
 * Shared inventory stats reference campaign StatDefinitions by Id, so we
 * resolve each slot through its template — slot-level RegenRate wins, else
 * the template default is used. Unset stats (Current === null) are skipped.
 *
 * If a pool regens past Max, the surplus is discarded.
 *
 * @param multiplier 1 for normal regen, -1 for reversing regen
 */
export function applyRegenToSharedInventories(campaign: any, multiplier: 1 | -1): void {
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
			// Clamp between 0 and Max — surplus is discarded.
			stat.Current = Math.max(0, Math.min(stat.Current + regenAmount, stat.Max));
		});
	});
}

/**
 * Decrements turn-based status durations by 1 and removes statuses that reach 0.
 * Only affects statuses with expiration type "turns".
 */
export function decrementAndRemoveStatuses(campaign: any): void {
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
export function resetActions(campaign: any): void {
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
export function snapshotTurnStartForActors(actors: Actor[]): void {
	actors.forEach((actor) => {
		actor.TurnStartPosition = { ...actor.Position };
	});
}

/**
 * Snapshots turn-start positions for one side only. Party = Characters,
 * Enemies = Entities. Called when initiative flips to that side so the
 * acting players see their fresh budget zone.
 */
export function snapshotTurnStartForSide(
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
export function clearTurnStartForActors(actors: Actor[]): void {
	actors.forEach((actor) => {
		delete actor.TurnStartPosition;
	});
}
