// Freecam runtime for the voxel terrain editor.
//
// Mirrors the 3DMap freecam UX: right-click acquires pointer-lock, mouse moves
// the camera while locked, WASD flies, scroll-wheel adjusts the per-second move
// speed. The look angle is driven directly by PointerLockControls; this module
// only handles movement and speed.

import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import type { EditorSceneResources } from "./editorScene";

// Base move speed (world units per second) and the scroll-wheel-driven
// multiplier range. The scroll handler clamps the multiplier inside these
// bounds; the user can tune speed for indoor (slow) or outdoor (fast) work
// without leaving the keyboard.
export const FREECAM_BASE_MOVE_SPEED = 10;
export const FREECAM_MIN_SPEED_MULT  = 0.15;
export const FREECAM_MAX_SPEED_MULT  = 6;
const FREECAM_SPEED_STEP             = 1.15; // multiplicative per scroll notch

// Starting distance from the terrain center, as a multiple of `halfSize` (the
// terrain's diagonal half-extent). Mirrors 3DMap's
// `PERSPECTIVE_DISTANCE_MULTIPLIER` so the user starts at a comfortable framing
// rather than wherever the ortho camera happened to be (which can be very far).
const FREECAM_INITIAL_DISTANCE_MULTIPLIER = 1.3;

function computeTerrainHalfSize(terrain: VoxelTerrain): number {
	return Math.max(
		4,
		((terrain.Width + terrain.Length) / Math.SQRT2 / 2) * 0.85,
		terrain.Height * 0.8,
	);
}

export interface FreecamRuntime {
	keys: { w: boolean; a: boolean; s: boolean; d: boolean; q: boolean; e: boolean };
	speedMult: number;
	/** Position the freecam looking at the orbit target from a tight isometric
	 *  distance, using the same direction the ortho camera was facing. */
	enter(resources: EditorSceneResources, terrain: VoxelTerrain): void;
	/** Tear down any movement state. */
	exit(): void;
	/** Run one frame of WASD movement (only effective while pointer is locked). */
	update(resources: EditorSceneResources, deltaSeconds: number, locked: boolean): void;
	/** Adjust speed multiplier from a wheel event. Returns the new multiplier. */
	bumpSpeed(deltaY: number): number;
}

export function createFreecamRuntime(): FreecamRuntime {
	const keys = { w: false, a: false, s: false, d: false, q: false, e: false };
	const lookDir   = new THREE.Vector3();
	const rightDir  = new THREE.Vector3();
	const worldUp   = new THREE.Vector3(0, 1, 0);
	const runtime: FreecamRuntime = {
		keys,
		speedMult: 1,
		enter(resources, terrain) {
			// Position along the ortho camera's view direction at a terrain-
			// scaled distance so the user starts at a comfortable framing
			// instead of wherever the ortho cam was sitting (which trends very
			// far back to fill the orthographic frustum).
			const ortho = resources.orthoCamera;
			const target = resources.controls.target;
			const dir = new THREE.Vector3()
				.subVectors(ortho.position, target)
				.normalize();
			if (dir.lengthSq() === 0) dir.set(1, 1, 1).normalize();
			const halfSize = computeTerrainHalfSize(terrain);
			const dist = halfSize * FREECAM_INITIAL_DISTANCE_MULTIPLIER;
			resources.freecamCamera.position
				.copy(target)
				.addScaledVector(dir, dist);
			resources.freecamCamera.lookAt(target);
		},
		exit() {
			keys.w = keys.a = keys.s = keys.d = keys.q = keys.e = false;
		},
		update(resources, deltaSeconds, locked) {
			if (!locked) return;
			const speed = FREECAM_BASE_MOVE_SPEED * runtime.speedMult * deltaSeconds;
			if (speed <= 0) return;
			const camera = resources.freecamCamera;
			camera.getWorldDirection(lookDir);
			rightDir.copy(lookDir).cross(worldUp).normalize();

			if (keys.w) camera.position.addScaledVector(lookDir,  speed);
			if (keys.s) camera.position.addScaledVector(lookDir, -speed);
			if (keys.d) camera.position.addScaledVector(rightDir,  speed);
			if (keys.a) camera.position.addScaledVector(rightDir, -speed);
			if (keys.e) camera.position.y += speed;
			if (keys.q) camera.position.y -= speed;
		},
		bumpSpeed(deltaY) {
			// Wheel-up (deltaY < 0) speeds up; wheel-down slows. One notch =
			// FREECAM_SPEED_STEP factor either way.
			const factor = deltaY < 0 ? FREECAM_SPEED_STEP : 1 / FREECAM_SPEED_STEP;
			runtime.speedMult = clamp(
				runtime.speedMult * factor,
				FREECAM_MIN_SPEED_MULT,
				FREECAM_MAX_SPEED_MULT,
			);
			return runtime.speedMult;
		},
	};
	return runtime;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

/**
 * Returns true if the given key event maps to a freecam movement key. Used to
 * gate the editor's brush-tool shortcuts so navigation keys don't trigger
 * tool changes while flying.
 */
export function isFreecamMovementKey(key: string): boolean {
	switch (key.toLowerCase()) {
		case "w": case "a": case "s": case "d":
		case "q": case "e":
			return true;
		default:
			return false;
	}
}
