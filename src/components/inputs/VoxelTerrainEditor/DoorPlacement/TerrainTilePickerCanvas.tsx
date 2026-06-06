// components/inputs/VoxelTerrainEditor/DoorPlacement/TerrainTilePickerCanvas.tsx
//
// A self-contained, read-only voxel terrain renderer used by the door-placement
// flow to pick a single tactical tile on a terrain. It reuses the editor's scene
// (createEditorScene) + picker (createPicker) but does NO editing: it renders the
// given terrain, shows a transparent door-sized ghost (1 tile wide/deep, 2 tactical
// units tall) at the hovered tile, and reports the chosen tile via onPick.
//
// Kept deliberately separate from the main VoxelTerrainEditor so the door flow
// never touches the editor's brush/undo/selection pipeline.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { EditableVoxelTerrain } from "../../../../domains/VoxelTerrain/VoxelTerrain";
import type { DoorAnchor } from "../../../../domains/Door/Door";
import {
	getVoxelTerrainIndex,
	getVoxelTerrainResolution,
} from "../../../../utils/terrain/data/VoxelTerrainIndex";
import { buildEditGrid, createEditGrid, type EditGrid } from "../../../../utils/terrain/editor/EditGridUtils";
import {
	computeChunkDims,
	markAllChunksDirty,
	unpackChunkIndex,
	type ChunkDims,
} from "../../../../utils/terrain/editor/EditGridChunkUtils";
import type { PickInfo } from "../../../../utils/terrain/editor/VoxelBrushUtils";
import { terrainHeightToWorldY } from "../../../Map/Actors3D/actorTokenPlacement";
import {
	createEditorScene,
	clearObjectGroup,
	frameOrthoCamera,
	resizeRenderer,
	type EditorSceneResources,
} from "../editorScene";
import { clearAllChunkMeshes, rebuildChunk } from "../editorChunkMeshes";
import { createPicker } from "../editorPicking";

const CLICK_DRAG_THRESHOLD_PX = 5;
const DOOR_GHOST_HEIGHT = 2;

/**
 * Converts a voxel pick into a tactical door anchor on `terrainId`. The tile is
 * the tactical column under the pick; the height snaps to the nearest standing
 * surface in that column (or 0 for an empty column / ground pick).
 */
function pickToDoorAnchor(
	pick: PickInfo,
	terrainId: string,
	surfaces: ReadonlyMap<string, readonly number[]>,
	resolution: number
): DoorAnchor {
	const x = Math.floor(pick.voxel.x / resolution);
	const y = Math.floor(pick.voxel.z / resolution);
	const pickedTactical = pick.ground
		? 0
		: Math.floor((pick.voxel.y + (pick.normal.y > 0 ? 1 : 0)) / resolution);

	const columnSurfaces = surfaces.get(`${x},${y}`) ?? [];
	let h = pick.ground ? 0 : pickedTactical;
	if (columnSurfaces.length > 0) {
		let best = columnSurfaces[0];
		let bestDist = Math.abs(best - pickedTactical);
		for (const surface of columnSurfaces) {
			const dist = Math.abs(surface - pickedTactical);
			if (dist < bestDist) {
				best = surface;
				bestDist = dist;
			}
		}
		h = best;
	}

	return { terrainId, x, y, h };
}

interface TerrainTilePickerCanvasProps {
	terrain: EditableVoxelTerrain;
	onPick: (anchor: DoorAnchor) => void;
	/** Existing door anchors on this terrain, drawn as static transparent boxes
	 *  so the DM can see where doors already are while placing a new one. */
	existingAnchors?: DoorAnchor[];
}

export function TerrainTilePickerCanvas({
	terrain,
	onPick,
	existingAnchors,
}: TerrainTilePickerCanvasProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const onPickRef = useRef(onPick);
	useEffect(() => {
		onPickRef.current = onPick;
	}, [onPick]);

	// Refs the picker reads through. Updated by the terrain effect below.
	const resourcesRef = useRef<EditorSceneResources | null>(null);
	const dimsRef = useRef<ChunkDims | null>(null);
	const editGridRef = useRef<EditGrid>(createEditGrid(0));
	const terrainRef = useRef<EditableVoxelTerrain>(terrain);
	const chunkMeshesRef = useRef<Map<number, THREE.Mesh | null>>(new Map());
	const ghostRef = useRef<THREE.Mesh | null>(null);
	const currentAnchorRef = useRef<DoorAnchor | null>(null);
	const existingDoorsGroupRef = useRef<THREE.Group | null>(null);

	// --- Mount the scene once. ---
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const resources = createEditorScene(container, true);
		resourcesRef.current = resources;

		// Transparent door-sized ghost.
		const ghostGeometry = new THREE.BoxGeometry(1, DOOR_GHOST_HEIGHT, 1);
		const ghostMaterial = new THREE.MeshBasicMaterial({
			color: 0x60a5fa,
			transparent: true,
			opacity: 0.35,
			depthWrite: false,
		});
		const ghost = new THREE.Mesh(ghostGeometry, ghostMaterial);
		ghost.visible = false;
		resources.hoverGroup.add(ghost);
		ghostRef.current = ghost;

		const picker = createPicker({
			resourcesRef,
			dimsRef,
			editGridRef,
			terrainRef,
		});

		// Only the ortho camera is ever active here (no mode switching), so
		// resources.camera stays valid without an onActiveCameraChange callback.
		// attachInput wires middle-drag orbit / right-drag pan / scroll zoom.
		resources.rig.attachInput();

		let rafId = 0;
		let lastFrameMs = 0;
		const animate = (nowMs: number) => {
			rafId = requestAnimationFrame(animate);
			const dt = lastFrameMs > 0 ? Math.min(0.1, (nowMs - lastFrameMs) / 1000) : 1 / 60;
			lastFrameMs = nowMs;
			resources.rig.update(dt);
			resources.renderer.render(resources.scene, resources.camera);
		};
		rafId = requestAnimationFrame(animate);

		const resizeObserver = new ResizeObserver(() => resizeRenderer(resources, container));
		resizeObserver.observe(container);

		const positionGhost = (anchor: DoorAnchor) => {
			const t = terrainRef.current;
			const worldX = anchor.x + 0.5 - t.Width / 2;
			const worldZ = anchor.y + 0.5 - t.Length / 2;
			const worldY = terrainHeightToWorldY(anchor.h);
			ghost.position.set(worldX, worldY + DOOR_GHOST_HEIGHT / 2, worldZ);
			ghost.visible = true;
		};

		const updateHover = (event: PointerEvent) => {
			const pick = picker.getPickInfo(event);
			if (!pick) {
				ghost.visible = false;
				currentAnchorRef.current = null;
				return;
			}
			const t = terrainRef.current;
			const index = getVoxelTerrainIndex(t);
			const anchor = pickToDoorAnchor(
				pick,
				t.Id,
				index.allSurfaces,
				getVoxelTerrainResolution(t)
			);
			currentAnchorRef.current = anchor;
			positionGhost(anchor);
		};

		let pendingClick: { pointerId: number; startX: number; startY: number } | null = null;

		const handlePointerMove = (event: PointerEvent) => updateHover(event);

		const handlePointerLeave = () => {
			ghost.visible = false;
			currentAnchorRef.current = null;
		};

		const handlePointerDown = (event: PointerEvent) => {
			if (event.button !== 0) return;
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
			const dx = event.clientX - click.startX;
			const dy = event.clientY - click.startY;
			if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD_PX) return;
			// Re-pick at release so a tiny camera nudge still lands on the right tile.
			updateHover(event);
			const anchor = currentAnchorRef.current;
			if (anchor) onPickRef.current(anchor);
		};

		const dom = resources.renderer.domElement;
		dom.addEventListener("pointermove", handlePointerMove);
		dom.addEventListener("pointerleave", handlePointerLeave);
		dom.addEventListener("pointerdown", handlePointerDown);
		dom.addEventListener("pointerup", handlePointerUp);
		dom.addEventListener("pointercancel", handlePointerLeave);

		return () => {
			cancelAnimationFrame(rafId);
			resizeObserver.disconnect();
			dom.removeEventListener("pointermove", handlePointerMove);
			dom.removeEventListener("pointerleave", handlePointerLeave);
			dom.removeEventListener("pointerdown", handlePointerDown);
			dom.removeEventListener("pointerup", handlePointerUp);
			dom.removeEventListener("pointercancel", handlePointerLeave);
			resources.rig.dispose();
			clearAllChunkMeshes(resources.chunkGroup, chunkMeshesRef.current);
			ghostGeometry.dispose();
			ghostMaterial.dispose();
			clearObjectGroup(resources.hoverGroup);
			resources.terrainMaterial.dispose();
			resources.renderer.dispose();
			if (dom.parentElement === container) container.removeChild(dom);
			resourcesRef.current = null;
			ghostRef.current = null;
		};
	}, []);

	// --- (Re)build chunk meshes whenever the terrain changes. ---
	useEffect(() => {
		terrainRef.current = terrain;
		const resources = resourcesRef.current;
		const container = containerRef.current;
		if (!resources || !container) return;

		const index = getVoxelTerrainIndex(terrain);
		const dims = computeChunkDims(index);
		dimsRef.current = dims;
		editGridRef.current = buildEditGrid(terrain.Voxels, index);

		clearAllChunkMeshes(resources.chunkGroup, chunkMeshesRef.current);
		const dirty = new Set<number>();
		markAllChunksDirty(dirty, dims);
		for (const idx of dirty) {
			const { cx, cy, cz } = unpackChunkIndex(idx, dims);
			rebuildChunk(
				idx,
				cx,
				cy,
				cz,
				editGridRef.current,
				dims,
				resources.chunkGroup,
				resources.terrainMaterial,
				chunkMeshesRef.current
			);
		}

		if (ghostRef.current) ghostRef.current.visible = false;
		currentAnchorRef.current = null;
		frameOrthoCamera(resources, terrain, container);
	}, [terrain]);

	// --- Draw existing doors on this terrain as static transparent boxes. ---
	const anchorsKey = (existingAnchors ?? [])
		.map((a) => `${a.x},${a.y},${a.h}`)
		.join("|");
	useEffect(() => {
		const resources = resourcesRef.current;
		if (!resources) return;

		const group = new THREE.Group();
		const geometry = new THREE.BoxGeometry(1, DOOR_GHOST_HEIGHT, 1);
		const material = new THREE.MeshBasicMaterial({
			color: 0xf59e0b,
			transparent: true,
			opacity: 0.22,
			depthWrite: false,
		});
		for (const anchor of existingAnchors ?? []) {
			const box = new THREE.Mesh(geometry, material);
			box.position.set(
				anchor.x + 0.5 - terrain.Width / 2,
				terrainHeightToWorldY(anchor.h) + DOOR_GHOST_HEIGHT / 2,
				anchor.y + 0.5 - terrain.Length / 2
			);
			group.add(box);
		}
		resources.scene.add(group);
		existingDoorsGroupRef.current = group;

		return () => {
			resources.scene.remove(group);
			group.clear();
			geometry.dispose();
			material.dispose();
			existingDoorsGroupRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [terrain, anchorsKey]);

	return <div ref={containerRef} className="absolute inset-0" />;
}
