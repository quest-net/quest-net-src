import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Character } from "../../../domains/Character/Character";
import type { Entity } from "../../../domains/Entity/Entity";
import { isItemEntity } from "../../../domains/Item/ItemDropUtils";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import type { VoxelTerrainIndex } from "../../../utils/terrain/data/VoxelTerrainIndex";
import {
	canOccupyVoxelTile,
	getVoxelTileHeightKey,
	type VoxelMovementTile,
} from "../../../utils/terrain/movement/VoxelMovementUtilities";
import type { HoveredTile, SelectedActor } from "../MapStateProvider";
import { THREE_D_MOVEMENT_HIGHLIGHT } from "../threeDMapConstants";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	raycastTerrainDDA,
	terrainDDAHitToVoxelTile,
} from "./movement3DHelpers";

// Tolerance for "actor is in front of terrain" comparisons. Pick meshes are
// transparent and disable depth testing, so we rely on raycaster distance.
const ACTOR_OCCLUSION_EPSILON = 0.001;

// Pointer movement (in CSS pixels) above which a press+release is treated
// as a camera drag rather than a tile click. Without this guard, OrbitControls
// rotating the camera with left-button drag would also commit a tile move
// when the user released, teleporting the selected actor.
const CLICK_DRAG_THRESHOLD_PX = 5;
const VIRTUAL_GROUND_WORLD_Y = -0.5;

interface VirtualGroundHighlightTile {
	x: number;
	y: number;
}

interface ThreeDMovementLayerProps {
	resources: ThreeDSceneResources;
	terrain: VoxelTerrain;
	terrainIndex: VoxelTerrainIndex;
	characters: Character[];
	entities: Entity[];
	selectedActor: SelectedActor | null;
	selectedActorObject: Character | Entity | null;
	canControlSelected: boolean;
	movementRange: VoxelMovementTile[];
	remainingMovementRange: VoxelMovementTile[] | null;
	hoveredTile: HoveredTile | null;
	restrictMovementToRange: boolean;
	preserveFlyingHeightOnTileMove: boolean;
	isCombatActive: boolean;
	onHoveredTileChange: (tile: HoveredTile | null) => void;
	onMoveSelectedActor: (position: { x: number; y: number; h: number }) => void;
}

// Keyed by (x,y,h) so multiple surfaces in the same column are independent.
function toTileMap(tiles: VoxelMovementTile[]): Map<string, VoxelMovementTile> {
	const map = new Map<string, VoxelMovementTile>();
	for (const tile of tiles) {
		map.set(getVoxelTileHeightKey(tile.x, tile.y, tile.h), tile);
	}
	return map;
}

function getTileFromPointerEvent(
	event: PointerEvent,
	resources: ThreeDSceneResources,
	terrain: VoxelTerrain,
	terrainIndex: VoxelTerrainIndex,
	raycaster: THREE.Raycaster,
	pointer: THREE.Vector2,
	allowVirtualGroundTile: boolean
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

	const terrainHit = raycastTerrainDDA(raycaster.ray, terrainIndex);

	if (
		terrainHit &&
		closestActorDistance + ACTOR_OCCLUSION_EPSILON < terrainHit.distance
	) {
		return null;
	}

	if (terrainHit) {
		return terrainDDAHitToVoxelTile(terrainHit);
	}

	if (!allowVirtualGroundTile) return null;

	const groundPoint = new THREE.Vector3();
	const groundPlane = new THREE.Plane(
		new THREE.Vector3(0, 1, 0),
		-VIRTUAL_GROUND_WORLD_Y
	);
	if (!raycaster.ray.intersectPlane(groundPlane, groundPoint)) return null;
	if (closestActorDistance + ACTOR_OCCLUSION_EPSILON < groundPoint.distanceTo(raycaster.ray.origin)) {
		return null;
	}

	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const x = Math.round(groundPoint.x + offsetX);
	const y = Math.round(groundPoint.z + offsetZ);
	if (x < 0 || x >= terrain.Width || y < 0 || y >= terrain.Length) {
		return null;
	}
	if (terrainIndex.allSurfaces.get(`${x},${y}`)?.includes(0)) {
		return null;
	}

	return { x, y, h: 0 };
}

function resolveMoveTargetHeight(
	tile: HoveredTile,
	actorObject: Character | Entity,
	terrainIndex: VoxelTerrainIndex,
	preserveFlyingHeightOnTileMove: boolean
): number {
	if (!preserveFlyingHeightOnTileMove || !actorObject.CanFly) {
		return tile.h;
	}

	const originH = Math.round(actorObject.Position.h);
	const surfaces =
		terrainIndex.allSurfaces.get(`${tile.x},${tile.y}`) ??
		[];
	const hasTerrainAtOrAboveOrigin = surfaces.some((surfaceH) => surfaceH >= originH);

	return hasTerrainAtOrAboveOrigin ? tile.h : originH;
}

function isVirtualGroundHighlightTile(
	tile: Pick<HoveredTile, "x" | "y" | "h">,
	terrainIndex: VoxelTerrainIndex
): boolean {
	if (tile.h !== 0) return false;
	return !(
		terrainIndex.allSurfaces.get(`${tile.x},${tile.y}`) ??
		[]
	).includes(0);
}

function createVirtualGroundHighlightMesh(
	tiles: VirtualGroundHighlightTile[],
	terrain: VoxelTerrain,
	color: number,
	opacity: number,
	renderOrder: number
): THREE.InstancedMesh | null {
	if (tiles.length === 0) return null;

	const geometry = new THREE.PlaneGeometry(
		THREE_D_MOVEMENT_HIGHLIGHT.TILE_SIZE,
		THREE_D_MOVEMENT_HIGHLIGHT.TILE_SIZE
	);
	geometry.rotateX(-Math.PI / 2);
	const material = new THREE.MeshBasicMaterial({
		color,
		transparent: true,
		opacity,
		depthWrite: false,
		side: THREE.DoubleSide,
	});
	const mesh = new THREE.InstancedMesh(geometry, material, tiles.length);
	const matrix = new THREE.Matrix4();
	const offsetX = (terrain.Width - 1) / 2;
	const offsetZ = (terrain.Length - 1) / 2;
	const y = VIRTUAL_GROUND_WORLD_Y + THREE_D_MOVEMENT_HIGHLIGHT.Y_OFFSET;

	for (let index = 0; index < tiles.length; index++) {
		const tile = tiles[index];
		matrix.makeTranslation(tile.x - offsetX, y, tile.y - offsetZ);
		mesh.setMatrixAt(index, matrix);
	}

	mesh.renderOrder = renderOrder;
	mesh.instanceMatrix.needsUpdate = true;
	return mesh;
}

export function ThreeDMovementLayer({
	resources,
	terrain,
	terrainIndex,
	characters,
	entities,
	selectedActor,
	selectedActorObject,
	canControlSelected,
	movementRange,
	remainingMovementRange,
	hoveredTile,
	restrictMovementToRange,
	preserveFlyingHeightOnTileMove,
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
	const preserveFlyingHeightOnTileMoveRef = useRef(
		preserveFlyingHeightOnTileMove
	);
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
		preserveFlyingHeightOnTileMoveRef.current = preserveFlyingHeightOnTileMove;
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
		preserveFlyingHeightOnTileMove,
		isCombatActive,
		characters,
		entities,
		onHoveredTileChange,
		onMoveSelectedActor,
	]);

	useEffect(() => {
		const { data, texture, width, heightLevels, length } = resources.movementHighlight;

		// Write a single RGBA pixel into the 3D highlight texture at (tileX, h, tileZ).
		// Layout: data[(tileZ * heightLevels * width + h * width + tileX) * 4]
		const setTileHighlight = (
			tileX: number,
			h: number,
			tileZ: number,
			color: number,
			opacity: number
		) => {
			if (
				tileX < 0 || tileZ < 0 ||
				tileX >= width || tileZ >= length ||
				h < 0 || h >= heightLevels
			) return;
			const index = (tileZ * heightLevels * width + h * width + tileX) * 4;
			data[index]     = (color >> 16) & 0xff;
			data[index + 1] = (color >> 8)  & 0xff;
			data[index + 2] = color & 0xff;
			data[index + 3] = Math.round(
				THREE.MathUtils.clamp(opacity, 0, 1) * 255
			);
		};

		data.fill(0);

		for (const tile of movementRange) {
			setTileHighlight(
				tile.x,
				tile.h,
				tile.y,
				THREE_D_MOVEMENT_HIGHLIGHT.FULL_RANGE_COLOR,
				THREE_D_MOVEMENT_HIGHLIGHT.FULL_RANGE_OPACITY
			);
		}

		if (remainingMovementRange) {
			for (const tile of remainingMovementRange) {
				setTileHighlight(
					tile.x,
					tile.h,
					tile.y,
					THREE_D_MOVEMENT_HIGHLIGHT.REMAINING_RANGE_COLOR,
					THREE_D_MOVEMENT_HIGHLIGHT.REMAINING_RANGE_OPACITY
				);
			}
		}

		if (hoveredTile) {
			setTileHighlight(
				hoveredTile.x,
				hoveredTile.h,
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
		if (!selectedActorObject?.CanFly) return;

		const fullRangeTiles: VirtualGroundHighlightTile[] = [];
		const remainingRangeTiles: VirtualGroundHighlightTile[] = [];
		const hoverTiles: VirtualGroundHighlightTile[] = [];
		const addUnique = (
			tiles: VirtualGroundHighlightTile[],
			seen: Set<string>,
			tile: Pick<HoveredTile, "x" | "y" | "h">
		) => {
			if (!isVirtualGroundHighlightTile(tile, terrainIndex)) return;
			const key = `${tile.x},${tile.y}`;
			if (seen.has(key)) return;
			seen.add(key);
			tiles.push({ x: tile.x, y: tile.y });
		};

		const fullSeen = new Set<string>();
		for (const tile of movementRange) {
			addUnique(fullRangeTiles, fullSeen, tile);
		}

		const remainingSeen = new Set<string>();
		if (remainingMovementRange) {
			for (const tile of remainingMovementRange) {
				addUnique(remainingRangeTiles, remainingSeen, tile);
			}
		}

		if (hoveredTile) {
			addUnique(hoverTiles, new Set<string>(), hoveredTile);
		}

		const group = new THREE.Group();
		const fullMesh = createVirtualGroundHighlightMesh(
			fullRangeTiles,
			terrain,
			THREE_D_MOVEMENT_HIGHLIGHT.FULL_RANGE_COLOR,
			THREE_D_MOVEMENT_HIGHLIGHT.FULL_RANGE_OPACITY,
			THREE_D_MOVEMENT_HIGHLIGHT.RENDER_ORDER
		);
		const remainingMesh = createVirtualGroundHighlightMesh(
			remainingRangeTiles,
			terrain,
			THREE_D_MOVEMENT_HIGHLIGHT.REMAINING_RANGE_COLOR,
			THREE_D_MOVEMENT_HIGHLIGHT.REMAINING_RANGE_OPACITY,
			THREE_D_MOVEMENT_HIGHLIGHT.RENDER_ORDER + 1
		);
		const hoverMesh = createVirtualGroundHighlightMesh(
			hoverTiles,
			terrain,
			THREE_D_MOVEMENT_HIGHLIGHT.HOVER_COLOR,
			THREE_D_MOVEMENT_HIGHLIGHT.HOVER_OPACITY,
			THREE_D_MOVEMENT_HIGHLIGHT.HOVER_RENDER_ORDER
		);

		if (fullMesh) group.add(fullMesh);
		if (remainingMesh) group.add(remainingMesh);
		if (hoverMesh) group.add(hoverMesh);
		if (group.children.length === 0) return;

		resources.scene.add(group);

		return () => {
			resources.scene.remove(group);
			for (const child of group.children) {
				if (!(child instanceof THREE.InstancedMesh)) continue;
				child.geometry.dispose();
				if (Array.isArray(child.material)) {
					child.material.forEach((material) => material.dispose());
				} else {
					child.material.dispose();
				}
			}
			group.clear();
		};
	}, [
		resources,
		terrain,
		terrainIndex,
		movementRange,
		remainingMovementRange,
		hoveredTile,
		selectedActorObject?.CanFly,
	]);

	useEffect(() => {
		const raycaster = new THREE.Raycaster();
		const pointer = new THREE.Vector2();

		// Look up the movement tile at the exact (x, y, h) position.
		const getAllowedTile = (tile: HoveredTile): VoxelMovementTile | null => {
			const key = getVoxelTileHeightKey(tile.x, tile.y, tile.h);
			if (!restrictMovementToRangeRef.current) {
				return (
					remainingRangeMapRef.current?.get(key) ??
					movementRangeMapRef.current.get(key) ??
					null
				);
			}

			const allowedMap = isCombatActiveRef.current
				? remainingRangeMapRef.current
				: movementRangeMapRef.current;
			return allowedMap?.get(key) ?? null;
		};

		const getValidHoverTile = (event: PointerEvent): HoveredTile | null => {
			const actor = selectedActorRef.current;
			const actorObject = selectedActorObjectRef.current;
			if (!actor || !actorObject || !canControlSelectedRef.current) return null;

			const tile = getTileFromPointerEvent(
				event,
				resources,
				terrain,
				terrainIndex,
				raycaster,
				pointer,
				actorObject.CanFly ?? false
			);
			if (!tile) return null;

			const targetHeight = resolveMoveTargetHeight(
				tile,
				actorObject,
				terrainIndex,
				preserveFlyingHeightOnTileMoveRef.current
			);
			const targetTile = { ...tile, h: targetHeight };
			const allowedTile = getAllowedTile(targetTile);
			if (restrictMovementToRangeRef.current && !allowedTile) return null;

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
				currentHover?.y === nextHover?.y &&
				currentHover?.h === nextHover?.h
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

			const targetHeight = resolveMoveTargetHeight(
				tile,
				actorObject,
				terrainIndex,
				preserveFlyingHeightOnTileMoveRef.current
			);
			const targetTile = { ...tile, h: targetHeight };
			const allowedTile = getAllowedTile(targetTile);
			if (restrictMovementToRangeRef.current && !allowedTile) return;

			if (
				!isItemEntity(actorObject) &&
				!canOccupyVoxelTile(
					terrain,
					{ x: targetTile.x, y: targetTile.y, h: targetHeight },
					charactersRef.current,
					entitiesRef.current,
					actor.id
				)
			) {
				return;
			}

			onMoveSelectedActorRef.current({
				x: targetTile.x,
				y: targetTile.y,
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
	}, [resources, terrain, terrainIndex]);

	return null;
}
