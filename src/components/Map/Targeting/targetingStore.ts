// components/Map/Targeting/targetingStore.ts
//
// Transient, never-persisted Valtio store that bridges the item/skill drawer
// (which lives in the character-sheet panel) and the map (a separate React
// tree). When the user presses "Use" on a targetable item/skill, the drawer
// closes and writes a TargetingRequest here; the map's ThreeDTargetingLayer
// reads it, resolves the next click into an actor/position, and dispatches the
// use action. Mirrors `presenceStore` in domains/Context/contextStore.ts.
//
// No callbacks are stored -- the request carries everything the map needs to
// dispatch the action itself (actionKey + baseParams + the resolved target),
// keeping the store serializable and decoupled from the drawer.

import { proxy } from "valtio";

export interface TargetingRequest {
	/** Action to dispatch once a target is chosen, e.g. "item:use" | "skill:use". */
	actionKey: string;
	/** Base params merged with the resolved target, e.g. { actorId, itemId }. */
	baseParams: Record<string, unknown>;
	/** Whether clicking an actor token resolves a target. */
	allowActor: boolean;
	/** Whether clicking a terrain tile resolves a target. */
	allowPosition: boolean;
	/** Human label for the targeting cue, e.g. the item/skill name. */
	label: string;
}

/** What the cursor is currently over while targeting -- drives the cue label. */
export type TargetHover =
	| { kind: "actor"; actorId: string }
	| { kind: "position"; x: number; y: number; h: number }
	| null;

export const targetingStore = proxy<{
	request: TargetingRequest | null;
	hover: TargetHover;
}>({
	request: null,
	hover: null,
});

/** Enter targeting mode for the given request. */
export function beginTargeting(request: TargetingRequest): void {
	targetingStore.request = request;
	targetingStore.hover = null;
}

/** Leave targeting mode without resolving a target. */
export function cancelTargeting(): void {
	targetingStore.request = null;
	targetingStore.hover = null;
}

/** Update what the cursor is currently over (null when over nothing valid). */
export function setTargetHover(hover: TargetHover): void {
	targetingStore.hover = hover;
}
