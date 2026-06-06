// components/Map/TerrainLinks3D/ThreeDTerrainLinkLayer.tsx
//
// Renders terrain links as invisible, pickable hitboxes (1 tile wide/deep, 2
// tactical units tall) at each link anchor on the rendered terrain, and drives
// the link interaction in both world and first-person views.
//
// Links have no visible geometry of their own (the DM signals them with cosmetic
// stamps). Hovering a link's hitbox reveals where it leads (unless locked, for
// non-DMs). "Using" a link is just a terrain-crossing move of the controlled
// actor to the link's opposite anchor, dispatched via onTraverse -> the ordinary
// character:move / entity:move (see TerrainLinkActions header). Use is gated on
// the controlled actor being on or adjacent to the anchor, and on the link not
// being locked (DM bypasses the lock).

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Position } from "../../../domains/Actor/Actor";
import {
	getTerrainLinkAnchorsOnTerrain,
	getTerrainLinkInteractionState,
	type TerrainLink,
	type TerrainLinkAnchor,
} from "../../../domains/TerrainLink/TerrainLink";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import type { VoxelTerrainIndex } from "../../../utils/terrain/data/VoxelTerrainIndex";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import { setRaycasterFromPointer } from "../mapSceneUtils";
import { raycastTerrainDDA } from "../Movement3D/movement3DHelpers";
import {
	createTerrainLinkMarkerGeometry,
	createTerrainLinkMarkerMesh,
	disposeTerrainLinkMarkerGroup,
} from "./terrainLinkMarkerMesh";

const LINK_MARKER_OPACITY = 0.34;
// Tolerance for the world-view occlusion comparison (transparent hitbox vs terrain).
const OCCLUSION_EPSILON = 0.001;
const CLICK_DRAG_THRESHOLD_PX = 5;

/** The link currently hovered (world) or centered in view (first person). */
export interface TerrainLinkInteractionFocus {
	linkId: string;
	/** Destination terrain name, or null when concealed (locked & not the DM). */
	destinationName: string | null;
	locked: boolean;
	/** Whether the controlled actor can traverse it right now (adjacent + unlocked, unless DM). */
	usable: boolean;
	/** DM authoring mode: click toggles lock state instead of traversing. */
	authoring?: boolean;
	/** Cursor position for the world-view tooltip; null in first person. */
	screen: { x: number; y: number } | null;
}

interface ControlledActor {
	id: string;
	kind: "character" | "entity";
	position: Position;
}

interface LinkBoxData {
	linkId: string;
	anchor: TerrainLinkAnchor;
	destination: TerrainLinkAnchor;
	locked: boolean;
}

interface ThreeDTerrainLinkLayerProps {
	resources: ThreeDSceneResources;
	isWorld: boolean;
	terrain: VoxelTerrain;
	terrainIndex: VoxelTerrainIndex;
	links: TerrainLink[];
	terrainNamesById: ReadonlyMap<string, string>;
	controlledActor: ControlledActor | null;
	getControlledActorPosition: () => Position | null;
	isDM: boolean;
	showLinkMarkers: boolean;
	onTraverse: (
		actor: { id: string; kind: "character" | "entity" },
		destination: Position
	) => void;
	onToggleLinkLocked?: (linkId: string, locked: boolean) => void;
	onFocusChange: (focus: TerrainLinkInteractionFocus | null) => void;
}

function linkAnchorsSignature(links: TerrainLink[], terrainId: string): string {
	return getTerrainLinkAnchorsOnTerrain(links, terrainId)
		.map(
			({ link, anchor, destination }) =>
				`${link.Id}:${anchor.x},${anchor.y},${anchor.h}->${destination.terrainId},${destination.x},${destination.y},${destination.h}:${link.Locked ? 1 : 0}`
		)
		.sort()
		.join("|");
}

function focusSignature(focus: TerrainLinkInteractionFocus | null): string {
	if (!focus) return "";
	return `${focus.linkId}:${focus.usable ? 1 : 0}:${focus.locked ? 1 : 0}:${focus.authoring ? 1 : 0}:${focus.destinationName ?? ""}`;
}

export function ThreeDTerrainLinkLayer({
	resources,
	isWorld,
	terrain,
	terrainIndex,
	links,
	terrainNamesById,
	controlledActor,
	getControlledActorPosition,
	isDM,
	showLinkMarkers,
	onTraverse,
	onToggleLinkLocked,
	onFocusChange,
}: ThreeDTerrainLinkLayerProps) {
	// Live values read by the long-lived input effect without re-subscribing.
	const controlledActorRef = useRef(controlledActor);
	const terrainNamesRef = useRef(terrainNamesById);
	const isDMRef = useRef(isDM);
	const showLinkMarkersRef = useRef(showLinkMarkers);
	const getControlledActorPositionRef = useRef(getControlledActorPosition);
	const onTraverseRef = useRef(onTraverse);
	const onToggleLinkLockedRef = useRef(onToggleLinkLocked);
	const onFocusChangeRef = useRef(onFocusChange);
	const boxesRef = useRef<THREE.Mesh[]>([]);

	useEffect(() => {
		controlledActorRef.current = controlledActor;
		terrainNamesRef.current = terrainNamesById;
		isDMRef.current = isDM;
		showLinkMarkersRef.current = showLinkMarkers;
		getControlledActorPositionRef.current = getControlledActorPosition;
		onTraverseRef.current = onTraverse;
		onToggleLinkLockedRef.current = onToggleLinkLocked;
		onFocusChangeRef.current = onFocusChange;
	}, [
		controlledActor,
		terrainNamesById,
		isDM,
		showLinkMarkers,
		getControlledActorPosition,
		onTraverse,
		onToggleLinkLocked,
		onFocusChange,
	]);

	useEffect(() => {
		if (!showLinkMarkers) onFocusChange(null);
	}, [showLinkMarkers, onFocusChange]);

	// --- Build the invisible hitboxes for links on this terrain. ---
	const anchorSignature = linkAnchorsSignature(links, terrain.Id);
	useEffect(() => {
		const anchors = getTerrainLinkAnchorsOnTerrain(links, terrain.Id);
		const group = new THREE.Group();
		const boxes: THREE.Mesh[] = [];
		const renderLinkMarkers = isDM && showLinkMarkers;

		const geometry = createTerrainLinkMarkerGeometry();

		for (const { link, anchor, destination } of anchors) {
			// Always raycastable. Normally invisible; in DM display mode it becomes
			// a depth-test-free authoring marker so hidden links are still visible.
			const box = createTerrainLinkMarkerMesh({
				terrain,
				geometry,
				anchor,
				locked: link.Locked,
				opacity: renderLinkMarkers ? LINK_MARKER_OPACITY : 0,
				depthTest: !renderLinkMarkers,
				colorWrite: renderLinkMarkers,
				renderOrder: renderLinkMarkers ? 42 : 0,
			});
			const data: LinkBoxData = {
				linkId: link.Id,
				anchor,
				destination,
				locked: link.Locked,
			};
			box.userData = data;
			group.add(box);
			boxes.push(box);
			resources.linkPickTargets.push(box);
		}

		resources.scene.add(group);
		boxesRef.current = boxes;

		return () => {
			resources.scene.remove(group);
			for (const box of boxes) {
				const index = resources.linkPickTargets.indexOf(box);
				if (index !== -1) resources.linkPickTargets.splice(index, 1);
			}
			disposeTerrainLinkMarkerGroup(group);
			boxesRef.current = [];
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resources, terrain, anchorSignature, isDM, showLinkMarkers]);

	// --- Interaction (world: pointer; first person: center-screen + E key). ---
	useEffect(() => {
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();

		const buildFocus = (
			box: THREE.Mesh,
			screen: { x: number; y: number } | null
		): TerrainLinkInteractionFocus | null => {
			const data = box.userData as LinkBoxData;
			const authoring = isWorld && isDMRef.current && showLinkMarkersRef.current;
			if (authoring) {
				return {
					linkId: data.linkId,
					destinationName:
						terrainNamesRef.current.get(data.destination.terrainId) ??
						"another area",
					locked: data.locked,
					usable: false,
					authoring: true,
					screen,
				};
			}
			const actor = controlledActorRef.current;
			const actorPosition =
				actor ? getControlledActorPositionRef.current() ?? actor.position : null;
			const interaction = getTerrainLinkInteractionState(
				data.anchor,
				actorPosition,
				data.locked
			);
			// A locked link is invisible and inert to anyone controlling an actor --
			// players and impersonating DMs alike. Returning null means no focus, and
			// thus no hover tooltip, no first-person prompt, and no click/E handling:
			// it is as if the link were not there. Only the DM authoring/display mode
			// handled above ever surfaces a locked link.
			if (!interaction || interaction.locked) return null;

			return {
				linkId: data.linkId,
				destinationName:
					terrainNamesRef.current.get(data.destination.terrainId) ?? "another area",
				locked: false,
				usable: interaction.usable,
				screen,
			};
		};

		const isInteractiveLinkBox = (target: THREE.Object3D): boolean => {
			const box = target as THREE.Mesh;
			if (!box.userData?.linkId) return false;
			if (isWorld && isDMRef.current && showLinkMarkersRef.current) return true;
			return buildFocus(box, null) !== null;
		};
		const isTerrainBlockingLinkBox = (target: THREE.Object3D): boolean =>
			!!target.userData?.linkId &&
			isWorld &&
			isDMRef.current &&
			showLinkMarkersRef.current;

		const previousLinkPredicate = resources.isLinkPickTargetInteractive;
		const previousTerrainBlockingPredicate =
			resources.isLinkPickTargetTerrainBlocking;
		resources.isLinkPickTargetInteractive = isInteractiveLinkBox;
		resources.isLinkPickTargetTerrainBlocking = isTerrainBlockingLinkBox;

		// The closest non-occluded link hitbox under the current ray, or null.
		const pickRawLink = (): THREE.Mesh | null => {
			const hits = raycaster.intersectObjects(boxesRef.current, false);
			if (hits.length === 0) return null;
			const hit = hits[0];
			if (!(isWorld && isDMRef.current && showLinkMarkersRef.current)) {
				// A link buried behind/under terrain (closer terrain hit) reads as hidden.
				const terrainHit = raycastTerrainDDA(raycaster.ray, terrainIndex);
				if (terrainHit && terrainHit.distance + OCCLUSION_EPSILON < hit.distance) {
					return null;
				}
			}
			return hit.object as THREE.Mesh;
		};

		const pickLink = (): { box: THREE.Mesh; focus: TerrainLinkInteractionFocus } | null => {
			const box = pickRawLink();
			if (!box) return null;
			const focus = buildFocus(box, null);
			return focus ? { box, focus } : null;
		};

		const traverse = (box: THREE.Mesh) => {
			const actor = controlledActorRef.current;
			if (!actor) return;
			const data = box.userData as LinkBoxData;
			onTraverseRef.current(
				{ id: actor.id, kind: actor.kind },
				{
					terrainId: data.destination.terrainId,
					x: data.destination.x,
					y: data.destination.y,
					h: data.destination.h,
				}
			);
		};

		const toggleLock = (box: THREE.Mesh) => {
			const data = box.userData as LinkBoxData;
			onToggleLinkLockedRef.current?.(data.linkId, !data.locked);
		};

		const lastFocusRef = { current: null as TerrainLinkInteractionFocus | null };
		const emitFocus = (focus: TerrainLinkInteractionFocus | null) => {
			if (focusSignature(focus) === focusSignature(lastFocusRef.current)) {
				// World view still needs cursor position updates so the tooltip
				// follows the pointer; only short-circuit when nothing meaningful
				// changed AND we're not tracking a screen position (first person).
				if (!focus || !focus.screen) return;
			}
			lastFocusRef.current = focus;
			onFocusChangeRef.current(focus);
		};

		// ----- World view: pointer hover + click -----
		if (isWorld) {
			let pendingMove: PointerEvent | null = null;
			let rafId = 0;

			const processMove = () => {
				rafId = 0;
				const event = pendingMove;
				pendingMove = null;
				if (!event) return;
				if (resources.dragState.active) {
					emitFocus(null);
					return;
				}
				setRaycasterFromPointer(raycaster, event, resources, pointer);
				const picked = pickLink();
				emitFocus(
					picked
						? { ...picked.focus, screen: { x: event.clientX, y: event.clientY } }
						: null
				);
			};

			const handlePointerMove = (event: PointerEvent) => {
				pendingMove = event;
				if (rafId === 0) rafId = requestAnimationFrame(processMove);
			};

			const handlePointerLeave = () => {
				pendingMove = null;
				if (rafId !== 0) {
					cancelAnimationFrame(rafId);
					rafId = 0;
				}
				emitFocus(null);
			};

			let pendingClick: { pointerId: number; startX: number; startY: number } | null =
				null;

			const handlePointerDown = (event: PointerEvent) => {
				if (event.button !== 0) return;
				if (resources.dragState.active) {
					pendingClick = null;
					return;
				}
				setRaycasterFromPointer(raycaster, event, resources, pointer);
				const picked = pickLink();
				if (!picked) {
					pendingClick = null;
					return;
				}
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				pendingClick = {
					pointerId: event.pointerId,
					startX: event.clientX,
					startY: event.clientY,
				};
			};

			const handlePointerUp = (event: PointerEvent) => {
				if (event.button !== 0) return;
				const click = pendingClick;
				pendingClick = null;
				if (!click || click.pointerId !== event.pointerId) return;
				if (resources.dragState.active) return;

				const dx = event.clientX - click.startX;
				const dy = event.clientY - click.startY;
				if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) return;

				setRaycasterFromPointer(raycaster, event, resources, pointer);
				const picked = pickLink();
				// Consume so the movement layer's window pointerup doesn't also act.
				event.preventDefault();
				event.stopPropagation();
				event.stopImmediatePropagation();
				if (picked?.focus.authoring) {
					toggleLock(picked.box);
					emitFocus(null);
					return;
				}
				if (!picked || !picked.focus.usable) return;
				traverse(picked.box);
				emitFocus(null);
			};

			const handlePointerCancel = (event: PointerEvent) => {
				if (pendingClick?.pointerId === event.pointerId) pendingClick = null;
			};

			resources.domElement.addEventListener("pointermove", handlePointerMove);
			resources.domElement.addEventListener("pointerleave", handlePointerLeave);
			resources.domElement.addEventListener("pointerdown", handlePointerDown, true);
			window.addEventListener("pointerup", handlePointerUp, true);
			window.addEventListener("pointercancel", handlePointerCancel, true);

			return () => {
				resources.domElement.removeEventListener("pointermove", handlePointerMove);
				resources.domElement.removeEventListener("pointerleave", handlePointerLeave);
				resources.domElement.removeEventListener("pointerdown", handlePointerDown, true);
				window.removeEventListener("pointerup", handlePointerUp, true);
				window.removeEventListener("pointercancel", handlePointerCancel, true);
				if (rafId !== 0) cancelAnimationFrame(rafId);
				if (resources.isLinkPickTargetInteractive === isInteractiveLinkBox) {
					resources.isLinkPickTargetInteractive = previousLinkPredicate;
				}
				if (
					resources.isLinkPickTargetTerrainBlocking === isTerrainBlockingLinkBox
				) {
					resources.isLinkPickTargetTerrainBlocking =
						previousTerrainBlockingPredicate;
				}
				emitFocus(null);
			};
		}

		// ----- First person: proximity targeting + E to go through -----
		// There is no crosshair to aim with, so the prompt tracks the nearest
		// visible link to the controlled actor rather than whatever the camera
		// happens to point at. buildFocus already filters out locked links, so only
		// usable links are ever targeted here.
		const fpTargetRef = { current: null as THREE.Mesh | null };
		// True only while an E press is being held after it actually triggered a
		// traversal, so auto-repeat can't fire a second one. A press that doesn't
		// traverse (no target / not usable) must NOT latch, otherwise the next valid
		// press would be swallowed until the key is released and pressed again.
		const eConsumedRef = { current: false };

		const tick = () => {
			const actor = controlledActorRef.current;
			if (!actor) {
				fpTargetRef.current = null;
				emitFocus(null);
				return;
			}
			let bestBox: THREE.Mesh | null = null;
			let bestFocus: TerrainLinkInteractionFocus | null = null;
			let bestDistance = Infinity;
			for (const box of boxesRef.current) {
				const focus = buildFocus(box, null);
				if (!focus) continue;
				const data = box.userData as LinkBoxData;
				const actorPosition =
					getControlledActorPositionRef.current() ?? actor.position;
				const distance = Math.max(
					Math.abs(actorPosition.x - data.anchor.x),
					Math.abs(actorPosition.y - data.anchor.y)
				);
				if (distance < bestDistance) {
					bestDistance = distance;
					bestBox = box;
					bestFocus = focus;
				}
			}
			fpTargetRef.current = bestBox;
			emitFocus(bestFocus);
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.code !== "KeyE" || event.repeat || eConsumedRef.current) return;
			const box = fpTargetRef.current;
			if (!box) return;
			const focus = buildFocus(box, null);
			if (!focus?.usable) return;
			// Latch only now that we're committing, so an early miss above doesn't
			// block a follow-up press.
			eConsumedRef.current = true;
			event.preventDefault();
			fpTargetRef.current = null;
			emitFocus(null);
			traverse(box);
		};

		const handleKeyUp = (event: KeyboardEvent) => {
			if (event.code === "KeyE") eConsumedRef.current = false;
		};

		resources.animationCallbacks.add(tick);
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("keyup", handleKeyUp);

		return () => {
			resources.animationCallbacks.delete(tick);
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("keyup", handleKeyUp);
			if (resources.isLinkPickTargetInteractive === isInteractiveLinkBox) {
				resources.isLinkPickTargetInteractive = previousLinkPredicate;
			}
			if (
				resources.isLinkPickTargetTerrainBlocking === isTerrainBlockingLinkBox
			) {
				resources.isLinkPickTargetTerrainBlocking =
					previousTerrainBlockingPredicate;
			}
			emitFocus(null);
		};
	}, [resources, isWorld, terrainIndex]);

	return null;
}
