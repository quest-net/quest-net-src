// components/Map/MapModeController.ts
//
// The single MapSceneController that lets one persistent scene host every map
// camera. CameraRig owns the world cameras; this controller adds the actor-eye
// camera and coordinates the shared controlled-actor locomotion input used by
// First Person and Follow. Mode changes swap cameras/input in place without
// rebuilding the shared WebGL stack.
//
// Camera systems owned here:
//   - rig: CameraRig            -- world cameras + OrbitControls + freecam
//   - firstPersonCamera         -- consumes the shared locomotion body pose
//   - transitionCamera          -- perspective camera shown only during a tween
//
// ControlledActorLocomotion owns physics/sync/commit state and registers its
// frame callbacks here. This controller owns look state, camera placement, and
// pointer-lock + keyboard/mouse input for both actor-controlled camera modes.

import * as THREE from "three";
import { easeInOutCubic } from "../../utils/math";
import {
	CameraRig,
	type CameraRigConfig,
	type FollowLookAngles,
	type TerrainDims,
} from "../../utils/camera/CameraRig";
import {
	isActorCameraMode,
	type MapCameraMode,
	type RigCameraMode,
} from "../../utils/camera/CameraModes";
import {
	FIRST_PERSON_CAMERA,
	ACTOR_CONTROLS,
	ACTOR_CONTROL_KEY_CODES,
} from "./ActorCamera/constants";
import type { ActorLocomotionFrameInput } from "./ActorCamera/types";
import type { MapSceneController } from "./Terrain/hooks/useMapSceneCore";
import type { TrackedActorVisual } from "./Actors3D/actorTokenTypes";

export interface ActorLocomotionHandlers {
	onFrame: (now: number, dt: number, input: ActorLocomotionFrameInput) => void;
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
	return ACTOR_CONTROL_KEY_CODES.includes(
		code as (typeof ACTOR_CONTROL_KEY_CODES)[number]
	);
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
	private _cameraMode: MapCameraMode = "ortho";
	private _pointerLocked = false;
	private actorLookButtonHeld = false;
	private actorInputAttached = false;
	private viewportWidth = 1;
	private viewportHeight = 1;

	private readonly keys = new Set<string>();
	private actorLocomotionHandlers: ActorLocomotionHandlers | null = null;
	private readonly pointerLockListeners = new Set<(locked: boolean) => void>();
	private followActorVisual: TrackedActorVisual | null = null;
	private followAnchorOffsetY = 0;
	private readonly controlledActorBodyPosition = new THREE.Vector3();
	private hasControlledActorPose = false;
	private driveFollowVisual = false;
	private controlledActorEyeHeight = 0;
	private controlledActorPositionSmoothing: number =
		FIRST_PERSON_CAMERA.POSITION_SMOOTHING;
	private readonly desiredFirstPersonCameraPosition = new THREE.Vector3();
	private firstPersonCameraPositionInitialized = false;
	private actorLookYaw = 0;
	private actorLookPitch = 0;
	private localVisualOverrideApplied = false;
	/** The followed token's rendered world position, read fresh every frame. */
	private readonly followVisualAnchor = new THREE.Vector3();
	private readonly followEntryViewDirection = new THREE.Vector3();
	/** Allocation-free scratch. Never holds anything across a call. */
	private readonly tmpDirection = new THREE.Vector3();

	private tween:
		| { kind: "to-fp"; startPose: CameraPose; startTime: number }
		| {
				kind: "to-world";
				/** The rig mode being flown to. Carried on the tween so the handover
				 *  never has to widen `_cameraMode` back down to a rig mode. */
				mode: RigCameraMode;
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
				if (this._cameraMode !== "first-person" && !this.tween) {
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
		if (isActorCameraMode(this._cameraMode)) {
			// Step the shared capsule first, every frame -- including during an entry
			// tween -- so the eye camera, the rendered token and the rigid Follow
			// anchor all consume the same body pose within this render frame, and so
			// a tween always has a live target to lerp toward.
			this.actorLocomotionHandlers?.onFrame(now, dt, {
				pointerLocked: this._pointerLocked,
				keys: this.keys,
				yaw: this.actorLookYaw,
			});
		}
		if (this._cameraMode === "first-person") {
			this.syncFirstPersonCamera(dt);
			return;
		}
		// Follow presents that same capsule through the rig's third-person camera.
		if (this._cameraMode === "follow") this.syncFollowActorVisual();
		this.rig.update(dt);
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
		this.releaseActorControl();
		this.clearFollowLocalPosition();
		this.followActorVisual = null;
		this.pointerLockListeners.clear();
		this.detachActorInput();
		this.rig.dispose();
	}

	// --- Mode + camera-preference API ---------------------------------------

	get isPointerLocked(): boolean {
		return this._pointerLocked;
	}

	get cameraMode(): MapCameraMode {
		return this._cameraMode;
	}

	subscribePointerLock(listener: (locked: boolean) => void): () => void {
		this.pointerLockListeners.add(listener);
		listener(this._pointerLocked);
		return () => this.pointerLockListeners.delete(listener);
	}

	setActorLocomotionHandlers(handlers: ActorLocomotionHandlers | null): void {
		this.actorLocomotionHandlers = handlers;
	}

	setTerrain(terrain: TerrainDims | null): void {
		this.rig.setTerrain(terrain);
	}

	setFollowActorVisual(
		visual: TrackedActorVisual | null,
		anchorOffsetY = 0
	): void {
		if (this.followActorVisual !== visual && this.localVisualOverrideApplied) {
			this.followActorVisual?.setLocalPosition(null);
			this.localVisualOverrideApplied = false;
		}
		this.followActorVisual = visual;
		this.followAnchorOffsetY = anchorOffsetY;
		this.syncFollowActorVisual();
	}

	/** Publish the controlled actor's body pose. Clearing it (null) also disarms
	 *  the eye camera's position smoothing, so whoever re-arms the pose next --
	 *  a new actor, a new terrain, a remount -- snaps to it instead of gliding
	 *  across the map from the previous body. */
	setControlledActorPose(
		position: THREE.Vector3 | null,
		options: {
			eyeHeight?: number;
			positionSmoothing?: number;
			driveFollowVisual?: boolean;
		} = {}
	): void {
		this.hasControlledActorPose = position !== null;
		this.driveFollowVisual =
			position !== null && options.driveFollowVisual === true;
		if (!position) {
			this.firstPersonCameraPositionInitialized = false;
			return;
		}
		this.controlledActorBodyPosition.copy(position);
		this.controlledActorEyeHeight = options.eyeHeight ?? 0;
		this.controlledActorPositionSmoothing =
			options.positionSmoothing ?? FIRST_PERSON_CAMERA.POSITION_SMOOTHING;
	}

	/** Select any user-facing camera mode. `immediate` skips the First Person
	 *  transition and is used only for initial scene setup. */
	setCameraMode(mode: MapCameraMode, immediate = false): void {
		if (mode === this._cameraMode && !this.tween) return;
		const previous = this._cameraMode;
		this._cameraMode = mode;

		if (mode === "first-person") {
			this.enterFirstPerson(immediate);
			return;
		}

		if (previous === "first-person" || this.tween?.kind === "to-fp") {
			this.enterWorld(mode, immediate);
			return;
		}

		// Switching between rig-owned modes does not need a view tween.
		this.tween = null;
		if (previous === "follow") {
			this.releaseActorControl();
			this.detachActorInput();
			this.clearFollowLocalPosition();
		}
		if (mode === "follow") {
			this.attachActorInput();
			this.rig.activeCamera.getWorldDirection(this.followEntryViewDirection);
		}
		this.rig.controls.enabled = true;
		this.applyRigMode(mode);
	}

	// --- internals: mode transitions ----------------------------------------

	/** Hand a rig-owned mode to the rig. Follow additionally needs the bearing to
	 *  enter on, so it lands facing the way the outgoing camera was looking. */
	private applyRigMode(mode: RigCameraMode): void {
		this.rig.setMode(
			mode,
			undefined,
			mode === "follow" ? this.followEntryViewDirection : undefined
		);
	}

	private enterFirstPerson(immediate: boolean): void {
		const startPose = this.currentWorldPose();
		this.syncActorLookFromQuaternion(startPose.quaternion);
		this.attachActorInput();
		this.rig.controls.enabled = false;
		if (immediate) {
			this.tween = null;
			this.activate(this.firstPersonCamera);
			return;
		}
		applyPose(this.transitionCamera, startPose);
		this.activate(this.transitionCamera);
		this.tween = { kind: "to-fp", startPose, startTime: performance.now() };
	}

	private enterWorld(mode: RigCameraMode, immediate: boolean): void {
		if (mode === "follow") {
			this.firstPersonCamera.getWorldDirection(this.followEntryViewDirection);
		}
		this.releaseActorControl();
		if (mode === "follow") {
			this.attachActorInput();
		} else {
			this.detachActorInput();
			this.clearFollowLocalPosition();
		}
		if (immediate) {
			this.tween = null;
			this.rig.controls.enabled = true;
			this.applyRigMode(mode);
			return;
		}
		const startPose = capturePose(this.firstPersonCamera);
		const endPose = this.worldDestinationPose(mode);
		applyPose(this.transitionCamera, startPose);
		this.activate(this.transitionCamera);
		this.tween = {
			kind: "to-world",
			mode,
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
		// the capsule settles a frame or two after the switch begins. The follow
		// destination is read live for the same reason: the actor can move during
		// the fly-out, and a fixed endpoint would leave a snap at the handover.
		const endPose =
			tween.kind === "to-fp"
				? capturePose(this.firstPersonCamera)
				: tween.mode === "follow"
					? capturePose(
							this.rig.followEntryCamera(this.followEntryViewDirection)
						)
					: tween.endPose;
		lerpPose(this.transitionCamera, tween.startPose, endPose, eased);
		if (t < 1) return;

		this.tween = null;
		if (tween.kind === "to-fp") {
			this.activate(this.firstPersonCamera);
		} else {
			this.rig.controls.enabled = true;
			this.applyRigMode(tween.mode);
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
		// Perspective/freecam/follow: the active world camera already IS the shared
		// perspective camera, so the tween can start from it verbatim -- including
		// follow's own FOV, which capturePose carries.
		return capturePose(this.rig.perspectiveCamera);
	}

	/** Perspective pose the rig-owned mode will settle into after the exit tween
	 *  completes and the rig applies that mode. Used as the END of the
	 *  leave-FP tween so it lands exactly where the world camera comes to rest. */
	private worldDestinationPose(mode: RigCameraMode): CameraPose {
		if (mode === "ortho") {
			// setMode("ortho") preserves the orthographic framing across the FP
			// excursion, so the destination is the matched perspective of that view.
			return this.matchedOrthoPose();
		}
		if (mode === "follow") {
			// Follow reframes around the ANCHOR at its actor-scaled distance and FOV.
			// perspectiveEntryCamera() would land at the terrain-scaled distance with
			// the wide perspective FOV, then snap the moment setMode takes over.
			return capturePose(
				this.rig.followEntryCamera(this.followEntryViewDirection)
			);
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

	private syncFollowActorVisual(): void {
		const visual = this.followActorVisual;
		if (!visual) return;

		if (this.driveFollowVisual) {
			visual.setLocalPosition(this.controlledActorBodyPosition);
			this.localVisualOverrideApplied = true;
		} else if (this.localVisualOverrideApplied) {
			visual.setLocalPosition(null);
			this.localVisualOverrideApplied = false;
		}

		visual.object.updateWorldMatrix(true, false);
		visual.object.getWorldPosition(this.followVisualAnchor);
		this.followVisualAnchor.y += this.followAnchorOffsetY;
		this.rig.setFollowAnchor(this.followVisualAnchor);
	}

	private clearFollowLocalPosition(): void {
		this.driveFollowVisual = false;
		if (!this.localVisualOverrideApplied) return;
		this.followActorVisual?.setLocalPosition(null);
		this.localVisualOverrideApplied = false;
	}

	private syncFirstPersonCamera(dt: number): void {
		if (!this.hasControlledActorPose) return;
		this.desiredFirstPersonCameraPosition.set(
			this.controlledActorBodyPosition.x,
			this.controlledActorBodyPosition.y + this.controlledActorEyeHeight,
			this.controlledActorBodyPosition.z
		);
		if (!this.firstPersonCameraPositionInitialized || dt <= 0) {
			this.firstPersonCamera.position.copy(
				this.desiredFirstPersonCameraPosition
			);
			this.firstPersonCameraPositionInitialized = true;
		} else {
			const alpha =
				1 - Math.exp(-this.controlledActorPositionSmoothing * dt);
			this.firstPersonCamera.position.lerp(
				this.desiredFirstPersonCameraPosition,
				alpha
			);
			if (
				this.firstPersonCamera.position.distanceToSquared(
					this.desiredFirstPersonCameraPosition
				) < 0.000001
			) {
				this.firstPersonCamera.position.copy(
					this.desiredFirstPersonCameraPosition
				);
			}
		}
		this.applyActorLookToFirstPersonCamera();
	}

	private applyActorLookToFirstPersonCamera(): void {
		this.firstPersonCamera.rotation.order = "YXZ";
		this.firstPersonCamera.rotation.y = this.actorLookYaw;
		this.firstPersonCamera.rotation.x = this.actorLookPitch;
	}

	private syncActorLookFromQuaternion(quaternion: THREE.Quaternion): void {
		const forward = this.tmpDirection.set(0, 0, -1).applyQuaternion(quaternion);
		this.actorLookYaw = Math.atan2(-forward.x, -forward.z);
		this.actorLookPitch = Math.asin(THREE.MathUtils.clamp(forward.y, -1, 1));
		this.applyActorLookToFirstPersonCamera();
	}

	private setActorLook(look: FollowLookAngles): void {
		this.actorLookYaw = look.yaw;
		this.actorLookPitch = look.pitch;
	}

	// --- internals: controlled-actor input ----------------------------------

	private attachActorInput(): void {
		if (this.actorInputAttached) return;
		this.actorInputAttached = true;
		document.addEventListener("pointerlockchange", this.onPointerLockChange);
		document.addEventListener("pointerlockerror", this.onPointerLockError);
		this.domElement.addEventListener("contextmenu", this.onContextMenu);
		this.domElement.addEventListener("pointerdown", this.onPointerDown);
		window.addEventListener("pointerup", this.onPointerUp);
		window.addEventListener("mousemove", this.onMouseMove);
		window.addEventListener("keydown", this.onKeyDown);
		window.addEventListener("keyup", this.onKeyUp);
	}

	private detachActorInput(): void {
		if (!this.actorInputAttached) return;
		this.actorInputAttached = false;
		document.removeEventListener("pointerlockchange", this.onPointerLockChange);
		document.removeEventListener("pointerlockerror", this.onPointerLockError);
		this.domElement.removeEventListener("contextmenu", this.onContextMenu);
		this.domElement.removeEventListener("pointerdown", this.onPointerDown);
		window.removeEventListener("pointerup", this.onPointerUp);
		window.removeEventListener("mousemove", this.onMouseMove);
		window.removeEventListener("keydown", this.onKeyDown);
		window.removeEventListener("keyup", this.onKeyUp);
		this.actorLookButtonHeld = false;
		this.keys.clear();
	}

	private releaseActorControl(): void {
		this.actorLookButtonHeld = false;
		this.keys.clear();
		if (document.pointerLockElement === this.domElement) {
			document.exitPointerLock();
		}
		this.actorLocomotionHandlers?.onControlReleased();
	}

	private readonly onPointerLockChange = (): void => {
		const locked = document.pointerLockElement === this.domElement;
		// Pointer-lock acquisition can resolve after a very quick right-button
		// release. Do not leave the cursor trapped when the user is no longer
		// holding the control button.
		if (locked && !this.actorLookButtonHeld) {
			document.exitPointerLock();
			return;
		}
		this._pointerLocked = locked;
		for (const listener of this.pointerLockListeners) listener(locked);
		if (this._cameraMode === "follow") {
			this.rig.controls.enabled = !locked;
		}
		if (!locked) {
			this.actorLookButtonHeld = false;
			this.keys.clear();
			this.actorLocomotionHandlers?.onControlReleased();
		}
	};

	private readonly onPointerLockError = (): void => {
		this.actorLookButtonHeld = false;
		this._pointerLocked = false;
		this.keys.clear();
		if (this._cameraMode === "follow") {
			this.rig.controls.enabled = true;
		}
		for (const listener of this.pointerLockListeners) listener(false);
		this.actorLocomotionHandlers?.onControlReleased();
	};

	private readonly onContextMenu = (event: MouseEvent): void => {
		event.preventDefault();
	};

	private readonly onPointerDown = (event: PointerEvent): void => {
		if (event.button !== 2) return;
		event.preventDefault();
		this.actorLookButtonHeld = true;
		if (this._cameraMode === "follow") {
			// Seed look state from wherever the orbit camera is sitting, so taking
			// pointer lock does not jump the view.
			this.setActorLook(this.rig.getFollowLookAngles());
			this.rig.controls.enabled = false;
		}
		try {
			void this.domElement.requestPointerLock().catch(this.onPointerLockError);
		} catch {
			this.onPointerLockError();
		}
	};

	private readonly onPointerUp = (event: PointerEvent): void => {
		if (event.button !== 2) return;
		event.preventDefault();
		this.actorLookButtonHeld = false;
		this.keys.clear();
		this.actorLocomotionHandlers?.onControlReleased();
		if (document.pointerLockElement === this.domElement) {
			document.exitPointerLock();
		}
	};

	private readonly onMouseMove = (event: MouseEvent): void => {
		if (document.pointerLockElement !== this.domElement) return;
		if (this._cameraMode === "follow") {
			// The boom rotation IS the look, so take the angles it returns rather
			// than reading them back off the camera.
			this.setActorLook(
				this.rig.rotateFollowByPointerDelta(
					event.movementX,
					event.movementY,
					ACTOR_CONTROLS.MOUSE_SENSITIVITY
				)
			);
		} else {
			this.actorLookYaw -=
				event.movementX * ACTOR_CONTROLS.MOUSE_SENSITIVITY;
			this.actorLookPitch = THREE.MathUtils.clamp(
				this.actorLookPitch -
					event.movementY * ACTOR_CONTROLS.MOUSE_SENSITIVITY,
				-FIRST_PERSON_CAMERA.PITCH_LIMIT,
				FIRST_PERSON_CAMERA.PITCH_LIMIT
			);
			this.applyActorLookToFirstPersonCamera();
		}
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
