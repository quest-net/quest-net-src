// Scene-native terrain-link markers for the terrain editor.
//
// These deliberately match the link-placement ghost: a transparent 1x2x1
// tactical block at the anchor tile. The right sidebar owns destructive actions;
// these meshes are display/select affordances.

import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	createTerrainLinkMarkerGeometry,
	createTerrainLinkMarkerMesh,
	disposeTerrainLinkMarkerGroup,
	TERRAIN_LINK_MARKER_HEIGHT,
} from "../../Map/TerrainLinks3D/terrainLinkMarkerMesh";

export const LINK_MARKER_HEIGHT = TERRAIN_LINK_MARKER_HEIGHT;

export interface TerrainLinkMarkerInfo {
	/** Stable per-anchor key (a same-terrain link contributes two markers). */
	id: string;
	/** The link this marker belongs to. */
	linkId: string;
	anchor: { x: number; y: number; h: number };
	/** Destination terrain name, shown in the sidebar. */
	destinationName: string;
	locked: boolean;
}

export interface TerrainLinkMarkerMeshBuild {
	group: THREE.Group;
	pickTargets: THREE.Mesh[];
}

export function buildTerrainLinkMarkerMeshes(
	terrain: VoxelTerrain,
	links: TerrainLinkMarkerInfo[],
	selectedLinkId: string | null
): TerrainLinkMarkerMeshBuild {
	const group = new THREE.Group();
	const pickTargets: THREE.Mesh[] = [];
	const geometry = createTerrainLinkMarkerGeometry();

	for (const link of links) {
		const selected = link.linkId === selectedLinkId;
		const mesh = createTerrainLinkMarkerMesh({
			terrain,
			geometry,
			anchor: link.anchor,
			locked: link.locked,
			selected,
			opacity: selected ? 0.5 : 0.28,
			renderOrder: selected ? 41 : 40,
		});
		mesh.userData = {
			linkMarkerId: link.id,
			linkId: link.linkId,
		};
		group.add(mesh);
		pickTargets.push(mesh);
	}

	return { group, pickTargets };
}

export function disposeTerrainLinkMarkerMeshes(group: THREE.Group): void {
	disposeTerrainLinkMarkerGroup(group);
}
