// utils/InitiativeUtils.ts
// Pure functions that compute initiative order for a list of actors against a
// CampaignSettings.InitiativeSettings configuration. No state stored — order
// is recomputed at render time. The "done" flag for each actor lives on
// CombatState.PartyTurnsCompleted / EnemyTurnsCompleted.

import { Actor } from "../domains/Actor/Actor";
import {
	CampaignSettings,
	InitiativeSettings,
	InitiativeSource,
} from "../domains/CampaignSetting/CampaignSetting";
import { resolveStat } from "./ActorResolvers";

export interface InitiativeEntry {
	ActorId: string;
	/**
	 * 1-based ordering. Tied actors share a number (1, 2, 2, 4, ...).
	 * Actors with no value for any source land at a single shared "tail"
	 * order at the bottom of the list.
	 */
	Order: number;
}

/**
 * Reads the source value for a single actor.
 * Returns null when the actor has no usable value (unset stat, missing attribute,
 * or non-numeric attribute string). Null-valued actors are sorted to the bottom.
 */
export function getInitiativeSourceValue(
	actor: Actor,
	source: InitiativeSource,
	campaignSettings: CampaignSettings
): number | null {
	switch (source.kind) {
		case "moveSpeed":
			return typeof actor.MoveSpeed === "number" ? actor.MoveSpeed : null;

		case "stat": {
			const slot = actor.Stats.find((s) => s.Id === source.statId);
			if (!slot) return null;
			const def = campaignSettings.StatDefinitions.find(
				(d) => d.Id === source.statId
			);
			if (!def) return null;
			const resolved = resolveStat(slot, def);
			return resolved.Current; // null if unset — actor goes to bottom
		}

		case "attribute": {
			const slot = actor.Attributes.find((s) => s.Id === source.attributeId);
			if (!slot) return null;
			// AttributeSlot.Value is a string. Parse it; non-numeric → null.
			const trimmed = slot.Value?.trim();
			if (!trimmed) return null;
			const parsed = Number(trimmed);
			return Number.isFinite(parsed) ? parsed : null;
		}
	}
}

/**
 * Computes the initiative order for a list of actors.
 *
 * Sort order is greatest-first along the chain of sources. Each successive
 * source acts as a tiebreaker when prior sources tie. Actors that lack a
 * value for *any* configured source (i.e., every entry in the chain returns
 * null) are placed at the bottom and share one tail order.
 *
 * Returns an empty array when settings is undefined/empty so callers can
 * detect "initiative not configured" by checking length.
 */
export function computeInitiativeOrder(
	actors: Actor[],
	settings: InitiativeSettings | undefined,
	campaignSettings: CampaignSettings
): InitiativeEntry[] {
	if (!settings || settings.Sources.length === 0) return [];
	if (actors.length === 0) return [];

	// Build a sort key per actor: an array of (number | null) values matching
	// the source chain. We can compare these element-wise.
	const keyed = actors.map((actor) => ({
		actor,
		key: settings.Sources.map((src) =>
			getInitiativeSourceValue(actor, src, campaignSettings)
		),
		// "Has any value" = at least one non-null key entry. Actors with all
		// nulls sink to the bottom regardless of comparator result.
		hasAnyValue: settings.Sources.some(
			(src) => getInitiativeSourceValue(actor, src, campaignSettings) !== null
		),
	}));

	// Comparator: compares two key arrays element-wise.
	// Greatest-first: bigger value → earlier in the order (negative result).
	// Null is treated as "less than any number" for that index.
	const compareKey = (a: (number | null)[], b: (number | null)[]): number => {
		for (let i = 0; i < a.length; i++) {
			const av = a[i];
			const bv = b[i];
			if (av === bv) continue;
			if (av === null) return 1;   // a is "smaller" → b comes first
			if (bv === null) return -1;  // b is "smaller" → a comes first
			return bv - av;              // greatest-first
		}
		return 0;
	};

	const sorted = [...keyed].sort((a, b) => {
		// All-null actors always sink, regardless of partial nulls in the others.
		if (!a.hasAnyValue && b.hasAnyValue) return 1;
		if (a.hasAnyValue && !b.hasAnyValue) return -1;
		return compareKey(a.key, b.key);
	});

	// Assign 1-based ranks with shared numbers on ties (1, 2, 2, 4, ...).
	// Additionally, all "no value at all" actors share one tail rank.
	const result: InitiativeEntry[] = [];
	let lastKey: (number | null)[] | null = null;
	let lastHadValue: boolean | null = null;
	let lastOrder = 0;

	sorted.forEach((entry, index) => {
		const isTieWithPrevious =
			lastKey !== null &&
			lastHadValue === entry.hasAnyValue &&
			(!entry.hasAnyValue || compareKey(lastKey, entry.key) === 0);

		const order = isTieWithPrevious ? lastOrder : index + 1;

		result.push({ ActorId: entry.actor.Id, Order: order });

		lastKey = entry.key;
		lastHadValue = entry.hasAnyValue;
		lastOrder = order;
	});

	return result;
}

/**
 * Convenience: returns the lowest Order among entries whose ActorId is NOT in
 * the `done` list, or null if every entry is done. Used by the battle banner
 * to find the currently-acting actor(s).
 */
export function getActiveOrder(
	entries: InitiativeEntry[],
	done: string[] | undefined
): number | null {
	const doneSet = new Set(done ?? []);
	let lowest: number | null = null;
	for (const e of entries) {
		if (doneSet.has(e.ActorId)) continue;
		if (lowest === null || e.Order < lowest) lowest = e.Order;
	}
	return lowest;
}
