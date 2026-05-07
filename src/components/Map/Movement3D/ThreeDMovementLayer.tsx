import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import { isItemEntity } from "../../../domains/Item/ItemDropUtils";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	calculateVoxelTargetHeight,
	canOccupyVoxelTile,
	getVoxelTileKey,
	type VoxelMovementTile,
} from "../../../utils/VoxelMovementUtilities";
import type { HoveredTile, SelectedActor } from "../MapStateProvider";
import { THREE_D_MOVEMENT_HIGHLIGHT } from "../threeDMapConstants";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	getHitWorldNormal,
	intersectFirstTerrainHit,
	worldPointToVoxelTile,
} from "./movement3DHelpers";

// Tolerance for "actor is in front of terrain" comparisons. Pick meshes are
// transparent and disable depth testing, so we rely on raycaster distance.
const ACTOR_OCCLUSION_EPSILON = 0.001;

// Pointer movement (in CSS pixels) above which a press+release is treated
// as a camera drag rather than a tile click. Without this guard, OrbitControls
// rotating the camera with left-button drag would also commit a tile move
// when the user released, teleporting the selected actor.
const CLICK_DRAG_THRESHOLD_PX = 5;

interface ThreeDMovementLayerProps {
	resources: ThreeDSceneResources;
	terrain: VoxelTerrain;
	characters: Character[];
	entities: Entity[];
	selectedActor: SelectedActor | null;
	selectedActorObject: Character | Entity | null;
	canControlSelected: boolean;
	movementRange: VoxelMovementTile[];
	remainingMovementRange: VoxelMovementTile[] | null;
	hoveredTile: HoveredTile | null;
	restrictMovementToRange: boolean;
	isCombatActive: boolean;
	onHoveredTileChange: (tile: HoveredTile | null) => void;
	onMoveSelectedActor: (position: { x: number; y: number; h: number }) => void;
}

function toTileMap(tiles: VoxelMovementTile[]): Map<string, VoxelMovementTile> {
	const map = new Map<string, VoxelMovementTile>();
	for (const tile of tiles) {
		map.set(getVoxelTileKey(tile.x, tile.y), tile);
	}
	return map;
}

function getTileFromPointerEvent(
	event: PointerEvent,
	resources: ThreeDSceneResources,
	terrain: VoxelTerrain,
	raycaster: THREE.Raycaster,
	pointer: THREE.Vector2
): HoveredTile | null {
	const rect = resources.domElement.getBoundingClientRect();
	pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

	raycaster.setFromCamera(pointer, resources.camera);

	// Suppress the tile pick if the cursor is on top of an actor. The
	// actor pick mesh is closer to the camera than the terrain it's
	// standing on, so its hit distance wins. This stops tiles from
	// highlighting "behind" an actor token, making it clear that
	// clicking will interact with the actor, not the tile.
	const actorHits = raycaster.intersectObjects(
		resources.actorPickTargets,
		true
	);
	const closestActorDistance = actorHits[0]?.distance ?? Infinity;

	const terrainHit = intersectFirstTerrainHit(raycaster, resources.occlusionTargets);
	if (!terrainHit) return null;

	if (closestActorDistance + ACTOR_OCCLUSION_EPSILON < terrainHit.distance) {
		return null;
	}

	const worldNormal = getHitWorldNormal(terrainHit);
	return worldPointToVoxelTile(terrain, terrainHit.point, worldNormal);
}

export function ThreeDMovementLayer({
	resources,
	terrain,
	characters,
	entities,
	selectedActor,
	selectedActorObject,
	canControlSelected,
	movementRange,
	remainingMovementRange,
	hoveredTile,
	restrictMovementToRange,
	isCombatActive,
	onHoveredTileChange,
	onMoveSelectedActor,
}: ThreeDMovementLayerProps) {
	const movementRangeMap = useMemo(
		() => toTileMap(movementRange),
		[movementRange]
	);
	const remainingRangeMap = useMemo(
		() => (remainingMovementRange ? toTileMap(remainingMovementRange) : null),
		[remainingMovementRange]
	);

	const movementRangeMapRef = useRef(movementRangeMap);
	const remainingRangeMapRef = useRef(remainingRangeMap);
	const hoveredTileRef = useRef(hoveredTile);
	const selectedActorRef = useRef(selectedActor);
	const selectedActorObjectRef = useRef(selectedActorObject);
	const canControlSelectedRef = useRef(canControlSelected);
	const restrictMovementToRangeRef = useRef(restrictMovementToRange);
	const isCombatActiveRef = useRef(isCombatActive);
	const charactersRef = useRef(characters);
	const entitiesRef = useRef(entities);
	const onHoveredTileChangeRef = useRef(onHoveredTileChange);
	const onMoveSelectedActorRef = useRef(onMoveSelectedActor);

	useEffect(() => {
		movementRangeMapRef.current = movementRangeMap;
		remainingRangeMapRef.current = remainingRangeMap;
		hoveredTileRef.current = hoveredTile;
		selectedActorRef.current = selectedActor;
		selectedActorObjectRef.current = selectedActorObject;
		canControlSelectedRef.current = canControlSelected;
		restrictMovementToRangeRef.current = restrictMovementToRange;
		isCombatActiveRef.current = isCombatActive;
		charactersRef.current = characters;
		entitiesRef.current = entities;
		onHoveredTileChangeRef.current = onHoveredTileChange;
		onMoveSelectedActorRef.current = onMoveSelectedActor;
	}, [
		movementRangeMap,
		remainingRangeMap,
		hoveredTile,
		selectedActor,
		selectedActorObject,
		canControlSelected,
		restrictMovementToRange,
		isCombatActive,
		characters,
		entities,
		onHoveredTileChange,
		onMoveSelectedActor,
	]);

	useEffect(() => {
		const { data, texture, width, length } = resources.movementHighlight;

		const setTileHighlight = (
			x: number,
			y: number,
			color: number,
			opacity: number
		) => {
			if (x < 0 || y < 0 || x >= width || y >= length) return;
			const index = (y * width + x) * 4;
			data[index] = (color >> 16) & 0xff;
			data[index + 1] = (color >> 8) & 0xff;
			data[index + 2] = color & 0xff;
			data[index + 3] = Math.round(
				THREE.MathUtils.clamp(opacity, 0, 1) * 255
			);
		};

		data.fill(0);

		for (const tile of movementRange) {
			setTileHighlight(
				tile.x,
				tile.y,
				THREE_D_MOVEMENT_HIGHLIGHT.FULL_RANGE_COLOR,
				THREE_D_MOVEMENT_HIGHLIGHT.FULL_RANGE_OPACITY
			);
		}

		if (remainingMovementRange) {
			for (const tile of remainingMovementRange) {
				setTileHighlight(
					tile.x,
					tile.y,
					THREE_D_MOVEMENT_HIGHLIGHT.REMAINING_RANGE_COLOR,
					THREE_D_MOVEMENT_HIGHLIGHT.REMAINING_RANGE_OPACITY
				);
			}
		}

		if (hoveredTile) {
			setTileHighlight(
				hoveredTile.x,
				hoveredTile.y,
				THREE_D_MOVEMENT_HIGHLIGHT.HOVER_COLOR,
				THREE_D_MOVEMENT_HIGHLIGHT.HOVER_OPACITY
			);
		}

		texture.needsUpdate = true;

		return () => {
			data.fill(0);
			texture.needsUpdate = true;
		};
	}, [resources, movementRange, remainingMovementRange, hoveredTile]);

	useEffect(() => {
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();

		const getAllowedTile = (tile: HoveredTile): VoxelMovementTile | null => {
			if (!restrictMovementToRangeRef.current) {
				return (
					remainingRangeMapRef.current?.get(getVoxelTileKey(tile.x, tile.y)) ??
					movementRangeMapRef.current.get(getVoxelTileKey(tile.x, tile.y)) ??
					null
				);
			}

			const allowedMap = isCombatActiveRef.current
				? remainingRangeMapRef.current
				: movementRangeMapRef.current;
			return allowedMap?.get(getVoxelTileKey(tile.x, tile.y)) ?? null;
		};

		const getValidHoverTile = (event: PointerEvent): HoveredTile | null => {
			const actor = selectedActorRef.current;
			const actorObject = selectedActorObjectRef.current;
			if (!actor || !actorObject || !canControlSelectedRef.current) return null;

			const tile = getTileFromPointerEvent(
				event,
				resources,
				terrain,
				raycaster,
				pointer
			);
			if (!tile) return null;

			const allowedTile = getAllowedTile(tile);
			if (restrictMovementToRangeRef.current && !allowedTile) return null;

			const targetHeight = allowedTile?.h ?? calculateVoxelTargetHeight(
				terrain,
				tile.x,
				tile.y,
				actorObject.Position.h,
				actorObject.CanFly ?? false
			);

			const canOccupy =
				isItemEntity(actorObject) ||
				canOccupyVoxelTile(
					terrain,
					{ x: tile.x, y: tile.y, h: targetHeight },
					charactersRef.current,
					entitiesRef.current,
					actor.id
				);

			return canOccupy ? tile : null;
		};

		let pendingPointerMove: PointerEvent | null = null;
		let pointerMoveRafId = 0;

		const processPointerMove = () => {
			pointerMoveRafId = 0;
			const event = pendingPointerMove;
			pendingPointerMove = null;
			if (!event) return;

			if (resources.dragState.active) {
				hoveredTileRef.current = null;
				onHoveredTileChangeRef.current(null);
				resources.domElement.style.cursor = "grabbing";
				return;
			}

			const nextHover = getValidHoverTile(event);
			const currentHover = hoveredTileRef.current;
			if (
				currentHover?.x === nextHover?.x &&
				currentHover?.y === nextHover?.y
			) {
				return;
			}
			hoveredTileRef.current = nextHover;
			onHoveredTileChangeRef.current(nextHover);
			resources.domElement.style.cursor = nextHover ? "pointer" : "";
		};

		const handlePointerMove = (event: PointerEvent) => {
			pendingPointerMove = event;
			if (pointerMoveRafId !== 0) return;
			pointerMoveRafId = requestAnimationFrame(processPointerMove);
		};

		const handlePointerLeave = () => {
			pendingPointerMove = null;
			if (pointerMoveRafId !== 0) {
				cancelAnimationFrame(pointerMoveRafId);
				pointerMoveRafId = 0;
			}
			hoveredTileRef.current = null;
			onHoveredTileChangeRef.current(null);
			resources.domElement.style.cursor = "";
		};

		// Pending click state captured at pointerdown. Commit only if the
		// pointer hasn't traveled past CLICK_DRAG_THRESHOLD_PX by pointerup --
		// otherwise it's a camera-rotate drag (OrbitControls handles it) and
		// we leave the selected actor where they are.
		let pendingClick: {
			pointerId: number;
			startX: number;
			startY: number;
			startedAtTile: HoveredTile | null;
		} | null = null;

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
			if (resources.dragState.active) {
				pendingClick = null;
				return;
			}
			const actor = selectedActorRef.current;
			const actorObject = selectedActorObjectRef.current;
			if (!actor || !actorObject || !canControlSelectedRef.current) {
				pendingClick = null;
				return;
			}
			pendingClick = {
				pointerId: event.pointerId,
				startX: event.clientX,
				startY: event.clientY,
				startedAtTile: hoveredTileRef.current ?? getValidHoverTile(event),
			};
		};

		const handlePointerUp = (event: PointerEvent) => {
			if (event.button !== 0) return;
			if (resources.dragState.active) {
				pendingClick = null;
				return;
			}
			const click = pendingClick;
			pendingClick = null;
			if (!click || click.pointerId !== event.pointerId) return;

			const dx = event.clientX - click.startX;
			const dy = event.clientY - click.startY;
			if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) {
				// Treated as a camera drag, not a click. Don't move the actor.
				return;
			}

			const actor = selectedActorRef.current;
			const actorObject = selectedActorObjectRef.current;
			if (!actor || !actorObject || !canControlSelectedRef.current) return;

			// Re-evaluate the tile under the cursor at release time. The
			// pointerdown's tile is a fallback if the cursor has since
			// drifted off the terrain (still within threshold).
			const tile =
				getValidHoverTile(event) ??
				click.startedAtTile ??
				hoveredTileRef.current;
			if (!tile) return;

			const allowedTile = getAllowedTile(tile);
			if (restrictMovementToRangeRef.current && !allowedTile) return;

			const targetHeight =
				allowedTile?.h ??
				calculateVoxelTargetHeight(
					terrain,
					tile.x,
					tile.y,
					actorObject.Position.h,
					actorObject.CanFly ?? false
				);

			if (
				!isItemEntity(actorObject) &&
				!canOccupyVoxelTile(
					terrain,
					{ x: tile.x, y: tile.y, h: targetHeight },
					charactersRef.current,
					entitiesRef.current,
					actor.id
				)
			) {
				return;
			}

			onMoveSelectedActorRef.current({
				x: tile.x,
				y: tile.y,
				h: targetHeight,
			});
		};

		const handlePointerCancel = (event: PointerEvent) => {
			if (pendingClick && pendingClick.pointerId === event.pointerId) {
				pendingClick = null;
			}
		};

		resources.domElement.addEventListener("pointermove", handlePointerMove);
		resources.domElement.addEventListener("pointerleave", handlePointerLeave);
		resources.domElement.addEventListener("pointerdown", handlePointerDown, true);
		// Listen on window so a drag that ends off-canvas still resets the
		// pending-click state (and obviously doesn't commit a move).
		window.addEventListener("pointerup", handlePointerUp, true);
		window.addEventListener("pointercancel", handlePointerCancel, true);

		return () => {
			resources.domElement.removeEventListener("pointermove", handlePointerMove);
			resources.domElement.removeEventListener("pointerleave", handlePointerLeave);
			resources.domElement.removeEventListener("pointerdown", handlePointerDown, true);
			window.removeEventListener("pointerup", handlePointerUp, true);
			window.removeEventListener("pointercancel", handlePointerCancel, true);
			if (pointerMoveRafId !== 0) {
				cancelAnimationFrame(pointerMoveRafId);
			}
			resources.domElement.style.cursor = "";
		};
	}, [resources, terrain]);

	return null;
}
