import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import {
	useMapSceneCore,
	type MapSceneController,
	type MapSceneControllerContext,
} from "../Terrain/hooks/useMapSceneCore";
import { FIRST_PERSON_CAMERA, FIRST_PERSON_KEY_CODES } from "./constants";
import type { FirstPersonFrameInput } from "./types";

interface FirstPersonSceneHandlers {
	onFrame: (now: number, dt: number, input: FirstPersonFrameInput) => void;
	onLookDelta: (movementX: number, movementY: number) => void;
	onControlReleased: () => void;
}

interface FirstPersonSceneState {
	sceneResources: ThreeDSceneResources | null;
	isPointerLocked: boolean;
	cameraRef: RefObject<THREE.PerspectiveCamera | null>;
	directionalLightRef: RefObject<THREE.DirectionalLight | null>;
}

function isMovementKey(code: string): boolean {
	return FIRST_PERSON_KEY_CODES.includes(
		code as (typeof FIRST_PERSON_KEY_CODES)[number]
	);
}

function formatTriangleStats(info: THREE.WebGLRenderer["info"]): string {
	return `TRIS ${info.render.triangles.toLocaleString()}`;
}

export function useFirstPersonScene(
	containerRef: RefObject<HTMLDivElement | null>,
	handlers: FirstPersonSceneHandlers,
	cameraRef: RefObject<THREE.PerspectiveCamera | null>,
	directionalLightRef: RefObject<THREE.DirectionalLight | null>,
	performanceMode = false
): FirstPersonSceneState {
	const keysRef = useRef(new Set<string>());
	const handlersRef = useRef(handlers);
	const [isPointerLocked, setIsPointerLocked] = useState(false);

	useEffect(() => {
		handlersRef.current = handlers;
	}, [handlers]);

	// The capsule walking controller: a single perspective camera plus pointer-
	// lock + keyboard/mouse input. The shared core owns the renderer/scene/lights/
	// post-processing/pre-warm/RAF/resize/stats; this just wires FP-specific bits.
	const createController = (
		ctx: MapSceneControllerContext
	): MapSceneController => {
		const { renderer, container } = ctx;

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const camera = new THREE.PerspectiveCamera(
			FIRST_PERSON_CAMERA.FOV,
			aspect,
			FIRST_PERSON_CAMERA.NEAR,
			FIRST_PERSON_CAMERA.FAR
		);
		camera.rotation.order = "YXZ";
		cameraRef.current = camera;

		const releaseControl = () => {
			keysRef.current.clear();
			handlersRef.current.onControlReleased();
		};

		const onPointerLockChange = () => {
			const locked = document.pointerLockElement === renderer.domElement;
			setIsPointerLocked(locked);
			if (!locked) {
				releaseControl();
			}
		};

		const onContextMenu = (event: MouseEvent) => {
			event.preventDefault();
		};

		const onPointerDown = (event: PointerEvent) => {
			if (event.button !== 2) return;
			event.preventDefault();
			renderer.domElement.requestPointerLock();
		};

		const onPointerUp = (event: PointerEvent) => {
			if (event.button !== 2) return;
			event.preventDefault();
			releaseControl();
			if (document.pointerLockElement === renderer.domElement) {
				document.exitPointerLock();
			}
		};

		const onMouseMove = (event: MouseEvent) => {
			if (document.pointerLockElement !== renderer.domElement) return;
			handlersRef.current.onLookDelta(event.movementX, event.movementY);
		};

		const onKeyDown = (event: KeyboardEvent) => {
			if (document.pointerLockElement !== renderer.domElement) return;
			if (!isMovementKey(event.code)) return;
			keysRef.current.add(event.code);
			event.preventDefault();
		};

		const onKeyUp = (event: KeyboardEvent) => {
			if (!isMovementKey(event.code)) return;
			keysRef.current.delete(event.code);
			event.preventDefault();
		};

		document.addEventListener("pointerlockchange", onPointerLockChange);
		renderer.domElement.addEventListener("contextmenu", onContextMenu);
		renderer.domElement.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);

		return {
			camera,
			onFrame: (now, dt) => {
				const pointerLocked =
					document.pointerLockElement === renderer.domElement;
				handlersRef.current.onFrame(now, dt, {
					pointerLocked,
					keys: keysRef.current,
				});
			},
			onResize: (width, height) => {
				camera.aspect = width / height;
				camera.updateProjectionMatrix();
			},
			dispose: (resources) => {
				document.removeEventListener("pointerlockchange", onPointerLockChange);
				renderer.domElement.removeEventListener("contextmenu", onContextMenu);
				renderer.domElement.removeEventListener("pointerdown", onPointerDown);
				window.removeEventListener("pointerup", onPointerUp);
				window.removeEventListener("mousemove", onMouseMove);
				window.removeEventListener("keydown", onKeyDown);
				window.removeEventListener("keyup", onKeyUp);
				if (document.pointerLockElement === renderer.domElement) {
					document.exitPointerLock();
				}
				// FP never routes movementHighlight through useTerrainMeshes, so it owns
				// the (1,1,1) placeholder created by the core.
				resources.movementHighlight.texture.dispose();
				cameraRef.current = null;
			},
		};
	};

	const { sceneResources } = useMapSceneCore(containerRef, {
		performanceMode,
		movementHighlightVariants: false,
		directionalLightRef,
		createController,
		triangleStatsWidth: "80px",
		formatTriangleStats,
		maxDeltaSeconds: 0.05,
	});

	return {
		sceneResources,
		isPointerLocked,
		cameraRef,
		directionalLightRef,
	};
}
