// Shared camera rig for the 3D map and the voxel terrain editor.
//
// Owns the two cameras both contexts use -- an OrthographicCamera for the
// default isometric view and a PerspectiveCamera for perspective/freecam --
// plus their controls (OrbitControls + PointerLockControls), the freecam
// movement runtime (WASD + Space/Shift vertical, scroll-wheel speed), mode switching,
// framing helpers, resize, and the freecam DOM input wiring.
//
// The two consumers differ only in tuning (near/far, zoom range, FOV, framing
// multipliers, move speed), expressed through CameraRigConfig, and in the
// side effects they run on freecam input, expressed through CameraRigCallbacks.
// Everything else is identical, which is why it lives here.
//
// Addon imports use three/examples/jsm/ -- see CLAUDE.md for why.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { adaptiveOrbitRotateSpeed } from "./adaptiveOrbitSpeed";

export type CameraMode = "ortho" | "perspective" | "freecam";

export interface TerrainDims {
	width: number;
	length: number;
	height: number;
}

export interface OrthoFramingOptions {
	/** Orbit pivot / vertical centre. Defaults to a height-derived terrain centre. */
	center?: THREE.Vector3;
	/** Pan-limit radius (controls.maxTargetRadius). Defaults to the terrain
	 *  footprint diagonal (min 8). */
	maxTargetRadius?: number;
}

export interface CameraRigConfig {
	ortho: {
		near: number;
		far: number;
		/** Half-extent of the orthographic frustum before any terrain framing. */
		initialHalfSize: number;
		/** Camera distance from target as a multiple of halfSize. */
		distanceMultiplier: number;
		/** How `frameOrtho()` derives halfSize from terrain extents. */
		framing: {
			floor: number;
			diagonalMultiplier: number;
			heightMultiplier: number;
		};
	};
	perspective: {
		fov: number;
		near: number;
		far: number;
		/** Dolly distance clamp for the perspective camera, as multiples of the
		 *  entry framing distance. OrbitControls' minZoom/maxZoom only bound the
		 *  ORTHOgraphic camera; the perspective camera is bounded by
		 *  minDistance/maxDistance, which these drive. Default 0.12 / 4. */
		minDistanceMultiplier?: number;
		maxDistanceMultiplier?: number;
	};
	controls: {
		dampingFactor: number;
		minZoom: number;
		maxZoom: number;
		/** Zoom/distance-adaptive orbit sensitivity, applied to BOTH orbit cameras.
		 *  OrbitControls rotation is angular and zoom-independent, so zoomed in the
		 *  same drag feels twitchy. rotateSpeed is ramped from minRotateSpeed (fully
		 *  zoomed in) up to maxRotateSpeed (at/beyond the default framing). Default
		 *  0.25 / 1. See adaptiveOrbitSpeed.ts. */
		minRotateSpeed?: number;
		maxRotateSpeed?: number;
		/** Optional mouse-button remap; omitted buttons keep OrbitControls defaults. */
		mouseButtons?: {
			LEFT?: THREE.MOUSE | null;
			MIDDLE?: THREE.MOUSE | null;
			RIGHT?: THREE.MOUSE | null;
		};
	};
	freecam: {
		/** World units per second at speed multiplier 1. */
		baseMoveSpeed: number;
		minSpeedMult: number;
		maxSpeedMult: number;
		/** Multiplicative speed change per scroll notch. */
		speedStep: number;
		/** Entry distance from target as a multiple of the freecam halfSize. */
		initialDistanceMultiplier: number;
	};
}

export interface CameraRigCallbacks {
	/** Fired when the active camera changes (mode switch). Point the renderer,
	 *  post-processing and picking at this camera. */
	onActiveCameraChange?: (camera: THREE.OrthographicCamera | THREE.PerspectiveCamera) => void;
	/** Fired when pointer-lock (freecam look mode) is entered/left. */
	onPointerLockChange?: (locked: boolean) => void;
	/** Fired when the freecam speed multiplier changes (for a HUD). */
	onFreecamSpeedChange?: (mult: number) => void;
	/** Fired immediately before pointer-lock is acquired (e.g. commit an edit). */
	beforePointerLock?: () => void;
}

type FreecamKey = "w" | "a" | "s" | "d" | "shift" | "space";

function freecamKeyFor(event: KeyboardEvent): FreecamKey | null {
	switch (event.key.toLowerCase()) {
		case "w": return "w";
		case "a": return "a";
		case "s": return "s";
		case "d": return "d";
		case "shift": return "shift";
		case " ":     return "space";
		default:      return null;
	}
}

/** True if the key drives freecam movement. Consumers can use this to avoid
 *  triggering tool shortcuts while flying. */
export function isFreecamMovementKey(key: string): boolean {
	switch (key.toLowerCase()) {
		case "w": case "a": case "s": case "d": case "shift": case " ":
			return true;
		default:
			return false;
	}
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value));
}

// Defaults used when a consumer's config omits the optional tuning fields. The
// dolly clamp is perspective-specific (CameraRigConfig.perspective); the orbit
// sensitivity ramp applies to both orbit cameras (CameraRigConfig.controls).
const DEFAULT_PERSPECTIVE_MIN_DISTANCE_MULT = 0.12;
const DEFAULT_PERSPECTIVE_MAX_DISTANCE_MULT = 4;
const DEFAULT_MIN_ROTATE_SPEED = 0.25;
const DEFAULT_MAX_ROTATE_SPEED = 1;

/** Freecam entry framing: tight enough to fill the view, with a floor so tiny
 *  terrains aren't framed from inside, and a height term so tall terrains fit.
 *  Shared by both consumers (the orthographic frame can be wider; this is the
 *  closer perspective starting point). */
function computeFreecamHalfSize(terrain: TerrainDims): number {
	return Math.max(
		4,
		((terrain.width + terrain.length) / Math.SQRT2 / 2) * 0.85,
		terrain.height * 0.8,
	);
}

export class CameraRig {
	readonly orthoCamera: THREE.OrthographicCamera;
	readonly perspectiveCamera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;
	readonly pointerLockControls: PointerLockControls;

	private readonly domElement: HTMLElement;
	private readonly config: CameraRigConfig;
	private callbacks: CameraRigCallbacks;

	private _mode: CameraMode = "ortho";
	private _pointerLocked = false;
	private _speedMult = 1;
	private _terrain: TerrainDims | null = null;
	/** Entry framing distance the perspective dolly clamp and adaptive orbit
	 *  sensitivity are measured against; refreshed on every entry positioning. */
	private _perspectiveReferenceDistance = 1;
	private readonly perspMinDistanceMult: number;
	private readonly perspMaxDistanceMult: number;
	private readonly minRotateSpeed: number;
	private readonly maxRotateSpeed: number;
	private viewportWidth = 1;
	private viewportHeight = 1;
	private inputAttached = false;

	private readonly keys: Record<FreecamKey, boolean> = {
		w: false, a: false, s: false, d: false, shift: false, space: false,
	};
	private readonly _lookDir = new THREE.Vector3();
	private readonly _rightDir = new THREE.Vector3();
	private readonly _worldUp = new THREE.Vector3(0, 1, 0);
	private readonly _tmpDir = new THREE.Vector3();

	constructor(
		domElement: HTMLElement,
		aspect: number,
		config: CameraRigConfig,
		callbacks: CameraRigCallbacks = {},
	) {
		this.domElement = domElement;
		this.config = config;
		this.callbacks = callbacks;

		this.perspMinDistanceMult =
			config.perspective.minDistanceMultiplier ?? DEFAULT_PERSPECTIVE_MIN_DISTANCE_MULT;
		this.perspMaxDistanceMult =
			config.perspective.maxDistanceMultiplier ?? DEFAULT_PERSPECTIVE_MAX_DISTANCE_MULT;
		this.minRotateSpeed =
			config.controls.minRotateSpeed ?? DEFAULT_MIN_ROTATE_SPEED;
		this.maxRotateSpeed =
			config.controls.maxRotateSpeed ?? DEFAULT_MAX_ROTATE_SPEED;

		const h = config.ortho.initialHalfSize;
		this.orthoCamera = new THREE.OrthographicCamera(
			-h * aspect, h * aspect, h, -h,
			config.ortho.near, config.ortho.far,
		);
		const dist = h * config.ortho.distanceMultiplier;
		this.orthoCamera.position.set(dist, dist, dist);

		this.perspectiveCamera = new THREE.PerspectiveCamera(
			config.perspective.fov, aspect,
			config.perspective.near, config.perspective.far,
		);
		this.perspectiveCamera.position.copy(this.orthoCamera.position);
		this.perspectiveCamera.lookAt(0, 0, 0);

		this.controls = new OrbitControls(this.orthoCamera, domElement);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = config.controls.dampingFactor;
		this.controls.minZoom = config.controls.minZoom;
		this.controls.maxZoom = config.controls.maxZoom;
		const mb = config.controls.mouseButtons;
		if (mb) {
			if ("LEFT" in mb)   this.controls.mouseButtons.LEFT   = mb.LEFT   as THREE.MOUSE;
			if ("MIDDLE" in mb) this.controls.mouseButtons.MIDDLE = mb.MIDDLE as THREE.MOUSE;
			if ("RIGHT" in mb)  this.controls.mouseButtons.RIGHT  = mb.RIGHT  as THREE.MOUSE;
		}
		this.controls.update();

		// Created up front so we can lock/unlock on demand; disabled until freecam.
		this.pointerLockControls = new PointerLockControls(this.perspectiveCamera, domElement);
		this.pointerLockControls.enabled = false;

		this.viewportHeight = 1;
		this.viewportWidth = aspect;
	}

	get mode(): CameraMode { return this._mode; }
	get pointerLocked(): boolean { return this._pointerLocked; }
	get freecamSpeedMult(): number { return this._speedMult; }
	get activeCamera(): THREE.OrthographicCamera | THREE.PerspectiveCamera {
		return this._mode === "ortho" ? this.orthoCamera : this.perspectiveCamera;
	}

	setCallbacks(callbacks: CameraRigCallbacks): void {
		this.callbacks = callbacks;
	}

	/** Tell the rig the current terrain extents so freecam entry framing knows
	 *  how far back to start. */
	setTerrain(terrain: TerrainDims | null): void {
		this._terrain = terrain;
	}

	/** Switch the active camera. For perspective/freecam, positions the
	 *  perspective camera at a comfortable entry framing looking at `target`. */
	setMode(mode: CameraMode, target?: THREE.Vector3): void {
		const lookTarget = target ?? this.controls.target;

		if (this._mode === "freecam" && this._pointerLocked) {
			this.pointerLockControls.unlock();
		}

		this._mode = mode;
		const active = this.activeCamera;
		// `controls.object` is undocumented but the long-standing re-bind path.
		(this.controls as unknown as { object: THREE.Camera }).object = active;

		if (mode === "freecam") {
			this.positionPerspectiveEntry(lookTarget);
			this.controls.enabled = false;
			this.pointerLockControls.enabled = true;
		} else {
			this.controls.enabled = true;
			this.pointerLockControls.enabled = false;
			this.resetKeys();
			if (mode === "perspective") {
				this.positionPerspectiveEntry(lookTarget);
			}
			this.applyAdaptiveRotateSpeed();
			this.controls.update();
		}

		this.updateProjections();
		this.callbacks.onActiveCameraChange?.(active);
	}

	/** Run one frame: freecam movement while locked, otherwise damped orbit. */
	update(deltaSeconds: number): void {
		if (this._mode === "freecam") {
			if (!this._pointerLocked) return;
			const speed = this.config.freecam.baseMoveSpeed * this._speedMult * deltaSeconds;
			if (speed <= 0) return;
			const cam = this.perspectiveCamera;
			cam.getWorldDirection(this._lookDir);
			this._rightDir.copy(this._lookDir).cross(this._worldUp).normalize();
			if (this.keys.w) cam.position.addScaledVector(this._lookDir,   speed);
			if (this.keys.s) cam.position.addScaledVector(this._lookDir,  -speed);
			if (this.keys.d) cam.position.addScaledVector(this._rightDir,  speed);
			if (this.keys.a) cam.position.addScaledVector(this._rightDir, -speed);
			if (this.keys.space) cam.position.y += speed;
			if (this.keys.shift) cam.position.y -= speed;
		} else {
			this.applyAdaptiveRotateSpeed();
			this.controls.update();
		}
	}

	/** Update both cameras' projections for a new viewport size. The renderer's
	 *  own setSize stays with the consumer. */
	resize(width: number, height: number): void {
		this.viewportWidth = width || 1;
		this.viewportHeight = height || 1;
		this.updateProjections();
	}

	/** Orthographic frustum half-size for `terrain`, from the configured framing
	 *  multipliers. Shared by the extents refresh and the full reframe. */
	private orthoHalfSize(terrain: TerrainDims): number {
		const f = this.config.ortho.framing;
		return Math.max(
			f.floor,
			((terrain.width + terrain.length) / Math.SQRT2 / 2) * f.diagonalMultiplier,
			terrain.height * f.heightMultiplier,
		);
	}

	/** Default orbit pivot for `terrain`: centred horizontally, raised to roughly
	 *  half the terrain's height. */
	private defaultOrthoCenter(terrain: TerrainDims): THREE.Vector3 {
		return new THREE.Vector3(0, Math.max(0, terrain.height / 2 - 0.5), 0);
	}

	/** Refresh the orthographic frustum extents, orbit cursor, and pan-limit radius
	 *  for `terrain` WITHOUT moving the camera. Use on a terrain content edit or a
	 *  resize so the viewer's current pan/zoom/rotation is preserved. */
	updateOrthoExtents(terrain: TerrainDims, options: OrthoFramingOptions = {}): void {
		this.setTerrain(terrain);
		const halfSize = this.orthoHalfSize(terrain);
		const aspect = this.viewportWidth / this.viewportHeight;
		const cam = this.orthoCamera;
		cam.left = -halfSize * aspect;
		cam.right = halfSize * aspect;
		cam.top = halfSize;
		cam.bottom = -halfSize;
		cam.updateProjectionMatrix();

		const center = options.center ?? this.defaultOrthoCenter(terrain);
		this.controls.cursor.copy(center);
		this.controls.maxTargetRadius =
			options.maxTargetRadius ??
			Math.max(
				8,
				Math.sqrt(terrain.width * terrain.width + terrain.length * terrain.length),
			);
	}

	/** Reset the orthographic camera to its default isometric framing for `terrain`:
	 *  the extents/cursor/pan-limit from updateOrthoExtents, plus the camera
	 *  position, orbit target, and zoom (a full view reset). Does not move the
	 *  perspective camera. */
	frameOrtho(terrain: TerrainDims, options: OrthoFramingOptions = {}): void {
		this.updateOrthoExtents(terrain, options);
		const halfSize = this.orthoHalfSize(terrain);
		const dist = halfSize * this.config.ortho.distanceMultiplier;
		const center = options.center ?? this.defaultOrthoCenter(terrain);

		const cam = this.orthoCamera;
		cam.position.set(dist, dist, dist);
		cam.zoom = 1;
		cam.updateProjectionMatrix();

		this.controls.target.copy(center);
		this.controls.update();
	}

	/** Position the perspective camera at the standard entry framing for `target`
	 *  (or the current controls target) and return it, WITHOUT changing the active
	 *  mode. Used by MapModeController to read a perspective viewpoint that
	 *  visually matches the isometric framing as the endpoint of a view tween. */
	perspectiveEntryCamera(target?: THREE.Vector3): THREE.PerspectiveCamera {
		this.positionPerspectiveEntry(target ?? this.controls.target);
		return this.perspectiveCamera;
	}

	/** Attach freecam DOM input: right-hold to lock+look, WASD/Space/Shift to fly,
	 *  scroll to change speed. Idempotent. */
	attachInput(): void {
		if (this.inputAttached) return;
		this.inputAttached = true;
		this.domElement.addEventListener("mousedown", this.onMouseDown);
		this.domElement.addEventListener("mouseup", this.onMouseUp);
		this.domElement.addEventListener("contextmenu", this.onContextMenu);
		this.domElement.addEventListener("wheel", this.onWheel, { passive: false });
		window.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("keyup", this.onKeyUp);
		this.pointerLockControls.addEventListener("lock", this.onLock);
		this.pointerLockControls.addEventListener("unlock", this.onUnlock);
	}

	detachInput(): void {
		if (!this.inputAttached) return;
		this.inputAttached = false;
		this.domElement.removeEventListener("mousedown", this.onMouseDown);
		this.domElement.removeEventListener("mouseup", this.onMouseUp);
		this.domElement.removeEventListener("contextmenu", this.onContextMenu);
		this.domElement.removeEventListener("wheel", this.onWheel);
		window.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("keyup", this.onKeyUp);
		this.pointerLockControls.removeEventListener("lock", this.onLock);
		this.pointerLockControls.removeEventListener("unlock", this.onUnlock);
	}

	dispose(): void {
		this.detachInput();
		this.controls.dispose();
		this.pointerLockControls.dispose();
	}

	// --- internals ---------------------------------------------------------

	private positionPerspectiveEntry(target: THREE.Vector3): void {
		const dir = this._tmpDir
			.subVectors(this.orthoCamera.position, target)
			.normalize();
		if (dir.lengthSq() === 0) dir.set(1, 1, 1).normalize();
		const halfSize = this._terrain
			? computeFreecamHalfSize(this._terrain)
			: this.orthoCamera.top;
		const dist = halfSize * this.config.freecam.initialDistanceMultiplier;
		this.perspectiveCamera.position.copy(target).addScaledVector(dir, dist);
		this.perspectiveCamera.lookAt(target);

		// Bound the perspective dolly against this entry distance. minZoom/maxZoom
		// only affect the orthographic camera; the perspective camera reads
		// min/maxDistance, so without these it can dolly straight through the
		// target. Harmless while ortho is active (those modes ignore distance).
		this._perspectiveReferenceDistance = dist;
		this.controls.minDistance = dist * this.perspMinDistanceMult;
		this.controls.maxDistance = dist * this.perspMaxDistanceMult;
	}

	/** Ramp orbit sensitivity with how zoomed-in the active orbit camera is, so
	 *  rotation feels consistent across zoom levels instead of twitchy up close.
	 *  The "out-ness" ratio is 1 at the default framing and shrinks as you zoom
	 *  in: perspective measures it from dolly distance, ortho from zoom factor. */
	private applyAdaptiveRotateSpeed(): void {
		const outnessRatio =
			this._mode === "perspective"
				? this.controls.getDistance() / (this._perspectiveReferenceDistance || 1)
				: 1 / (this.orthoCamera.zoom || 1);
		this.controls.rotateSpeed = adaptiveOrbitRotateSpeed(outnessRatio, {
			minSpeed: this.minRotateSpeed,
			maxSpeed: this.maxRotateSpeed,
		});
	}

	private updateProjections(): void {
		const aspect = this.viewportWidth / this.viewportHeight;
		const halfSize = this.orthoCamera.top;
		this.orthoCamera.left = -halfSize * aspect;
		this.orthoCamera.right = halfSize * aspect;
		this.orthoCamera.updateProjectionMatrix();
		this.perspectiveCamera.aspect = aspect;
		this.perspectiveCamera.updateProjectionMatrix();
	}

	private resetKeys(): void {
		this.keys.w = this.keys.a = this.keys.s = this.keys.d = false;
		this.keys.shift = this.keys.space = false;
	}

	private bumpSpeed(deltaY: number): void {
		// Wheel-up (deltaY < 0) speeds up; wheel-down slows. One notch = one step.
		const factor = deltaY < 0 ? this.config.freecam.speedStep : 1 / this.config.freecam.speedStep;
		this._speedMult = clamp(
			this._speedMult * factor,
			this.config.freecam.minSpeedMult,
			this.config.freecam.maxSpeedMult,
		);
		this.callbacks.onFreecamSpeedChange?.(this._speedMult);
	}

	private readonly onMouseDown = (event: MouseEvent): void => {
		if (this._mode !== "freecam" || event.button !== 2) return;
		event.preventDefault();
		this.callbacks.beforePointerLock?.();
		if (!this._pointerLocked) this.pointerLockControls.lock();
	};

	private readonly onMouseUp = (event: MouseEvent): void => {
		if (this._mode !== "freecam" || event.button !== 2) return;
		if (this._pointerLocked) this.pointerLockControls.unlock();
	};

	private readonly onContextMenu = (event: Event): void => {
		if (this._mode === "freecam") event.preventDefault();
	};

	private readonly onWheel = (event: WheelEvent): void => {
		if (this._mode !== "freecam") return;
		event.preventDefault();
		this.bumpSpeed(event.deltaY);
	};

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (this._mode !== "freecam") return;
		const key = freecamKeyFor(event);
		if (!key) return;
		if (this._pointerLocked) event.preventDefault();
		this.keys[key] = true;
	};

	private readonly onKeyUp = (event: KeyboardEvent): void => {
		const key = freecamKeyFor(event);
		if (!key) return;
		this.keys[key] = false;
	};

	private readonly onLock = (): void => {
		this._pointerLocked = true;
		this.callbacks.onPointerLockChange?.(true);
	};

	private readonly onUnlock = (): void => {
		this._pointerLocked = false;
		this.resetKeys();
		this.callbacks.onPointerLockChange?.(false);
	};
}
