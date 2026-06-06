// components/Map/Doors3D/ThreeDDoorLayer.tsx
//
// Renders doors as invisible, pickable hitboxes (1 tile wide/deep, 2 tactical
// units tall) at each door anchor on the rendered terrain, and drives the door
// interaction in both world and first-person views.
//
// Doors have no visible geometry of their own (the DM signals them with cosmetic
// stamps). Hovering a door's hitbox reveals where it leads (unless locked, for
// non-DMs). "Using" a door is just a terrain-crossing move of the controlled
// actor to the door's opposite anchor, dispatched via onTraverse -> the ordinary
// character:move / entity:move (see DoorActions header). Use is gated on the
// controlled actor being within DOOR_INTERACT_DISTANCE of the anchor AND having
// line of sight to it (voxel DDA), and on the door not being locked (DM bypasses
// the lock). See docs/multi-terrain-world.md §5.5.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { Position } from "../../../domains/Actor/Actor";
import { getDoorAnchorsOnTerrain, type Door, type DoorAnchor } from "../../../domains/Door/Door";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import type { VoxelTerrainIndex } from "../../../utils/terrain/data/VoxelTerrainIndex";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import { terrainHeightToWorldY } from "../Actors3D/actorTokenPlacement";
import { setRaycasterFromPointer } from "../mapSceneUtils";
import { raycastTerrainDDA } from "../Movement3D/movement3DHelpers";

// A door spans one tile and stands two tactical units tall.
const DOOR_BOX_FOOTPRINT = 1;
const DOOR_BOX_HEIGHT = 2;
// How close (in tactical tiles, horizontal) the controlled actor must be to use
// a door. ~2 tiles = "walk up to it" without demanding pixel-perfect adjacency.
const DOOR_INTERACT_DISTANCE = 2;
// Tolerance for the world-view occlusion comparison (transparent hitbox vs terrain).
const OCCLUSION_EPSILON = 0.001;
const CLICK_DRAG_THRESHOLD_PX = 5;

/** The door currently hovered (world) or centered in view (first person). */
export interface DoorInteractionFocus {
	doorId: string;
	/** Destination terrain name, or null when concealed (locked & not the DM). */
	destinationName: string | null;
	locked: boolean;
	/** Whether the controlled actor can traverse it right now (range + LOS + unlocked). */
	usable: boolean;
	/** Cursor position for the world-view tooltip; null in first person. */
	screen: { x: number; y: number } | null;
}

interface ControlledActor {
	id: string;
	kind: "character" | "entity";
	position: Position;
}

interface DoorBoxData {
	doorId: string;
	anchor: DoorAnchor;
	destination: DoorAnchor;
	locked: boolean;
}

interface ThreeDDoorLayerProps {
	resources: ThreeDSceneResources;
	isWorld: boolean;
	terrain: VoxelTerrain;
	terrainIndex: VoxelTerrainIndex;
	doors: Door[];
	terrainNamesById: ReadonlyMap<string, string>;
	controlledActor: ControlledActor | null;
	isDM: boolean;
	onTraverse: (
		actor: { id: string; kind: "character" | "entity" },
		destination: Position
	) => void;
	onFocusChange: (focus: DoorInteractionFocus | null) => void;
}

function doorAnchorsSignature(doors: Door[], terrainId: string): string {
	return getDoorAnchorsOnTerrain(doors, terrainId)
		.map(
			({ door, anchor, destination }) =>
				`${door.Id}:${anchor.x},${anchor.y},${anchor.h}->${destination.terrainId}:${door.Locked ? 1 : 0}`
		)
		.sort()
		.join("|");
}

function focusSignature(focus: DoorInteractionFocus | null): string {
	if (!focus) return "";
	return `${focus.doorId}:${focus.usable ? 1 : 0}:${focus.locked ? 1 : 0}:${focus.destinationName ?? ""}`;
}

export function ThreeDDoorLayer({
	resources,
	isWorld,
	terrain,
	terrainIndex,
	doors,
	terrainNamesById,
	controlledActor,
	isDM,
	onTraverse,
	onFocusChange,
}: ThreeDDoorLayerProps) {
	// Live values read by the long-lived input effect without re-subscribing.
	const controlledActorRef = useRef(controlledActor);
	const terrainNamesRef = useRef(terrainNamesById);
	const isDMRef = useRef(isDM);
	const onTraverseRef = useRef(onTraverse);
	const onFocusChangeRef = useRef(onFocusChange);
	const boxesRef = useRef<THREE.Mesh[]>([]);

	useEffect(() => {
		controlledActorRef.current = controlledActor;
		terrainNamesRef.current = terrainNamesById;
		isDMRef.current = isDM;
		onTraverseRef.current = onTraverse;
		onFocusChangeRef.current = onFocusChange;
	}, [controlledActor, terrainNamesById, isDM, onTraverse, onFocusChange]);

	// --- Build the invisible hitboxes for doors on this terrain. ---
	const anchorSignature = doorAnchorsSignature(doors, terrain.Id);
	useEffect(() => {
		const anchors = getDoorAnchorsOnTerrain(doors, terrain.Id);
		const group = new THREE.Group();
		const boxes: THREE.Mesh[] = [];

		const offsetX = (terrain.Width - 1) / 2;
		const offsetZ = (terrain.Length - 1) / 2;
		const geometry = new THREE.BoxGeometry(
			DOOR_BOX_FOOTPRINT,
			DOOR_BOX_HEIGHT,
			DOOR_BOX_FOOTPRINT
		);

		for (const { door, anchor, destination } of anchors) {
			// Invisible but raycastable: no color/depth write, fully transparent.
			const material = new THREE.MeshBasicMaterial({
				transparent: true,
				opacity: 0,
				depthWrite: false,
				colorWrite: false,
			});
			const box = new THREE.Mesh(geometry, material);
			box.position.set(
				anchor.x - offsetX,
				terrainHeightToWorldY(anchor.h) + DOOR_BOX_HEIGHT / 2,
				anchor.y - offsetZ
			);
			const data: DoorBoxData = {
				doorId: door.Id,
				anchor,
				destination,
				locked: door.Locked,
			};
			box.userData = data;
			group.add(box);
			boxes.push(box);
			resources.doorPickTargets.push(box);
		}

		resources.scene.add(group);
		boxesRef.current = boxes;

		return () => {
			resources.scene.remove(group);
			for (const box of boxes) {
				const index = resources.doorPickTargets.indexOf(box);
				if (index !== -1) resources.doorPickTargets.splice(index, 1);
				(box.material as THREE.Material).dispose();
			}
			geometry.dispose();
			group.clear();
			boxesRef.current = [];
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [resources, terrain, anchorSignature]);

	// --- Interaction (world: pointer; first person: center-screen + E key). ---
	useEffect(() => {
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();

		const buildFocus = (
			box: THREE.Mesh,
			screen: { x: number; y: number } | null
		): DoorInteractionFocus => {
			const data = box.userData as DoorBoxData;
			const actor = controlledActorRef.current;
			const revealable = !data.locked || isDMRef.current;
			const destinationName = revealable
				? terrainNamesRef.current.get(data.destination.terrainId) ?? "another area"
				: null;

			let usable = false;
			if (
				actor &&
				actor.position.terrainId === terrain.Id &&
				(!data.locked || isDMRef.current)
			) {
				const dist = Math.hypot(
					actor.position.x - data.anchor.x,
					actor.position.y - data.anchor.y
				);
				if (dist <= DOOR_INTERACT_DISTANCE) {
					usable = true;
				}
			}

			return {
				doorId: data.doorId,
				destinationName,
				locked: data.locked,
				usable,
				screen,
			};
		};

		// The closest non-occluded door hitbox under the current ray, or null.
		const pickDoor = (): THREE.Mesh | null => {
			const hits = raycaster.intersectObjects(boxesRef.current, false);
			if (hits.length === 0) return null;
			const hit = hits[0];
			// A door buried behind/under terrain (closer terrain hit) reads as hidden.
			const terrainHit = raycastTerrainDDA(raycaster.ray, terrainIndex);
			if (terrainHit && terrainHit.distance + OCCLUSION_EPSILON < hit.distance) {
				return null;
			}
			return hit.object as THREE.Mesh;
		};

		const traverse = (box: THREE.Mesh) => {
			const actor = controlledActorRef.current;
			if (!actor) return;
			const data = box.userData as DoorBoxData;
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

		const lastFocusRef = { current: null as DoorInteractionFocus | null };
		const emitFocus = (focus: DoorInteractionFocus | null) => {
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
				const box = pickDoor();
				emitFocus(
					box
						? buildFocus(box, { x: event.clientX, y: event.clientY })
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
				if (!pickDoor()) {
					pendingClick = null;
					return;
				}
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
				const box = pickDoor();
				if (!box) return;
				const focus = buildFocus(box, null);
				if (!focus.usable) return;
				// Consume so the movement layer's window pointerup doesn't also act.
				event.stopPropagation();
				event.stopImmediatePropagation();
				traverse(box);
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
				emitFocus(null);
			};
		}

		// ----- First person: proximity targeting + E to go through -----
		// There is no crosshair to aim with, so the prompt tracks the NEAREST
		// usable door (in range + line of sight + unlocked) to the controlled
		// actor rather than whatever the camera happens to point at.
		const fpTargetRef = { current: null as THREE.Mesh | null };

		const tick = () => {
			const actor = controlledActorRef.current;
			if (!actor) {
				fpTargetRef.current = null;
				emitFocus(null);
				return;
			}
			let bestBox: THREE.Mesh | null = null;
			let bestFocus: DoorInteractionFocus | null = null;
			let bestDistance = Infinity;
			for (const box of boxesRef.current) {
				const focus = buildFocus(box, null);
				if (!focus.usable) continue;
				const data = box.userData as DoorBoxData;
				const distance = Math.hypot(
					actor.position.x - data.anchor.x,
					actor.position.y - data.anchor.y
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
			if (event.code !== "KeyE" || event.repeat) return;
			const box = fpTargetRef.current;
			if (!box) return;
			const focus = buildFocus(box, null);
			if (!focus.usable) return;
			event.preventDefault();
			traverse(box);
		};

		resources.animationCallbacks.add(tick);
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			resources.animationCallbacks.delete(tick);
			window.removeEventListener("keydown", handleKeyDown);
			emitFocus(null);
		};
	}, [resources, isWorld, terrain, terrainIndex]);

	return null;
}
