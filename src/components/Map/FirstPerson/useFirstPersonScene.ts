import { useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import { createThreeDMapPostProcessing } from "../mapPostProcessing";
import {
	THREE_D_MAP_LIGHTING,
	THREE_D_MAP_RENDERER,
	THREE_D_MAP_SHADOW,
} from "../threeDMapConstants";
import {
	FIRST_PERSON_CAMERA,
	FIRST_PERSON_KEY_CODES,
} from "./constants";
import type { FirstPersonFrameInput } from "./types";
import {
	createMovementHighlightTexture,
	createDummyTerrainGeometry,
	createPlaceholderVoxelAoTexture,
	TERRAIN_MATERIAL_REGISTRY,
} from "../Terrain/materials";

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

export function useFirstPersonScene(
	containerRef: RefObject<HTMLDivElement | null>,
	handlers: FirstPersonSceneHandlers,
	cameraRef: RefObject<THREE.PerspectiveCamera | null>,
	directionalLightRef: RefObject<THREE.DirectionalLight | null>
): FirstPersonSceneState {
	const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const statsRef = useRef<any>(null);
	const triangleStatsRef = useRef<HTMLDivElement | null>(null);
	const keysRef = useRef(new Set<string>());
	const handlersRef = useRef(handlers);
	const [sceneResources, setSceneResources] =
		useState<ThreeDSceneResources | null>(null);
	const [isPointerLocked, setIsPointerLocked] = useState(false);

	useEffect(() => {
		handlersRef.current = handlers;
	}, [handlers]);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(
			Math.min(window.devicePixelRatio, THREE_D_MAP_RENDERER.MAX_PIXEL_RATIO)
		);
		renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.info.autoReset = false;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.autoUpdate = false;
		renderer.shadowMap.needsUpdate = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		container.appendChild(renderer.domElement);
		rendererRef.current = renderer;

		const stats = new Stats();
		stats.showPanel(0);
		stats.dom.style.position = "absolute";
		stats.dom.style.top = "0px";
		stats.dom.style.left = "0px";
		stats.dom.style.display = "none";
		container.appendChild(stats.dom);
		statsRef.current = stats;

		const triangleStats = document.createElement("div");
		triangleStats.style.position = "absolute";
		triangleStats.style.top = "48px";
		triangleStats.style.left = "0px";
		triangleStats.style.width = "80px";
		triangleStats.style.boxSizing = "border-box";
		triangleStats.style.padding = "2px 3px";
		triangleStats.style.background = "rgba(0, 0, 0, 0.8)";
		triangleStats.style.color = "#0ff";
		triangleStats.style.font = "bold 9px Helvetica, Arial, sans-serif";
		triangleStats.style.lineHeight = "11px";
		triangleStats.style.pointerEvents = "none";
		triangleStats.style.display = "none";
		triangleStats.textContent = "TRIS 0";
		container.appendChild(triangleStats);
		triangleStatsRef.current = triangleStats;

		const scene = new THREE.Scene();
		scene.background = null;

		const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
		const camera = new THREE.PerspectiveCamera(
			FIRST_PERSON_CAMERA.FOV,
			aspect,
			FIRST_PERSON_CAMERA.NEAR,
			FIRST_PERSON_CAMERA.FAR
		);
		camera.rotation.order = "YXZ";
		cameraRef.current = camera;

		const hemi = new THREE.HemisphereLight(
			THREE_D_MAP_LIGHTING.HEMISPHERE_SKY_COLOR,
			THREE_D_MAP_LIGHTING.HEMISPHERE_GROUND_COLOR,
			Math.PI * THREE_D_MAP_LIGHTING.HEMISPHERE_INTENSITY_MULTIPLIER
		);
		scene.add(hemi);

		const dirLight = new THREE.DirectionalLight(
			THREE_D_MAP_LIGHTING.DIRECTIONAL_COLOR,
			Math.PI * THREE_D_MAP_LIGHTING.DIRECTIONAL_INTENSITY_MULTIPLIER
		);
		dirLight.castShadow = true;
		dirLight.shadow.mapSize.set(
			THREE_D_MAP_SHADOW.MAP_SIZE,
			THREE_D_MAP_SHADOW.MAP_SIZE
		);
		dirLight.shadow.bias = THREE_D_MAP_SHADOW.BIAS;
		dirLight.shadow.normalBias = THREE_D_MAP_SHADOW.NORMAL_BIAS;
		scene.add(dirLight);
		scene.add(dirLight.target);
		directionalLightRef.current = dirLight;

		const postProcessing = createThreeDMapPostProcessing(renderer, scene, camera);

		const resources: ThreeDSceneResources = {
			scene,
			camera,
			domElement: renderer.domElement,
			occlusionTargets: [],
			movementHighlight: createMovementHighlightTexture(1, 1, 1),
			animationCallbacks: new Set(),
			requestShadowUpdate: () => {
				renderer.shadowMap.needsUpdate = true;
			},
			actorPickTargets: [],
			dragState: { active: false },
		};

		// Pre-warm: compile every registered shader variant so no stutter on first
		// terrain frame. FP view only needs the no-highlight variants.
		let cancelled = false;
		void (async () => {
			const dummyGeo = createDummyTerrainGeometry();
			const dummyVoxelAo = createPlaceholderVoxelAoTexture();
			const warmMeshes: THREE.Mesh[] = [];
			for (const [, factory] of TERRAIN_MATERIAL_REGISTRY) {
				const result = factory({ acceptsMovementHighlight: false, voxelAo: dummyVoxelAo });
				const warmMesh = new THREE.Mesh(dummyGeo, result.material);
				scene.add(warmMesh);
				warmMeshes.push(warmMesh);
			}
			await renderer.compileAsync(scene, camera);
			if (cancelled) {
				dummyVoxelAo.texture.dispose();
				return;
			}
			for (const warmMesh of warmMeshes) scene.remove(warmMesh);
			dummyVoxelAo.texture.dispose();
			// Warm geometry and materials are intentionally left undisposed so the
			// compiled WebGL programs stay resident in the driver cache.
			setSceneResources(resources);
		})();

		let lastFrame = performance.now();
		let rafId = 0;
		const animate = (now: number) => {
			rafId = requestAnimationFrame(animate);
			const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000));
			lastFrame = now;

			const pointerLocked = document.pointerLockElement === renderer.domElement;
			handlersRef.current.onFrame(now, dt, {
				pointerLocked,
				keys: keysRef.current,
			});
			for (const callback of resources.animationCallbacks) {
				callback(now);
			}
			stats.begin();
			renderer.info.reset();
			postProcessing.render();
			if (triangleStats.style.display !== "none") {
				triangleStats.textContent = `TRIS ${renderer.info.render.triangles.toLocaleString()}`;
			}
			stats.end();
		};
		rafId = requestAnimationFrame(animate);

		const updateCameraProjection = () => {
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (w === 0 || h === 0) return;
			camera.aspect = w / h;
			camera.updateProjectionMatrix();
			postProcessing.setSize(w, h);
		};

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

		const ro = new ResizeObserver(updateCameraProjection);
		ro.observe(container);
		document.addEventListener("pointerlockchange", onPointerLockChange);
		renderer.domElement.addEventListener("contextmenu", onContextMenu);
		renderer.domElement.addEventListener("pointerdown", onPointerDown);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("mousemove", onMouseMove);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("keyup", onKeyUp);

		return () => {
			cancelled = true;
			setSceneResources(null);
			cancelAnimationFrame(rafId);
			ro.disconnect();
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
			resources.movementHighlight.texture.dispose();
			cameraRef.current = null;
			directionalLightRef.current = null;
			postProcessing.dispose();
			renderer.dispose();
			rendererRef.current = null;
			if (renderer.domElement.parentElement === container) {
				container.removeChild(renderer.domElement);
			}
			if (statsRef.current?.dom?.parentElement === container) {
				container.removeChild(statsRef.current.dom);
			}
			statsRef.current = null;
			if (triangleStatsRef.current?.parentElement === container) {
				container.removeChild(triangleStatsRef.current);
			}
			triangleStatsRef.current = null;
		};
	}, [containerRef, cameraRef, directionalLightRef]);

	// Backtick (`) shortcut to toggle the Stats.js overlay
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "`" || e.ctrlKey || e.metaKey || e.altKey) return;
			const stats = statsRef.current;
			if (!stats) return;
			const nextDisplay = stats.dom.style.display === "none" ? "block" : "none";
			stats.dom.style.display = nextDisplay;
			if (triangleStatsRef.current) {
				triangleStatsRef.current.style.display = nextDisplay;
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	return {
		sceneResources,
		isPointerLocked,
		cameraRef,
		directionalLightRef,
	};
}
