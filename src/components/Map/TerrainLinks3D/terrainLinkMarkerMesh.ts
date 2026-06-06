import * as THREE from "three";
import { terrainHeightToWorldY } from "../Actors3D/actorTokenPlacement";

export const TERRAIN_LINK_MARKER_HEIGHT = 2;
export const TERRAIN_LINK_MARKER_COLORS = {
	unlocked: 0xf59e0b,
	locked: 0xe11d48,
	selected: 0x60a5fa,
} as const;

export interface TerrainLinkMarkerAnchor {
	x: number;
	y: number;
	h: number;
}

export interface TerrainLinkMarkerTerrainBounds {
	Width: number;
	Length: number;
}

interface TerrainLinkMarkerMeshOptions {
	terrain: TerrainLinkMarkerTerrainBounds;
	geometry: THREE.BoxGeometry;
	anchor: TerrainLinkMarkerAnchor;
	locked: boolean;
	selected?: boolean;
	opacity: number;
	depthTest?: boolean;
	colorWrite?: boolean;
	renderOrder?: number;
}

export function getTerrainLinkMarkerColor(
	locked: boolean,
	selected = false
): number {
	if (selected) return TERRAIN_LINK_MARKER_COLORS.selected;
	return locked
		? TERRAIN_LINK_MARKER_COLORS.locked
		: TERRAIN_LINK_MARKER_COLORS.unlocked;
}

export function createTerrainLinkMarkerGeometry(): THREE.BoxGeometry {
	return new THREE.BoxGeometry(
		1,
		TERRAIN_LINK_MARKER_HEIGHT,
		1
	);
}

export function positionTerrainLinkMarkerMesh(
	mesh: THREE.Object3D,
	terrain: TerrainLinkMarkerTerrainBounds,
	anchor: TerrainLinkMarkerAnchor
): void {
	mesh.position.set(
		anchor.x + 0.5 - terrain.Width / 2,
		terrainHeightToWorldY(anchor.h) + TERRAIN_LINK_MARKER_HEIGHT / 2,
		anchor.y + 0.5 - terrain.Length / 2
	);
}

export function createTerrainLinkMarkerMesh({
	terrain,
	geometry,
	anchor,
	locked,
	selected = false,
	opacity,
	depthTest = false,
	colorWrite = true,
	renderOrder = 0,
}: TerrainLinkMarkerMeshOptions): THREE.Mesh {
	const material = new THREE.MeshBasicMaterial({
		color: getTerrainLinkMarkerColor(locked, selected),
		transparent: true,
		opacity,
		depthTest,
		depthWrite: false,
		colorWrite,
	});
	const mesh = new THREE.Mesh(geometry, material);
	positionTerrainLinkMarkerMesh(mesh, terrain, anchor);
	mesh.renderOrder = renderOrder;
	return mesh;
}

export function disposeTerrainLinkMarkerGroup(group: THREE.Group): void {
	const geometries = new Set<THREE.BufferGeometry>();
	const materials = new Set<THREE.Material>();
	group.traverse((object) => {
		if (!(object instanceof THREE.Mesh)) return;
		if (object.geometry) geometries.add(object.geometry);
		const material = object.material;
		if (Array.isArray(material)) {
			for (const entry of material) materials.add(entry);
		} else if (material) {
			materials.add(material);
		}
	});
	group.clear();
	for (const geometry of geometries) geometry.dispose();
	for (const material of materials) material.dispose();
}
