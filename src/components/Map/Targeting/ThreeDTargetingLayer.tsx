// components/Map/Targeting/ThreeDTargetingLayer.tsx
//
// Map input layer active only while an item/skill targeting request is pending
// (see targetingStore). It resolves the next click into either an actor (clicking
// a token) or a position (clicking a terrain tile), then hands the result to
// MapScene, which dispatches the use action. Escape / right-click cancels.
//
// While active it also tracks what the cursor is over (publishing it to
// targetingStore.hover so the cue banner can name the current target) and swaps
// the cursor between the tile reticle and the actor reticle accordingly.
//
// Modeled on ThreeDPingLayer: capture-phase pointer listeners with a drag guard
// so a camera-rotate drag isn't mistaken for a click. The competing click layers
// (movement, actor selection) early-return while targetingStore.request is set,
// so this layer doesn't need to fight them for the event; it leaves propagation
// alone so OrbitControls can still rotate/pan during targeting.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useSnapshot } from "valtio";
import type { VoxelTerrainIndex } from "../../../utils/terrain/data/VoxelTerrainIndex";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	pickActorUnderPointer,
	raycastTerrainDDA,
	terrainDDAHitToVoxelTile,
} from "../Movement3D/movement3DHelpers";
import { setRaycasterFromPointer } from "../mapSceneUtils";
import { THREE_D_PING_INPUT } from "../threeDMapConstants";
import { cancelTargeting, setTargetHover, targetingStore } from "./targetingStore";
import { TARGET_ACTOR_CURSOR, TARGET_TILE_CURSOR } from "./targetingCursors";

export type TargetResult =
	| { kind: "actor"; actorId: string }
	| { kind: "position"; x: number; y: number; h: number };

interface ThreeDTargetingLayerProps {
	resources: ThreeDSceneResources;
	terrainIndex: VoxelTerrainIndex;
	onResolveTarget: (result: TargetResult) => void;
}

export function ThreeDTargetingLayer({
	resources,
	terrainIndex,
	onResolveTarget,
}: ThreeDTargetingLayerProps) {
	const { request } = useSnapshot(targetingStore);
	const isActive = request !== null;

	const onResolveTargetRef = useRef(onResolveTarget);
	useEffect(() => {
		onResolveTargetRef.current = onResolveTarget;
	}, [onResolveTarget]);

	useEffect(() => {
		if (!isActive) return;

		const el = resources.domElement;
		const previousCursor = el.style.cursor;
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();
		let pending: { pointerId: number; startX: number; startY: number } | null =
			null;
		let pendingMove: PointerEvent | null = null;
		let moveRafId = 0;
		let lastHoverKey = "";

		// What the cursor is over right now, or null over empty space. Used for
		// both the click resolution and the live hover cue / cursor shape.
		const computeTarget = (event: PointerEvent): TargetResult | null => {
			const req = targetingStore.request;
			if (!req) return null;
			setRaycasterFromPointer(raycaster, event, resources, pointer);

			if (req.allowActor) {
				const actor = pickActorUnderPointer(
					raycaster,
					resources.actorPickTargets,
					terrainIndex
				);
				// Any actor is a valid target, self included.
				if (actor) {
					return { kind: "actor", actorId: actor.actorId };
				}
			}

			if (req.allowPosition) {
				const hit = raycastTerrainDDA(raycaster.ray, terrainIndex);
				if (hit) {
					const tile = terrainDDAHitToVoxelTile(hit);
					return { kind: "position", x: tile.x, y: tile.y, h: tile.h };
				}
			}

			return null;
		};

		const applyCursor = (hover: TargetResult | null) => {
			el.style.cursor =
				hover?.kind === "actor" ? TARGET_ACTOR_CURSOR : TARGET_TILE_CURSOR;
		};

		// Initial cursor before the first pointer move.
		applyCursor(null);

		const processMove = () => {
			moveRafId = 0;
			const event = pendingMove;
			pendingMove = null;
			if (!event) return;
			const hover = computeTarget(event);
			applyCursor(hover);
			// Only publish when the hovered target actually changed, so the cue
			// banner doesn't re-render on every frame of an in-tile mouse move.
			const key = !hover
				? ""
				: hover.kind === "actor"
					? `a:${hover.actorId}`
					: `p:${hover.x},${hover.y},${hover.h}`;
			if (key !== lastHoverKey) {
				lastHoverKey = key;
				setTargetHover(hover);
			}
		};

		const handlePointerMove = (event: PointerEvent) => {
			pendingMove = event;
			if (moveRafId === 0) moveRafId = requestAnimationFrame(processMove);
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button !== 0 || event.altKey) return;
			if (resources.dragState.active) return;
			pending = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
			};
		};

		const handlePointerUp = (event: PointerEvent) => {
			const click = pending;
			if (!click || click.pointerId !== event.pointerId) return;
			pending = null;
			if (event.button !== 0) return;

			const dx = event.clientX - click.startX;
			const dy = event.clientY - click.startY;
			// A drag past the threshold was a camera rotate, not a target click.
			if (Math.hypot(dx, dy) > THREE_D_PING_INPUT.CLICK_DRAG_THRESHOLD_PX) {
				return;
			}

			const result = computeTarget(event);
			// A miss (clicked empty space) keeps targeting mode active.
			if (result) onResolveTargetRef.current(result);
		};

		const handlePointerCancel = (event: PointerEvent) => {
			if (pending?.pointerId === event.pointerId) pending = null;
		};

		const handlePointerLeave = () => {
			lastHoverKey = "";
			setTargetHover(null);
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") cancelTargeting();
		};

		const handleContextMenu = (event: MouseEvent) => {
			event.preventDefault();
			cancelTargeting();
		};

		el.addEventListener("pointermove", handlePointerMove);
		el.addEventListener("pointerleave", handlePointerLeave);
		el.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("pointerup", handlePointerUp, true);
		window.addEventListener("pointercancel", handlePointerCancel, true);
		window.addEventListener("keydown", handleKeyDown, true);
		el.addEventListener("contextmenu", handleContextMenu, true);

		return () => {
			if (moveRafId !== 0) cancelAnimationFrame(moveRafId);
			el.style.cursor = previousCursor;
			setTargetHover(null);
			el.removeEventListener("pointermove", handlePointerMove);
			el.removeEventListener("pointerleave", handlePointerLeave);
			el.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("pointerup", handlePointerUp, true);
			window.removeEventListener("pointercancel", handlePointerCancel, true);
			window.removeEventListener("keydown", handleKeyDown, true);
			el.removeEventListener("contextmenu", handleContextMenu, true);
		};
	}, [isActive, resources, terrainIndex]);

	return null;
}
