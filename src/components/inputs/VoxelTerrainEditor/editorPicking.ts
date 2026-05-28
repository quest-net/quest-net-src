// Pointer-event -> voxel-pick translation.
//
// `createPicker` returns closures that:
//   - getPickInfo(event)             -> the voxel/face under the cursor (DDA),
//                                       falling back to a ground-plane hit.
//   - getLockedPlanePickInfo(event)  -> a pick constrained to a previously
//                                       locked plane (used to keep a brush
//                                       stroke on the face it started on).
//
// The closures read editGrid / terrain / dims through the supplied refs so the
// callers (pointer event handlers) need not be re-bound when those mutate.
//
// Allocation-free hot path: all THREE scratch objects are module-level and
// reused across every call. Callers MUST NOT hold references to plane fields
// across an await or another pick call; the pointer-down handler clones the
// plane before storing it in the stroke state.

import * as THREE from "three";
import {
	getVoxelTerrainIndex,
	type VoxelTerrainIndex,
} from "../../../utils/terrain/data/VoxelTerrainIndex";
import { raycastVoxelGrid } from "../../../utils/terrain/raycast/VoxelRaycast";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import {
	isVoxelInBounds,
	pointToVoxelCoord,
	type PickInfo,
} from "../../../utils/terrain/editor/VoxelBrushUtils";
import type { EditGrid } from "../../../utils/terrain/editor/EditGridUtils";
import type { ChunkDims } from "../../../utils/terrain/editor/EditGridChunkUtils";
import type { VoxelCoord } from "../../../utils/terrain/editor/VoxelTerrainSelectionUtils";
import type { EditorSceneResources } from "./editorScene";

const PICK_EPSILON = 0.0001;

// Module-level scratch THREE objects -- reused across every pick/hover call to
// eliminate per-event allocation and GC pressure. Single-use temporaries.
const _pickMouse  = new THREE.Vector2();
const _pickRay    = new THREE.Raycaster();
const _pickNormal = new THREE.Vector3();
const _pickCenter = new THREE.Vector3();
const _pickPlane  = new THREE.Plane();
const _lockPt     = new THREE.Vector3();
const _lockNormal = new THREE.Vector3();
const _groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0.5);

export interface LockedStrokePlane {
	plane: THREE.Plane;
	normal: VoxelCoord;
	ground: boolean;
}

export interface PickerInputs {
	resourcesRef: { current: EditorSceneResources | null };
	dimsRef:      { current: ChunkDims | null };
	editGridRef:  { current: EditGrid };
	terrainRef:   { current: VoxelTerrain };
}

export interface Picker {
	getPickInfo: (event: PointerEvent) => PickInfo | null;
	getLockedPlanePickInfo: (event: PointerEvent, plane: LockedStrokePlane) => PickInfo | null;
	groundPlane: THREE.Plane;
}

export function createPicker(inputs: PickerInputs): Picker {
	const setRayFromEvent = (event: PointerEvent): boolean => {
		const resources = inputs.resourcesRef.current;
		if (!resources) return false;
		const rect = resources.renderer.domElement.getBoundingClientRect();
		_pickMouse.set(
			((event.clientX - rect.left) / rect.width)  *  2 - 1,
			-((event.clientY - rect.top)  / rect.height) *  2 + 1,
		);
		_pickRay.setFromCamera(_pickMouse, resources.camera);
		return true;
	};

	const buildPickPlane = (
		voxel: VoxelCoord,
		dims: ChunkDims,
	): THREE.Plane => {
		_pickCenter
			.set(
				(voxel.x + 0.5) / dims.resolution - dims.tW / 2,
				(voxel.y + 0.5) / dims.resolution - 0.5,
				(voxel.z + 0.5) / dims.resolution - dims.tL / 2,
			)
			.addScaledVector(_pickNormal, 0.5 / dims.resolution);
		_pickPlane.setFromNormalAndCoplanarPoint(_pickNormal, _pickCenter);
		return _pickPlane;
	};

	const getPickInfo = (event: PointerEvent): PickInfo | null => {
		if (!setRayFromEvent(event)) return null;
		const dims = inputs.dimsRef.current;
		if (!dims) return null;

		const hit = raycastVoxelGrid(
			_pickRay.ray,
			inputs.editGridRef.current.occupied,
			dims.vW, dims.vH, dims.vL,
			dims.resolution,
			dims.tW, dims.tL,
		);

		if (hit) {
			const { vx, vy, vz, nx, ny, nz } = hit;
			_pickNormal.set(nx, ny, nz);
			buildPickPlane({ x: vx, y: vy, z: vz }, dims);
			return {
				voxel:  { x: vx, y: vy, z: vz },
				normal: { x: nx, y: ny, z: nz },
				ground: false,
				plane:  _pickPlane,  // cloned by pointer-down handler before storage
			};
		}

		// Fall back to ground plane hit.
		const index: VoxelTerrainIndex = getVoxelTerrainIndex(inputs.terrainRef.current);
		if (!_pickRay.ray.intersectPlane(_groundPlane, _pickCenter)) return null;

		const voxel = {
			x: Math.floor((_pickCenter.x + index.width  / 2) * index.resolution),
			y: 0,
			z: Math.floor((_pickCenter.z + index.length / 2) * index.resolution),
		};
		if (!isVoxelInBounds(index, voxel)) return null;

		return {
			voxel,
			normal: { x: 0, y: 1, z: 0 },
			ground: true,
			plane:  _groundPlane,  // cloned by pointer-down handler before storage
		};
	};

	const getLockedPlanePickInfo = (
		event: PointerEvent,
		lockedPlane: LockedStrokePlane,
	): PickInfo | null => {
		if (!setRayFromEvent(event)) return null;

		// Intersect into _lockPt (scratch); do NOT hold a reference past this fn.
		if (!_pickRay.ray.intersectPlane(lockedPlane.plane, _lockPt)) return null;

		const index = getVoxelTerrainIndex(inputs.terrainRef.current);
		const voxel = lockedPlane.ground
			? {
				x: Math.floor((_lockPt.x + index.width  / 2) * index.resolution),
				y: 0,
				z: Math.floor((_lockPt.z + index.length / 2) * index.resolution),
			}
			: pointToVoxelCoord(
				_lockNormal
					.set(lockedPlane.normal.x, lockedPlane.normal.y, lockedPlane.normal.z)
					.normalize()
					.multiplyScalar(-PICK_EPSILON)
					.add(_lockPt),
				index,
			);

		if (!isVoxelInBounds(index, voxel)) return null;

		return {
			voxel,
			normal: { ...lockedPlane.normal },
			ground: lockedPlane.ground,
			plane:  lockedPlane.plane.clone(),
		};
	};

	return { getPickInfo, getLockedPlanePickInfo, groundPlane: _groundPlane };
}
