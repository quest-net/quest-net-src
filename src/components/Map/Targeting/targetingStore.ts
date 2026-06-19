// components/Map/Targeting/targetingStore.ts
//
// Transient, never-persisted Valtio store that bridges a target requester (the
// item/skill use drawer, an ActorPicker, or any future caller) and the map,
// which live in separate React trees. The requester calls beginTargeting() with
// an onResolve callback; the map's ThreeDTargetingLayer resolves the next click
// into an actor or terrain position and invokes that callback. Mirrors
// `presenceStore` in domains/Context/contextStore.ts (transient runtime state).
//
// This store is deliberately domain-agnostic: it knows how to pick a target on
// the map and hand it back, nothing more. Each caller owns what the target means
// (e.g. the item drawer dispatches "item:use", the ActorPicker calls onConfirm).

import { proxy } from "valtio";

/** A target chosen on the map. */
export type TargetResult =
	| { kind: "actor"; actorId: string }
	| { kind: "position"; terrainId: string; x: number; y: number; h: number };

export interface TargetingRequest {
	/** Whether clicking an actor token resolves a target. */
	allowActor: boolean;
	/** Whether clicking a terrain tile resolves a target. */
	allowPosition: boolean;
	/** Human label for the targeting cue, e.g. the item/skill name. */
	label: string;
	/** Actor that may not be chosen (e.g. no transfer-to-self). Omit to allow any. */
	excludeActorId?: string;
	/** Invoked with the chosen target once the user clicks a valid one. */
	onResolve: (result: TargetResult) => void;
}

/** What the cursor is currently over while targeting -- drives the cue label. */
export type TargetHover = TargetResult | null;

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

/**
 * Maps a chosen target onto the standard `targetActorId` / `targetPosition`
 * action-param convention shared by targetable actions (item:use, skill:use,
 * and future ones). Spread into the action params alongside the base fields.
 */
export function targetResultToParams(
	result: TargetResult
):
	| { targetActorId: string }
	| { targetPosition: { terrainId: string; x: number; y: number; h: number } } {
	return result.kind === "actor"
		? { targetActorId: result.actorId }
		: {
				targetPosition: {
					terrainId: result.terrainId,
					x: result.x,
					y: result.y,
					h: result.h,
				},
		  };
}
