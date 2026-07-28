// components/Map/Targeting/ThreeDTargetingLayer.tsx
//
// Map input layer active only while a targeting request is pending (see
// targetingStore). It resolves the next click into either an actor (clicking a
// token) or a position (clicking a terrain tile) and invokes the request's
// onResolve callback. Escape cancels everywhere; right-click also cancels in
// ordinary orbit modes, but remains reserved for actor look in Follow/FP.
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
//
// It runs in BOTH view modes. In world mode the aim point is the cursor; in
// first-person mode the pointer is locked, so the aim is the screen-centre
// crosshair (raycast from the FP camera through the middle of the viewport). The
// resolve/hover logic is shared — only the ray origin and a few input details
// differ (see the `worldPointer` branches).

import { useEffect } from "react";
import * as THREE from "three";
import { useSnapshot } from "valtio";
import type { VoxelTerrainIndex } from "../../../utils/terrain/data/VoxelTerrainIndex";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	makeHeroOcclusionVoxelSkip,
	pickActorUnderPointer,
	raycastTerrainDDA,
	terrainDDAHitToVoxelTile,
} from "../Movement3D/movement3DHelpers";
import { setRaycasterFromCenter, setRaycasterFromPointer } from "../mapSceneUtils";
import { THREE_D_PING_INPUT } from "../threeDMapConstants";
import {
	cancelTargeting,
	setTargetHover,
	targetingStore,
	type TargetResult,
} from "./targetingStore";
import type { MapInteractionMode } from "../../../utils/camera/CameraModes";
import { TARGET_ACTOR_CURSOR, TARGET_TILE_CURSOR } from "./targetingCursors";

interface ThreeDTargetingLayerProps {
	resources: ThreeDSceneResources;
	terrainIndex: VoxelTerrainIndex;
	/** The terrain being targeted; stamped onto resolved position targets. */
	terrainId: string;
	/** Where the aim point comes from: the cursor under "world-pointer", the
	 *  screen centre crosshair under "actor-look". */
	interactionMode: MapInteractionMode;
	/** Whether a stationary right click cancels the targeting request. False in
	 *  the actor camera modes, which reserve right click for look mode. */
	cancelWithRightClick: boolean;
}

export function ThreeDTargetingLayer({
	resources,
	terrainIndex,
	terrainId,
	interactionMode,
	cancelWithRightClick,
}: ThreeDTargetingLayerProps) {
	const worldPointer = interactionMode === "world-pointer";
	const { request } = useSnapshot(targetingStore);
	const isActive = request !== null;

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
		let hoverRafId = 0;
		let lastHoverKey = "";
		// Right-button press position, so a right-drag (camera pan) can be told
		// apart from a right-click (cancel) at contextmenu time. World-only —
		// in first-person the right button engages look mode, not cancel.
		let rightDown: { x: number; y: number } | null = null;

		// What the aim is over right now, or null over empty space. Used for both
		// the click resolution and the live hover cue / cursor shape. `event` is
		// only consulted in world mode; first-person always aims from centre.
		const computeTarget = (event: PointerEvent | null): TargetResult | null => {
			const req = targetingStore.request;
			if (!req) return null;
			if (worldPointer) {
				if (!event) return null;
				setRaycasterFromPointer(raycaster, event, resources, pointer);
			} else {
				setRaycasterFromCenter(raycaster, resources);
			}

			// See through the hero-occlusion keyhole for both actor and position aim.
			const heroSkip = makeHeroOcclusionVoxelSkip(terrainIndex, resources.heroOcclusion);

			if (req.allowActor) {
				const actor = pickActorUnderPointer(
					raycaster,
					resources.actorPickTargets,
					terrainIndex,
					{ skipVoxel: heroSkip }
				);
				// Any actor is a valid target unless explicitly excluded.
				if (actor && actor.actorId !== req.excludeActorId) {
					return { kind: "actor", actorId: actor.actorId };
				}
			}

			if (req.allowPosition) {
				const hit = raycastTerrainDDA(raycaster.ray, terrainIndex, heroSkip);
				if (hit) {
					const tile = terrainDDAHitToVoxelTile(hit);
					return { kind: "position", terrainId, x: tile.x, y: tile.y, h: tile.h };
				}
			}

			return null;
		};

		const applyCursor = (hover: TargetResult | null) => {
			// World only: the cursor becomes the aim reticle. In first-person the
			// pointer is locked/hidden and the crosshair (HUD) is the aim indicator.
			el.style.cursor =
				hover?.kind === "actor" ? TARGET_ACTOR_CURSOR : TARGET_TILE_CURSOR;
		};

		// Publish the current hover to the cue store, but only when it actually
		// changed, so the banner doesn't re-render every frame of a mouse move / look.
		const publishHover = (hover: TargetResult | null) => {
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

		const processMove = () => {
			moveRafId = 0;
			const event = pendingMove;
			pendingMove = null;
			if (!event) return;
			const hover = computeTarget(event);
			applyCursor(hover);
			publishHover(hover);
		};

		const handlePointerMove = (event: PointerEvent) => {
			pendingMove = event;
			if (moveRafId === 0) moveRafId = requestAnimationFrame(processMove);
		};

		// First-person: no pointer moves while looking with the aim fixed to the
		// crosshair, so poll each frame to keep the cue tracking the camera as the
		// player looks around (and during the enter-FP tween).
		const tickHover = () => {
			hoverRafId = requestAnimationFrame(tickHover);
			publishHover(computeTarget(null));
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button === 2) {
				// Ordinary orbit modes track this press so a stationary right click
				// cancels at contextmenu time. Actor cameras reserve it for look mode.
				if (cancelWithRightClick) {
					rightDown = { x: event.clientX, y: event.clientY };
				}
				return;
			}
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
			// (In first-person the pointer is locked, so the coords don't move and
			// this always reads as a click.)
			if (Math.hypot(dx, dy) > THREE_D_PING_INPUT.CLICK_DRAG_THRESHOLD_PX) {
				return;
			}

			// World aims from the cursor; first-person from the screen-centre crosshair.
			const result = computeTarget(worldPointer ? event : null);
			// A miss (clicked empty space) keeps targeting mode active.
			if (!result) return;
			targetingStore.request?.onResolve(result);
			cancelTargeting();
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
			// Always suppress the browser menu during targeting; only treat it as a
			// cancel when the right-button didn't drag (a drag is a camera pan).
			event.preventDefault();
			const down = rightDown;
			rightDown = null;
			if (down) {
				const dx = event.clientX - down.x;
				const dy = event.clientY - down.y;
				if (Math.hypot(dx, dy) > THREE_D_PING_INPUT.CLICK_DRAG_THRESHOLD_PX) {
					return;
				}
			}
			cancelTargeting();
		};

		el.addEventListener("pointerdown", handlePointerDown, true);
		window.addEventListener("pointerup", handlePointerUp, true);
		window.addEventListener("pointercancel", handlePointerCancel, true);
		window.addEventListener("keydown", handleKeyDown, true);
		if (worldPointer) {
			// Initial reticle cursor before the first pointer move.
			applyCursor(null);
			el.addEventListener("pointermove", handlePointerMove);
			el.addEventListener("pointerleave", handlePointerLeave);
			if (cancelWithRightClick) {
				el.addEventListener("contextmenu", handleContextMenu, true);
			}
		} else {
			hoverRafId = requestAnimationFrame(tickHover);
		}

		return () => {
			if (moveRafId !== 0) cancelAnimationFrame(moveRafId);
			if (hoverRafId !== 0) cancelAnimationFrame(hoverRafId);
			el.style.cursor = previousCursor;
			setTargetHover(null);
			el.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("pointerup", handlePointerUp, true);
			window.removeEventListener("pointercancel", handlePointerCancel, true);
			window.removeEventListener("keydown", handleKeyDown, true);
			el.removeEventListener("pointermove", handlePointerMove);
			el.removeEventListener("pointerleave", handlePointerLeave);
			el.removeEventListener("contextmenu", handleContextMenu, true);
		};
	}, [
		isActive,
		worldPointer,
		cancelWithRightClick,
		resources,
		terrainIndex,
		terrainId,
	]);

	return null;
}
