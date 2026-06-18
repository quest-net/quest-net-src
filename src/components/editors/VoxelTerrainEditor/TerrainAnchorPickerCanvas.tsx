// components/editors/VoxelTerrainEditor/TerrainAnchorPickerCanvas.tsx
//
// A self-contained, read-only voxel terrain renderer used by link placement to
// pick a single tactical anchor on a terrain. It reuses the editor's scene
// (createEditorScene) + picker (createPicker) but does no editing: it renders the
// given terrain, shows a transparent link-sized ghost, and reports the chosen
// anchor via onPick.
//
// Kept separate from the main editor state so picking an anchor on another
// terrain never touches the current terrain's brush/undo pipeline.

import { useEffect, useRef } from "react";
import * as THREE from "three";
import type { EditableVoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import type { TerrainLinkAnchor } from "../../../domains/TerrainLink/TerrainLink";
import { getVoxelTerrainIndex } from "../../../utils/terrain/data/VoxelTerrainIndex";
import { buildEditGrid, createEditGrid, type EditGrid } from "../../../utils/terrain/editor/EditGridUtils";
import {
	computeChunkDims,
	markAllChunksDirty,
	unpackChunkIndex,
	type ChunkDims,
} from "../../../utils/terrain/editor/EditGridChunkUtils";
import { pickToTacticalAnchor } from "../../../utils/terrain/editor/VoxelBrushUtils";
import {
	createEditorScene,
	clearObjectGroup,
	frameOrthoCamera,
	resizeRenderer,
	type EditorSceneResources,
} from "./editorScene";
import { clearAllChunkMeshes, rebuildChunk } from "./editorChunkMeshes";
import { createPicker } from "./editorPicking";
import {
	createTerrainLinkMarkerGeometry,
	createTerrainLinkMarkerMesh,
	disposeTerrainLinkMarkerGroup,
	positionTerrainLinkMarkerMesh,
} from "../../Map/TerrainLinks3D/terrainLinkMarkerMesh";

const CLICK_DRAG_THRESHOLD_PX = 5;

interface TerrainAnchorPickerCanvasProps {
	terrain: EditableVoxelTerrain;
	onPick: (anchor: TerrainLinkAnchor) => void;
	/** Existing anchors on this terrain, drawn as static transparent boxes. */
	existingAnchors?: TerrainLinkAnchor[];
}

export function TerrainAnchorPickerCanvas({
	terrain,
	onPick,
	existingAnchors,
}: TerrainAnchorPickerCanvasProps) {
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
	const currentAnchorRef = useRef<TerrainLinkAnchor | null>(null);

	// --- Mount the scene once. ---
	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const resources = createEditorScene(container, true);
		resourcesRef.current = resources;

		// Transparent link-sized ghost.
		const ghostGeometry = createTerrainLinkMarkerGeometry();
		const ghost = createTerrainLinkMarkerMesh({
			terrain,
			geometry: ghostGeometry,
			anchor: { x: 0, y: 0, h: 0 },
			locked: false,
			selected: true,
			opacity: 0.35,
			renderOrder: 30,
		});
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

		const positionGhost = (anchor: TerrainLinkAnchor) => {
			const t = terrainRef.current;
			positionTerrainLinkMarkerMesh(ghost, t, anchor);
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
			const { x, y, h } = pickToTacticalAnchor(pick, index);
			const anchor: TerrainLinkAnchor = { terrainId: t.Id, x, y, h };
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

	// --- Draw existing anchors on this terrain as static transparent boxes. ---
	const anchorsKey = (existingAnchors ?? [])
		.map((a) => `${a.x},${a.y},${a.h}`)
		.join("|");
	useEffect(() => {
		const resources = resourcesRef.current;
		if (!resources) return;

		const group = new THREE.Group();
		const geometry = createTerrainLinkMarkerGeometry();
		for (const anchor of existingAnchors ?? []) {
			const box = createTerrainLinkMarkerMesh({
				terrain,
				geometry,
				anchor,
				locked: false,
				opacity: 0.22,
			});
			group.add(box);
		}
		resources.scene.add(group);

		return () => {
			resources.scene.remove(group);
			disposeTerrainLinkMarkerGroup(group);
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [terrain, anchorsKey]);

	return <div ref={containerRef} className="absolute inset-0" />;
}
