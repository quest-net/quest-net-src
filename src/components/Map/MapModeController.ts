// components/Map/MapModeController.ts
//
// The single MapSceneController that lets one persistent scene host BOTH the
// world view (isometric/perspective/freecam, via CameraRig) and the
// first-person view (a capsule-driven PerspectiveCamera). The shared scene
// bootstrap (useMapSceneCore) creates exactly one of these at mount; toggling
// the view mode swaps the active camera + input in place instead of tearing
// down and rebuilding the WebGL stack -- which is what eliminates the switch
// stutter.
//
// Camera systems owned here:
//   - rig: CameraRig            -- world cameras + OrbitControls + freecam
//   - firstPersonCamera         -- driven by the FP capsule sim (FirstPersonView)
//   - transitionCamera          -- perspective camera shown only during a tween
//
// The FP per-frame simulation, look, and control-release logic live in
// FirstPersonView (React); it registers them here via setFirstPersonHandlers and
// reads firstPersonCamera to position the eye. The pointer-lock + keyboard/mouse
// input wiring is lifted from the old useFirstPersonScene controller and is
// attached only while first-person mode is active.

import * as THREE from "three";
import {
	CameraRig,
	type CameraMode,
	type CameraRigConfig,
	type TerrainDims,
} from "../../utils/camera/CameraRig";
import { FIRST_PERSON_CAMERA, FIRST_PERSON_KEY_CODES } from "./FirstPerson/constants";
import type { FirstPersonFrameInput } from "./FirstPerson/types";
import type { MapSceneController } from "./Terrain/hooks/useMapSceneCore";

export type MapViewMode = "world" | "first-person";

export interface FirstPersonInputHandlers {
	onFrame: (now: number, dt: number, input: FirstPersonFrameInput) => void;
	onLookDelta: (movementX: number, movementY: number) => void;
	onControlReleased: () => void;
}

interface CameraPose {
	position: THREE.Vector3;
	quaternion: THREE.Quaternion;
	fov: number;
}

// Tween length for the iso <-> eye fly-through. Short enough to feel snappy,
// long enough to read as a transition rather than a cut.
const VIEW_TWEEN_DURATION_MS = 400;

function isMovementKey(code: string): boolean {
	return FIRST_PERSON_KEY_CODES.includes(
		code as (typeof FIRST_PERSON_KEY_CODES)[number]
	);
}

function easeInOutCubic(t: number): number {
	return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function capturePose(camera: THREE.PerspectiveCamera): CameraPose {
	return {
		position: camera.position.clone(),
		quaternion: camera.quaternion.clone(),
		fov: camera.fov,
	};
}

function applyPose(camera: THREE.PerspectiveCamera, pose: CameraPose): void {
	camera.position.copy(pose.position);
	camera.quaternion.copy(pose.quaternion);
	if (camera.fov !== pose.fov) {
		camera.fov = pose.fov;
		camera.updateProjectionMatrix();
	}
}

function lerpPose(
	camera: THREE.PerspectiveCamera,
	from: CameraPose,
	to: CameraPose,
	t: number
): void {
	camera.position.lerpVectors(from.position, to.position, t);
	camera.quaternion.copy(from.quaternion).slerp(to.quaternion, t);
	const fov = from.fov + (to.fov - from.fov) * t;
	camera.fov = fov;
	camera.updateProjectionMatrix();
}

export class MapModeController implements MapSceneController {
	readonly rig: CameraRig;
	readonly firstPersonCamera: THREE.PerspectiveCamera;
	private readonly transitionCamera: THREE.PerspectiveCamera;
	private readonly domElement: HTMLElement;
	private readonly setActiveCameraCb: (camera: THREE.Camera) => void;

	private _activeCamera!: THREE.Camera;
	private _viewMode: MapViewMode = "world";
	private _worldPreference: CameraMode = "ortho";
	private _pointerLocked = false;
	private fpInputAttached = false;
	private viewportWidth = 1;
	private viewportHeight = 1;

	private readonly keys = new Set<string>();
	private fpHandlers: FirstPersonInputHandlers | null = null;
	private pointerLockListener: ((locked: boolean) => void) | null = null;

	private tween:
		| { kind: "to-fp"; startPose: CameraPose; startTime: number }
		| {
				kind: "to-world";
				startPose: CameraPose;
				endPose: CameraPose;
				startTime: number;
		  }
		| null = null;

	constructor(
		domElement: HTMLElement,
		aspect: number,
		rigConfig: CameraRigConfig,
		setActiveCamera: (camera: THREE.Camera) => void
	) {
		this.domElement = domElement;
		this.setActiveCameraCb = setActiveCamera;

		this.rig = new CameraRig(domElement, aspect, rigConfig, {
			onActiveCameraChange: (cam) => {
				// Only honour rig-driven camera swaps while the rig actually owns the
				// active camera (world mode, not mid-tween). During a tween the
				// transition camera is active and we call setActiveCamera ourselves.
				if (this._viewMode === "world" && !this.tween) {
					this.activate(cam);
				}
			},
		});
		this.rig.attachInput();

		this.firstPersonCamera = new THREE.PerspectiveCamera(
			FIRST_PERSON_CAMERA.FOV,
			aspect,
			FIRST_PERSON_CAMERA.NEAR,
			FIRST_PERSON_CAMERA.FAR
		);
		this.firstPersonCamera.rotation.order = "YXZ";

		this.transitionCamera = new THREE.PerspectiveCamera(
			rigConfig.perspective.fov,
			aspect,
			rigConfig.perspective.near,
			rigConfig.perspective.far
		);

		this.viewportWidth = aspect;
		this.viewportHeight = 1;
		this._activeCamera = this.rig.orthoCamera;
	}

	// --- MapSceneController interface ---------------------------------------

	get camera(): THREE.Camera {
		return this._activeCamera;
	}

	onFrame(now: number, dt: number): void {
		if (this.tween) {
			this.advanceTween(now);
		}
		if (this._viewMode === "first-person") {
			// Run the FP capsule sim every frame -- including during the entry tween
			// -- so firstPersonCamera tracks the eye position and the tween has a
			// live target to lerp toward.
			this.fpHandlers?.onFrame(now, dt, {
				pointerLocked: this._pointerLocked,
				keys: this.keys,
			});
		} else {
			this.rig.update(dt);
		}
	}

	onResize(width: number, height: number): void {
		this.viewportWidth = width || 1;
		this.viewportHeight = height || 1;
		const aspect = this.viewportWidth / this.viewportHeight;
		this.rig.resize(width, height);
		this.firstPersonCamera.aspect = aspect;
		this.firstPersonCamera.updateProjectionMatrix();
		this.transitionCamera.aspect = aspect;
		this.transitionCamera.updateProjectionMatrix();
	}

	dispose(): void {
		this.detachFirstPersonInput();
		this.rig.dispose();
	}

	// --- Mode + camera-preference API ---------------------------------------

	get isPointerLocked(): boolean {
		return this._pointerLocked;
	}

	setPointerLockListener(listener: ((locked: boolean) => void) | null): void {
		this.pointerLockListener = listener;
	}

	setFirstPersonHandlers(handlers: FirstPersonInputHandlers | null): void {
		this.fpHandlers = handlers;
	}

	setTerrain(terrain: TerrainDims | null): void {
		this.rig.setTerrain(terrain);
	}

	/** Apply the world camera preference (ortho/perspective/freecam). It is stored
	 *  and re-applied when returning from first-person; it only takes immediate
	 *  effect in world mode while not mid-tween. */
	setWorldCameraPreference(preference: CameraMode): void {
		this._worldPreference = preference;
		if (this._viewMode === "world" && !this.tween) {
			this.rig.setMode(preference);
		}
	}

	/** Switch the active view. `immediate` skips the tween (used for the first
	 *  framing of a terrain). */
	setViewMode(mode: MapViewMode, immediate = false): void {
		if (mode === this._viewMode && !this.tween) return;
		if (mode === "first-person") {
			this.enterFirstPerson(immediate);
		} else {
			this.enterWorld(immediate);
		}
	}

	// --- internals: mode transitions ----------------------------------------

	private enterFirstPerson(immediate: boolean): void {
		this._viewMode = "first-person";
		this.attachFirstPersonInput();
		this.rig.controls.enabled = false;
		if (immediate) {
			this.tween = null;
			this.activate(this.firstPersonCamera);
			return;
		}
		const startPose = this.currentWorldPose();
		applyPose(this.transitionCamera, startPose);
		this.activate(this.transitionCamera);
		this.tween = { kind: "to-fp", startPose, startTime: performance.now() };
	}

	private enterWorld(immediate: boolean): void {
		this._viewMode = "world";
		this.releaseFirstPersonControl();
		this.detachFirstPersonInput();
		if (immediate) {
			this.tween = null;
			this.rig.controls.enabled = true;
			this.rig.setMode(this._worldPreference);
			return;
		}
		const startPose = capturePose(this.firstPersonCamera);
		const endPose = this.worldDestinationPose();
		applyPose(this.transitionCamera, startPose);
		this.activate(this.transitionCamera);
		this.tween = {
			kind: "to-world",
			startPose,
			endPose,
			startTime: performance.now(),
		};
	}

	private advanceTween(now: number): void {
		const tween = this.tween;
		if (!tween) return;
		const t = Math.min(1, (now - tween.startTime) / VIEW_TWEEN_DURATION_MS);
		const eased = easeInOutCubic(t);
		// For the FP-bound tween the end pose is read live so it converges even if
		// the capsule settles a frame or two after the switch begins.
		const endPose =
			tween.kind === "to-fp" ? capturePose(this.firstPersonCamera) : tween.endPose;
		lerpPose(this.transitionCamera, tween.startPose, endPose, eased);
		if (t < 1) return;

		this.tween = null;
		if (tween.kind === "to-fp") {
			this.activate(this.firstPersonCamera);
		} else {
			this.rig.controls.enabled = true;
			this.rig.setMode(this._worldPreference);
		}
	}

	/** Perspective pose matching what the world view is showing on screen RIGHT NOW.
	 *  Used as the START of the enter-FP tween so it begins exactly where the world
	 *  camera sits -- with the user's current zoom/pan/orbit -- instead of jumping to
	 *  a recomputed default framing on the first frame. */
	private currentWorldPose(): CameraPose {
		if (this.rig.mode === "ortho") {
			return this.matchedOrthoPose();
		}
		// Perspective/freecam: the active world camera already IS a perspective
		// camera, so the tween can start from it verbatim.
		return capturePose(this.rig.perspectiveCamera);
	}

	/** Perspective pose the world view will settle into after the enter-world tween
	 *  completes and the rig re-applies the world preference. Used as the END of the
	 *  leave-FP tween so it lands exactly where the world camera comes to rest. */
	private worldDestinationPose(): CameraPose {
		if (this._worldPreference === "ortho") {
			// setMode("ortho") preserves the orthographic framing across the FP
			// excursion, so the destination is the matched perspective of that view.
			return this.matchedOrthoPose();
		}
		// Perspective/freecam re-entry reframes to the standard entry framing, so the
		// tween must end there to avoid a snap when the rig takes over.
		return capturePose(this.rig.perspectiveEntryCamera());
	}

	/** A perspective viewpoint that frames the same content as the CURRENT
	 *  orthographic view: same view direction, positioned so the perspective
	 *  frustum's vertical extent at the orbit target equals the ortho frustum's
	 *  extent at its present zoom. Tweening to/from this avoids a jump because it
	 *  tracks the user's live zoom/pan/orbit rather than a recomputed default. */
	private matchedOrthoPose(): CameraPose {
		const ortho = this.rig.orthoCamera;
		const persp = this.rig.perspectiveCamera;
		const target = this.rig.controls.target;

		// On-screen vertical half-extent of the ortho frustum at the current zoom.
		const halfExtent = ortho.top / (ortho.zoom || 1);
		const dist = halfExtent / Math.tan(THREE.MathUtils.degToRad(persp.fov) / 2);

		const dir = new THREE.Vector3().subVectors(ortho.position, target);
		if (dir.lengthSq() === 0) dir.set(1, 1, 1);
		dir.normalize();

		const position = new THREE.Vector3().copy(target).addScaledVector(dir, dist);
		const lookMatrix = new THREE.Matrix4().lookAt(position, target, persp.up);
		const quaternion = new THREE.Quaternion().setFromRotationMatrix(lookMatrix);
		return { position, quaternion, fov: persp.fov };
	}

	private activate(camera: THREE.Camera): void {
		this._activeCamera = camera;
		this.setActiveCameraCb(camera);
	}

	// --- internals: first-person input --------------------------------------

	private attachFirstPersonInput(): void {
		if (this.fpInputAttached) return;
		this.fpInputAttached = true;
		document.addEventListener("pointerlockchange", this.onPointerLockChange);
		this.domElement.addEventListener("contextmenu", this.onContextMenu);
		this.domElement.addEventListener("pointerdown", this.onPointerDown);
		window.addEventListener("pointerup", this.onPointerUp);
		window.addEventListener("mousemove", this.onMouseMove);
		window.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("keyup", this.onKeyUp);
	}

	private detachFirstPersonInput(): void {
		if (!this.fpInputAttached) return;
		this.fpInputAttached = false;
		document.removeEventListener("pointerlockchange", this.onPointerLockChange);
		this.domElement.removeEventListener("contextmenu", this.onContextMenu);
		this.domElement.removeEventListener("pointerdown", this.onPointerDown);
		window.removeEventListener("pointerup", this.onPointerUp);
		window.removeEventListener("mousemove", this.onMouseMove);
		window.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("keyup", this.onKeyUp);
		this.keys.clear();
	}

	private releaseFirstPersonControl(): void {
		this.keys.clear();
		if (document.pointerLockElement === this.domElement) {
			document.exitPointerLock();
		}
		this.fpHandlers?.onControlReleased();
	}

	private readonly onPointerLockChange = (): void => {
		const locked = document.pointerLockElement === this.domElement;
		this._pointerLocked = locked;
		this.pointerLockListener?.(locked);
		if (!locked) {
			this.keys.clear();
			this.fpHandlers?.onControlReleased();
		}
	};

	private readonly onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};

	private readonly onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 2) return;
		event.preventDefault();
		this.domElement.requestPointerLock();
	};

	private readonly onPointerUp = (event: PointerEvent): void => {
		if (event.button !== 2) return;
		event.preventDefault();
		this.keys.clear();
		this.fpHandlers?.onControlReleased();
		if (document.pointerLockElement === this.domElement) {
			document.exitPointerLock();
		}
	};

	private readonly onMouseMove = (event: MouseEvent): void => {
		if (document.pointerLockElement !== this.domElement) return;
		this.fpHandlers?.onLookDelta(event.movementX, event.movementY);
	};

	private readonly onKeyDown = (event: KeyboardEvent): void => {
		if (document.pointerLockElement !== this.domElement) return;
		if (!isMovementKey(event.code)) return;
		this.keys.add(event.code);
		event.preventDefault();
	};

	private readonly onKeyUp = (event: KeyboardEvent): void => {
		if (!isMovementKey(event.code)) return;
		this.keys.delete(event.code);
		event.preventDefault();
	};
}
