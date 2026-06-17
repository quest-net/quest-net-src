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
export function applyRegenToAllActors(campaign: any, multiplier: 1 | -1): void {
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
			// Clamp between 0 and Max — shared pools never overflow anywhere.
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
