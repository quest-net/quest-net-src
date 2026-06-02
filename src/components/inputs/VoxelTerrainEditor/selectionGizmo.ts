// Interactive box-selection gizmo for the voxel terrain editor.
//
// Renders six axis-aligned arrow handles -- one centred on each face of the
// committed box selection -- that the user can drag directly on the map to
// resize the box, MagicaVoxel/Blender style. This replaces the trial-and-error
// numeric min/max fields as the primary way to tweak a selection.
//
// Drag semantics (the index.tsx pointer handlers drive these):
//   - plain drag  -> moves only the grabbed face, extending/shrinking that axis
//   - shift drag  -> translates the whole box along that axis (size preserved)
//
// The math (closest approach between the pointer ray and the handle's axis
// line, then snapped to voxel units) lives here as the pure `beginGizmoDrag` /
// `gizmoDragToBounds` pair so it can be unit-reasoned about independently of
// the Three.js handle meshes.

import * as THREE from "three";
import type { ChunkDims } from "../../../utils/terrain/editor/EditGridChunkUtils";
import type { VoxelSelectionBounds } from "../../../utils/terrain/editor/VoxelTerrainSelectionUtils";

export type GizmoAxis = "x" | "y" | "z";
export type GizmoFace = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export interface GizmoDragState {
	face: GizmoFace;
	axis: GizmoAxis;
	/** +1 for the max-side (far) face, -1 for the min-side (near) face. */
	sign: 1 | -1;
	/** A point on the drag axis line, world space, captured at drag start. */
	linePoint: THREE.Vector3;
	/** Voxel-space coordinate (fractional) of the grab point along the axis. */
	startFloat: number;
	/** Selection bounds snapshot taken at drag start. */
	startBounds: VoxelSelectionBounds;
}

// Match the common X=red / Y=green / Z=blue axis convention.
const AXIS_COLOR: Record<GizmoAxis, number> = {
	x: 0xef4444,
	y: 0x22c55e,
	z: 0x3b82f6,
};
const WHITE = new THREE.Color(0xffffff);

const HANDLE_RENDER_ORDER = 45;
// Arrow base sits this fraction of the handle length off the box face.
const FACE_GAP_FACTOR = 0.18;
// Target on-screen arrow length, in CSS pixels. Handles are rescaled each
// frame from the camera so they stay this size regardless of zoom/distance.
const HANDLE_PIXELS = 56;

interface FaceDef {
	face: GizmoFace;
	axis: GizmoAxis;
	sign: 1 | -1;
	dir: THREE.Vector3;
}

const FACE_DEFS: FaceDef[] = [
	{ face: "+x", axis: "x", sign:  1, dir: new THREE.Vector3( 1,  0,  0) },
	{ face: "-x", axis: "x", sign: -1, dir: new THREE.Vector3(-1,  0,  0) },
	{ face: "+y", axis: "y", sign:  1, dir: new THREE.Vector3( 0,  1,  0) },
	{ face: "-y", axis: "y", sign: -1, dir: new THREE.Vector3( 0, -1,  0) },
	{ face: "+z", axis: "z", sign:  1, dir: new THREE.Vector3( 0,  0,  1) },
	{ face: "-z", axis: "z", sign: -1, dir: new THREE.Vector3( 0,  0, -1) },
];

interface WorldExtents {
	minX: number; maxX: number;
	minY: number; maxY: number;
	minZ: number; maxZ: number;
}

// World-space AABB of the selection, matching `createSelectionBoundsFrame`:
// a voxel coordinate v maps to world `v / resolution - half`, and the far face
// of voxel `max` is at `(max + 1) / resolution - half`.
function worldExtents(bounds: VoxelSelectionBounds, dims: ChunkDims): WorldExtents {
	const r = dims.resolution;
	const halfW = dims.tW / 2;
	const halfL = dims.tL / 2;
	return {
		minX: bounds.min.x / r - halfW,
		maxX: (bounds.max.x + 1) / r - halfW,
		minY: bounds.min.y / r - 0.5,
		maxY: (bounds.max.y + 1) / r - 0.5,
		minZ: bounds.min.z / r - halfL,
		maxZ: (bounds.max.z + 1) / r - halfL,
	};
}

function faceCenter(def: FaceDef, ext: WorldExtents, out: THREE.Vector3): THREE.Vector3 {
	out.set(
		(ext.minX + ext.maxX) / 2,
		(ext.minY + ext.maxY) / 2,
		(ext.minZ + ext.maxZ) / 2,
	);
	if (def.axis === "x") out.x = def.sign === 1 ? ext.maxX : ext.minX;
	else if (def.axis === "y") out.y = def.sign === 1 ? ext.maxY : ext.minY;
	else out.z = def.sign === 1 ? ext.maxZ : ext.minZ;
	return out;
}

function axisHalf(axis: GizmoAxis, dims: ChunkDims): number {
	if (axis === "x") return dims.tW / 2;
	if (axis === "z") return dims.tL / 2;
	return 0.5;
}

function axisDimMax(axis: GizmoAxis, dims: ChunkDims): number {
	if (axis === "x") return dims.vW - 1;
	if (axis === "y") return dims.vH - 1;
	return dims.vL - 1;
}

function worldToVoxelFloat(world: number, axis: GizmoAxis, dims: ChunkDims): number {
	return (world + axisHalf(axis, dims)) * dims.resolution;
}

function clampInt(v: number, lo: number, hi: number): number {
	return Math.max(lo, Math.min(hi, v));
}

const _axisDir = new THREE.Vector3();

// Closest approach between the pointer ray and the infinite axis line through
// `linePoint`. Returns the world-space coordinate of that closest point along
// `axis`, or null when the ray is (near) parallel to the axis (degenerate).
function closestAxisWorld(
	ray: THREE.Ray,
	linePoint: THREE.Vector3,
	axis: GizmoAxis,
): number | null {
	_axisDir.set(axis === "x" ? 1 : 0, axis === "y" ? 1 : 0, axis === "z" ? 1 : 0);
	const rd = ray.direction; // unit length
	const ro = ray.origin;
	const wx = ro.x - linePoint.x;
	const wy = ro.y - linePoint.y;
	const wz = ro.z - linePoint.z;
	const b = rd.dot(_axisDir);
	const denom = 1 - b * b;
	if (Math.abs(denom) < 1e-6) return null;
	const d = rd.x * wx + rd.y * wy + rd.z * wz; // rd . w0
	const e = _axisDir.x * wx + _axisDir.y * wy + _axisDir.z * wz; // axisDir . w0
	// t along the axis line for the closest point: (a*e - b*d)/(a*c - b^2),
	// with a = c = 1 since both directions are unit length.
	const tLine = (e - b * d) / denom;
	const base = axis === "x" ? linePoint.x : axis === "y" ? linePoint.y : linePoint.z;
	return base + tLine;
}

/**
 * Begin a handle drag. Captures the axis line and the grab point so subsequent
 * moves can be expressed as a snapped delta. Returns null only on a degenerate
 * (parallel) ray or unknown face.
 */
export function beginGizmoDrag(
	face: GizmoFace,
	bounds: VoxelSelectionBounds,
	dims: ChunkDims,
	ray: THREE.Ray,
): GizmoDragState | null {
	const def = FACE_DEFS.find((f) => f.face === face);
	if (!def) return null;
	const ext = worldExtents(bounds, dims);
	const linePoint = faceCenter(def, ext, new THREE.Vector3());
	const world = closestAxisWorld(ray, linePoint, def.axis);
	if (world === null) return null;
	return {
		face,
		axis: def.axis,
		sign: def.sign,
		linePoint,
		startFloat: worldToVoxelFloat(world, def.axis, dims),
		startBounds: { min: { ...bounds.min }, max: { ...bounds.max } },
	};
}

/**
 * Resolve a drag move to new selection bounds. `translateWhole` (shift) slides
 * the entire box along the axis; otherwise only the grabbed face moves. Returns
 * null on a degenerate ray; the caller compares against the current bounds to
 * decide whether anything actually changed.
 */
export function gizmoDragToBounds(
	drag: GizmoDragState,
	ray: THREE.Ray,
	dims: ChunkDims,
	translateWhole: boolean,
): VoxelSelectionBounds | null {
	const world = closestAxisWorld(ray, drag.linePoint, drag.axis);
	if (world === null) return null;
	const currentFloat = worldToVoxelFloat(world, drag.axis, dims);
	const delta = Math.round(currentFloat - drag.startFloat);

	const ax = drag.axis;
	const startMin = drag.startBounds.min[ax];
	const startMax = drag.startBounds.max[ax];
	const dimMax = axisDimMax(ax, dims);

	let newMin = startMin;
	let newMax = startMax;

	if (translateWhole) {
		const size = startMax - startMin;
		newMin = clampInt(startMin + delta, 0, dimMax - size);
		newMax = newMin + size;
	} else if (drag.sign === 1) {
		// Far face: never crosses the near face, never leaves the grid.
		newMax = clampInt(startMax + delta, startMin, dimMax);
	} else {
		// Near face: never crosses the far face, never leaves the grid.
		newMin = clampInt(startMin + delta, 0, startMax);
	}

	const result: VoxelSelectionBounds = {
		min: { ...drag.startBounds.min },
		max: { ...drag.startBounds.max },
	};
	result.min[ax] = newMin;
	result.max[ax] = newMax;
	return result;
}

export interface SelectionGizmo {
	/** Scene group; the caller adds/removes it and toggles via `setVisible`. */
	group: THREE.Group;
	/** Reposition handles for the given bounds (face centres). Scale is applied
	 *  separately, per frame, by `updateScreenScale`. */
	update(bounds: VoxelSelectionBounds, dims: ChunkDims): void;
	/** Rescale handles so they hold a constant on-screen size. Call each frame
	 *  while visible, with the active camera and the viewport height in px. */
	updateScreenScale(camera: THREE.Camera, viewportHeightPx: number): void;
	setVisible(visible: boolean): void;
	/** Highlight one face (hover/active) or clear with null. */
	setHighlight(face: GizmoFace | null): void;
	/** Hit-test the handles; returns the grabbed face or null. */
	pickFace(raycaster: THREE.Raycaster): GizmoFace | null;
	dispose(): void;
}

interface HandleEntry {
	def: FaceDef;
	root: THREE.Group;
	material: THREE.MeshBasicMaterial;
	baseColor: THREE.Color;
	/** Face-centre world position (gap added at scale time). */
	center: THREE.Vector3;
}

const _up = new THREE.Vector3(0, 1, 0);

export function createSelectionGizmo(): SelectionGizmo {
	const group = new THREE.Group();
	group.visible = false;

	// Shared geometries: a thin shaft + cone head form the visible arrow; a fat
	// invisible cylinder is the generous click target. All are unit-sized along
	// +Y (base at y=0, tip at y=1) and oriented/scaled per handle.
	const shaftGeo = new THREE.CylinderGeometry(0.045, 0.045, 0.62, 10);
	shaftGeo.translate(0, 0.31, 0);
	const headGeo = new THREE.ConeGeometry(0.16, 0.38, 14);
	headGeo.translate(0, 0.81, 0);
	const hitGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.1, 8);
	hitGeo.translate(0, 0.5, 0);

	// depthTest off so handles always draw on top and stay grabbable, like a
	// typical editor gizmo. The hit cylinder is fully transparent.
	const hitMaterial = new THREE.MeshBasicMaterial({
		transparent: true,
		opacity: 0,
		depthTest: false,
		depthWrite: false,
	});

	const handles: HandleEntry[] = [];

	for (const def of FACE_DEFS) {
		const material = new THREE.MeshBasicMaterial({
			color: AXIS_COLOR[def.axis],
			transparent: true,
			opacity: 0.95,
			depthTest: false,
			depthWrite: false,
		});

		const root = new THREE.Group();
		root.quaternion.setFromUnitVectors(_up, def.dir);
		root.userData.gizmoFace = def.face;

		const shaft = new THREE.Mesh(shaftGeo, material);
		const head  = new THREE.Mesh(headGeo, material);
		const hit   = new THREE.Mesh(hitGeo, hitMaterial);
		for (const m of [shaft, head, hit]) {
			m.renderOrder = HANDLE_RENDER_ORDER;
			m.userData.gizmoFace = def.face;
		}
		root.add(shaft, head, hit);
		group.add(root);

		handles.push({
			def,
			root,
			material,
			baseColor: new THREE.Color(AXIS_COLOR[def.axis]),
			center: new THREE.Vector3(),
		});
	}

	const update = (bounds: VoxelSelectionBounds, dims: ChunkDims): void => {
		const ext = worldExtents(bounds, dims);
		for (const h of handles) {
			faceCenter(h.def, ext, h.center);
			// Position with no gap until the next frame's screen-scale pass; the
			// gap is scale-dependent so it's applied there.
			h.root.position.copy(h.center);
		}
	};

	const updateScreenScale = (camera: THREE.Camera, viewportHeightPx: number): void => {
		if (!group.visible || viewportHeightPx <= 0) return;
		const ortho = camera as THREE.OrthographicCamera;
		const persp = camera as THREE.PerspectiveCamera;
		// World units per CSS pixel. For ortho this is constant across the view;
		// for perspective it grows with distance, so it's computed per handle.
		const orthoWorldPerPx = ortho.isOrthographicCamera
			? (ortho.top - ortho.bottom) / ortho.zoom / viewportHeightPx
			: 0;
		const perspTan = persp.isPerspectiveCamera
			? Math.tan((persp.fov * THREE.MathUtils.DEG2RAD) / 2)
			: 0;
		for (const h of handles) {
			const worldPerPx = ortho.isOrthographicCamera
				? orthoWorldPerPx
				: (2 * perspTan * persp.position.distanceTo(h.center)) / viewportHeightPx;
			const s = HANDLE_PIXELS * worldPerPx;
			h.root.scale.setScalar(s);
			h.root.position.copy(h.center).addScaledVector(h.def.dir, s * FACE_GAP_FACTOR);
		}
	};

	const setVisible = (visible: boolean): void => {
		group.visible = visible;
	};

	const setHighlight = (face: GizmoFace | null): void => {
		for (const h of handles) {
			if (h.def.face === face) {
				h.material.color.copy(h.baseColor).lerp(WHITE, 0.55);
				h.material.opacity = 1;
			} else {
				h.material.color.copy(h.baseColor);
				h.material.opacity = 0.95;
			}
		}
	};

	const pickFace = (raycaster: THREE.Raycaster): GizmoFace | null => {
		if (!group.visible) return null;
		const hits = raycaster.intersectObjects(group.children, true);
		for (const hit of hits) {
			const face = hit.object.userData.gizmoFace as GizmoFace | undefined;
			if (face) return face;
		}
		return null;
	};

	const dispose = (): void => {
		shaftGeo.dispose();
		headGeo.dispose();
		hitGeo.dispose();
		hitMaterial.dispose();
		for (const h of handles) h.material.dispose();
		group.clear();
	};

	return { group, update, updateScreenScale, setVisible, setHighlight, pickFace, dispose };
}
