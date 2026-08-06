// Shared camera rig for the 3D map and the voxel terrain editor.
//
// Owns the two cameras both contexts use -- an OrthographicCamera for the
// default isometric view and a PerspectiveCamera shared by perspective, freecam
// and follow -- plus their controls (OrbitControls + PointerLockControls), the
// freecam movement runtime (WASD + Space/Shift vertical, scroll-wheel speed),
// mode switching, framing helpers, resize, and the freecam DOM input wiring.
//
// The two consumers differ only in tuning (near/far, zoom range, FOV, framing
// multipliers, move speed), expressed through CameraRigConfig, and in the
// side effects they run on freecam input, expressed through CameraRigCallbacks.
// Everything else is identical, which is why it lives here.
//
// "follow" is the map-only actor-anchored third-person mode: the consumer feeds
// an anchor via setFollowAnchor() and the rig rigidly carries the camera with it,
// with panning disabled and an actor-scaled (not terrain-scaled) dolly clamp.
// Its config block is optional -- the terrain editor has no actors and omits it.
//
// Addon imports use three/examples/jsm/ -- see CLAUDE.md for why.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { PointerLockControls } from "three/examples/jsm/controls/PointerLockControls.js";
import { adaptiveOrbitRotateSpeed } from "./adaptiveOrbitSpeed";
import type { RigCameraMode } from "./CameraModes";
import { clamp } from "../math";

export type CameraMode = RigCameraMode;

/** Follow aim in the yaw/pitch pair the actor-eye camera and the locomotion
 *  runtime speak in. Internally this is just the boom's spherical angles. */
export interface FollowLookAngles {
	yaw: number;
	pitch: number;
}

/** `theta` is the yaw directly; `phi` is measured from +Y, and the eye camera's
 *  pitch is measured from the horizon, hence the quarter-turn. */
function followOrbitToLookAngles(orbit: THREE.Spherical): FollowLookAngles {
	return { yaw: orbit.theta, pitch: orbit.phi - Math.PI / 2 };
}

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
	/** Actor-anchored third-person orbit. Required: a rig that can hold "follow"
	 *  has to be told how to frame it, and there is no defensible default -- the
	 *  numbers are ACTOR-scaled world units (1 unit = 1 tactical tile),
	 *  deliberately NOT derived from terrain extents. Consumers with no actors
	 *  share MAP_FOLLOW_RIG_CONFIG rather than inventing their own. */
	follow: FollowConfig;
}

/** Follow tuning. */
export interface FollowConfig {
	/** Applied to the SHARED perspective camera on entry; config.perspective.fov
	 *  is restored on leaving. */
	fov: number;
	/** Orbit distance on entry. */
	initialDistance: number;
	/** Absolute dolly clamp (controls.min/maxDistance) while following. */
	minDistance: number;
	maxDistance: number;
	/** Pitch clamp while following (radians from +Y). Saved and restored. */
	minPolarAngle: number;
	maxPolarAngle: number;
	/** Vertical offset from the Follow aim anchor where upward camera travel is
	 *  floored. Negative values place the floor below the torso/aim anchor. */
	upwardCameraFloorOffsetFromAnchor: number;
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
	/** Entry framing distance the dolly clamp and adaptive orbit sensitivity are
	 *  measured against, for whichever dolly-driven mode is active; refreshed on
	 *  every entry positioning (terrain-scaled for perspective/freecam, the
	 *  actor-scaled follow.initialDistance for follow). */
	private _perspectiveReferenceDistance = 1;
	private readonly perspMinDistanceMult: number;
	private readonly perspMaxDistanceMult: number;
	private readonly minRotateSpeed: number;
	private readonly maxRotateSpeed: number;
	private viewportWidth = 1;
	private viewportHeight = 1;
	private inputAttached = false;

	private readonly followCfg: FollowConfig;
	private readonly _followAnchor = new THREE.Vector3();
	private _hasFollowAnchor = false;
	/** Follow's camera boom in anchor-relative spherical coordinates: `radius` is
	 *  the orbit distance, `theta` IS the look yaw, and `phi` IS the polar angle
	 *  the config's min/maxPolarAngle clamp directly. Holding it in the form
	 *  three.js already understands is what removes the direction-vector
	 *  trigonometry this used to carry. */
	private readonly _followOrbit = new THREE.Spherical();
	/** Allocation-free scratch for Follow's actor-relative boom and aim pose. */
	private readonly _followResolvedAnchor = new THREE.Vector3();
	private readonly _followLookDirection = new THREE.Vector3();
	private readonly _followAimTarget = new THREE.Vector3();

	// The orthographic pan-limit sphere. Held here rather than written straight
	// to `controls` so a terrain refresh mid-follow cannot stomp the driven
	// target, and so leaving follow restores the limits exactly. See
	// applyTargetLimits.
	private readonly _orthoCursor = new THREE.Vector3();
	private _orthoMaxTargetRadius = Infinity;

	// Saved on follow entry, restored by exitFollow. The perspective camera is
	// shared across perspective/freecam/follow, so anything follow overrides on
	// it or on the controls has to be put back.
	private _savedEnablePan = true;
	private _savedMinPolarAngle = 0;
	private _savedMaxPolarAngle = Math.PI;
	/** Ortho camera's offset from the orbit target at follow entry, so exiting
	 *  re-seats the isometric view around wherever the target ended up instead of
	 *  leaving it pointing off-axis. */
	private readonly _orthoOffset = new THREE.Vector3();

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
		this.followCfg = config.follow;

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
	 *  perspective camera at a comfortable entry framing looking at `target`.
	 *  For follow, frames around the current follow anchor instead. */
	setMode(
		mode: CameraMode,
		target?: THREE.Vector3,
		followViewDirection?: THREE.Vector3
	): void {
		const previous = this._mode;
		const lookTarget = target ?? this.controls.target;

		if (previous === "freecam" && this._pointerLocked) {
			this.pointerLockControls.unlock();
		}
		// Put back everything follow overrode BEFORE the destination mode does its
		// own positioning, so it can't be clobbered half-way.
		if (previous === "follow" && mode !== "follow") {
			this.exitFollow();
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
			} else if (mode === "follow") {
				this.enterFollow(previous, followViewDirection);
			} else {
				// Ortho. OrbitControls applies the dolly clamp to the orthographic
				// camera too, so re-arm the terrain-scaled bounds -- otherwise ortho
				// inherits whatever follow left behind and gets yanked toward the
				// target. See applyPerspectiveDollyClamp.
				this.applyPerspectiveDollyClamp();
			}
			this.applyAdaptiveRotateSpeed();
			this.controls.update();
		}

		this.updateProjections();
		this.callbacks.onActiveCameraChange?.(active);
	}

	/** Feed the world-space point the follow camera orbits (the actor's torso).
	 *  Cheap and safe to call every frame. Passing null clears the anchor. */
	setFollowAnchor(anchor: THREE.Vector3 | null): void {
		if (!anchor) {
			this._hasFollowAnchor = false;
			return;
		}
		this._hasFollowAnchor = true;
		this._followAnchor.copy(anchor);
	}

	/** Rotate Follow aim from pointer-lock mouse movement, returning the resulting
	 *  look angles so the caller does not have to read them back. Vertical input
	 *  matches First Person. On upward aim the camera stops at its configured
	 *  floor while the boom's horizontal reach shortens with cos(pitch), which is
	 *  what lets you aim up without burying the camera in the terrain. */
	rotateFollowByPointerDelta(
		movementX: number,
		movementY: number,
		sensitivity: number
	): FollowLookAngles {
		if (this._mode !== "follow") return this.getFollowLookAngles();
		this.readFollowOrbitFromCamera();
		// theta is yaw and phi is pitch measured from +Y, so pointer deltas apply
		// directly -- no direction-vector round trip, and phi clamps against the
		// configured polar limits without any half-turn conversion.
		this._followOrbit.theta -= movementX * sensitivity;
		this._followOrbit.phi -= movementY * sensitivity;
		this.applyFollowOrbit(this.perspectiveCamera, this.controls.target);
		// Read straight off the orbit rather than back off the camera we just
		// placed: applyFollowOrbit clamped it, so this IS the resulting aim.
		return followOrbitToLookAngles(this._followOrbit);
	}

	/** Current Follow aim as the yaw/pitch pair the actor-eye camera and the
	 *  locomotion runtime speak in. */
	getFollowLookAngles(): FollowLookAngles {
		this.readFollowOrbitFromCamera();
		return followOrbitToLookAngles(this._followOrbit);
	}

	/** Set the orthographic pan-limit sphere without a full extents refresh.
	 *  Routed through the rig (rather than written onto `controls` directly) so
	 *  the value survives a follow excursion. */
	setOrthoPanLimit(radius: number, cursor?: THREE.Vector3): void {
		this._orthoMaxTargetRadius = radius;
		if (cursor) this._orthoCursor.copy(cursor);
		this.applyTargetLimits();
	}

	/** Perspective camera positioned at the standard FOLLOW framing around the
	 *  current anchor, with the follow FOV applied -- the tween-endpoint mirror of
	 *  perspectiveEntryCamera().
	 *
	 *  Unlike that sibling this must not touch controls.target or the dolly clamp.
	 *  MapModeController runs rig.update() every frame during a Follow-bound tween,
	 *  and controls.enabled only gates DOM events, so mutating orbit state here
	 *  would drag the rig behind the transition camera. */
	followEntryCamera(viewDirection?: THREE.Vector3): THREE.PerspectiveCamera {
		const cam = this.perspectiveCamera;
		this.seedFollowOrbit(viewDirection, this.followCfg.initialDistance);
		this.applyFollowOrbit(cam, this._followAimTarget);
		cam.fov = this.followCfg.fov;
		cam.updateProjectionMatrix();
		return cam;
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
			if (this._mode === "follow") this.normalizeFollowAimPose();
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
		this._orthoCursor.copy(center);
		this._orthoMaxTargetRadius =
			options.maxTargetRadius ??
			Math.max(
				8,
				Math.sqrt(terrain.width * terrain.width + terrain.length * terrain.length),
			);
		// Consumers call this on every terrain content edit and resize. While
		// following, the actor-relative aim target is driven and must not be re-clamped -- the
		// values above live on and are re-applied by exitFollow.
		this.applyTargetLimits();
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
		// Canonical isometric offset, so a later exitFollow re-seats the ortho
		// camera at the correct bearing around wherever the target ended up.
		this._orthoOffset.set(dist, dist, dist);

		// While following, the aim target is derived from the actor anchor. The extents and
		// camera reset above still apply so a later switch to ortho is framed
		// correctly, but the target must not be yanked off the actor.
		if (this._mode === "follow") return;

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

		this._perspectiveReferenceDistance = dist;
		this.applyPerspectiveDollyClamp();
	}

	/** Bound the dolly against the entry framing distance for the terrain-scaled
	 *  modes. minZoom/maxZoom only affect the orthographic camera; the perspective
	 *  camera reads min/maxDistance, so without these it can dolly straight through
	 *  the target.
	 *
	 *  This is NOT harmless while ortho is active, despite what the docs imply:
	 *  OrbitControls.update() runs _clampDistance on an orthographic camera too.
	 *  Nothing bit while only terrain-scaled values were ever written here, but
	 *  follow installs a tight actor-scaled clamp, so ortho has to re-arm these on
	 *  entry or it inherits follow's bounds and the camera jumps. */
	private applyPerspectiveDollyClamp(): void {
		const dist = this._perspectiveReferenceDistance;
		this.controls.minDistance = dist * this.perspMinDistanceMult;
		this.controls.maxDistance = dist * this.perspMaxDistanceMult;
	}

	/** Point OrbitControls' target clamp at either the terrain pan-limit sphere
	 *  (ortho/perspective/freecam) or the Follow actor anchor. Routing both through one
	 *  place is what lets a terrain refresh mid-follow leave the driven target
	 *  alone while still recording the limits for when follow ends. */
	private applyTargetLimits(): void {
		if (this._mode === "follow") {
			this.controls.cursor.copy(
				this._hasFollowAnchor ? this._followAnchor : this.controls.target,
			);
			this.controls.maxTargetRadius = Infinity;
		} else {
			this.controls.cursor.copy(this._orthoCursor);
			this.controls.maxTargetRadius = this._orthoMaxTargetRadius;
		}
	}

	private resolveFollowAnchor(out: THREE.Vector3): THREE.Vector3 {
		return out.copy(
			this._hasFollowAnchor ? this._followAnchor : this.controls.target
		);
	}

	/** Load `_followOrbit` from wherever the camera currently is, clamped. The
	 *  boom is read from the camera's FORWARD direction rather than its offset
	 *  from the orbit target: once the floor kicks in those disagree (the target
	 *  rises while the camera stays put), and forward + distance is the pair that
	 *  survives it. This is what lets unlocked OrbitControls orbit/dolly and
	 *  pointer-lock aim feed the same state. */
	private readFollowOrbitFromCamera(): void {
		this.perspectiveCamera.getWorldDirection(this._tmpDir).negate();
		if (this._tmpDir.lengthSq() === 0) this._tmpDir.set(0, 1, 1);
		this._followOrbit.setFromVector3(this._tmpDir);
		this._followOrbit.radius = this.controls.getDistance();
		this.clampFollowOrbit();
	}

	/** Seed `_followOrbit` for an entry framing, from an explicit camera-forward
	 *  direction or, failing that, the isometric camera's bearing. */
	private seedFollowOrbit(
		viewDirection: THREE.Vector3 | undefined,
		distance: number
	): void {
		if (viewDirection && viewDirection.lengthSq() > 0) {
			this._tmpDir.copy(viewDirection).negate();
		} else {
			this._tmpDir.subVectors(this.orthoCamera.position, this.controls.target);
			if (this._tmpDir.lengthSq() === 0) this._tmpDir.set(1, 1, 1);
		}
		this._followOrbit.setFromVector3(this._tmpDir);
		this._followOrbit.radius = distance;
		this.clampFollowOrbit();
	}

	private clampFollowOrbit(): void {
		const cfg = this.followCfg;
		this._followOrbit.radius = clamp(
			this._followOrbit.radius,
			cfg.minDistance,
			cfg.maxDistance
		);
		this._followOrbit.phi = clamp(
			this._followOrbit.phi,
			cfg.minPolarAngle,
			cfg.maxPolarAngle
		);
		this._followOrbit.makeSafe();
	}

	/** Place `camera` on the current orbit around the anchor and aim it back down
	 *  the boom. Looking downward is a plain fixed-length boom pointed at the
	 *  actor. Aiming upward shortens the boom's horizontal reach by cos(pitch)
	 *  naturally, and the configured floor stops the camera's descent -- after
	 *  which the aim target rises instead, keeping the camera out of the terrain. */
	private applyFollowOrbit(
		camera: THREE.PerspectiveCamera,
		targetOut: THREE.Vector3
	): void {
		this.clampFollowOrbit();
		const anchor = this.resolveFollowAnchor(this._followResolvedAnchor);
		const offset = this._tmpDir.setFromSpherical(this._followOrbit);
		const forward = this._followLookDirection
			.copy(offset)
			.normalize()
			.negate();

		camera.position.copy(anchor).add(offset);
		camera.position.y = Math.max(
			camera.position.y,
			anchor.y + this.followCfg.upwardCameraFloorOffsetFromAnchor
		);
		targetOut
			.copy(camera.position)
			.addScaledVector(forward, this._followOrbit.radius);
		camera.lookAt(targetOut);
	}

	/** Rebase the orbit onto the actor anchor after controls.update(), so
	 *  unlocked orbit and zoom feed the same geometry as pointer-lock aim while
	 *  actor translation stays exact. */
	private normalizeFollowAimPose(): void {
		if (!this._hasFollowAnchor) return;
		this.readFollowOrbitFromCamera();
		this.applyFollowOrbit(this.perspectiveCamera, this.controls.target);
		this.controls.cursor.copy(this._followAnchor);
	}

	private enterFollow(
		previous: CameraMode,
		viewDirection?: THREE.Vector3
	): void {
		const cfg = this.followCfg;
		const cam = this.perspectiveCamera;

		// Save what follow overrides. Guarded so a redundant setMode("follow")
		// cannot overwrite the saved values with follow's own.
		if (previous !== "follow") {
			this._savedEnablePan = this.controls.enablePan;
			this._savedMinPolarAngle = this.controls.minPolarAngle;
			this._savedMaxPolarAngle = this.controls.maxPolarAngle;
			this._orthoOffset.subVectors(this.orthoCamera.position, this.controls.target);
		}

		// Panning is what breaks the link between camera and character; orbit and
		// dolly stay free.
		this.controls.enablePan = false;
		this.controls.minPolarAngle = cfg.minPolarAngle;
		this.controls.maxPolarAngle = cfg.maxPolarAngle;
		// Actor-scaled dolly clamp, not the terrain-derived one.
		this.controls.minDistance = cfg.minDistance;
		this.controls.maxDistance = cfg.maxDistance;
		// The reference the adaptive rotate ramp measures "out-ness" against.
		this._perspectiveReferenceDistance = cfg.initialDistance;
		cam.fov = cfg.fov;

		this.seedFollowOrbit(viewDirection, cfg.initialDistance);
		this.applyFollowOrbit(cam, this.controls.target);
		// Release the target clamp after the actor-relative aim pose is established.
		this.applyTargetLimits();
	}

	private exitFollow(): void {
		this.controls.enablePan = this._savedEnablePan;
		this.controls.minPolarAngle = this._savedMinPolarAngle;
		this.controls.maxPolarAngle = this._savedMaxPolarAngle;
		this.perspectiveCamera.fov = this.config.perspective.fov;

		// Upward Follow aim raises OrbitControls.target above the actor. Re-centre it
		// on the actor before handing the rig to another mode, then re-seat the ortho
		// camera around that anchor so its bearing and zoom survive the excursion.
		if (this._hasFollowAnchor) {
			this.controls.target.copy(this._followAnchor);
		}
		this.orthoCamera.position.copy(this.controls.target).add(this._orthoOffset);

		// _mode is still "follow" here (setMode swaps it after), so restore the
		// ortho pan limits explicitly rather than via applyTargetLimits.
		this.controls.cursor.copy(this._orthoCursor);
		this.controls.maxTargetRadius = this._orthoMaxTargetRadius;
	}

	/** Ramp orbit sensitivity with how zoomed-in the active orbit camera is, so
	 *  rotation feels consistent across zoom levels instead of twitchy up close.
	 *  The "out-ness" ratio is 1 at the default framing and shrinks as you zoom
	 *  in: the dolly-driven modes (perspective, follow) measure it from distance,
	 *  ortho from zoom factor. */
	private applyAdaptiveRotateSpeed(): void {
		// Dolly-driven modes (perspective, follow) measure out-ness from distance;
		// ortho measures it from zoom. Follow's reference is its entry distance, so
		// rotation gentles as you dolly in on the actor just as it does in
		// perspective.
		const dollyDriven = this._mode === "perspective" || this._mode === "follow";
		const outnessRatio = dollyDriven
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
