import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import * as THREE from "three";
import Stats from "three/examples/jsm/libs/stats.module.js";
import type { ThreeDSceneResources } from "../../Actors3D/actorTokenTypes";
import {
	createThreeDMapPostProcessing,
	type ThreeDMapPostProcessing,
} from "../../mapPostProcessing";
import {
	THREE_D_MAP_LIGHTING,
	THREE_D_MAP_RENDERER,
	THREE_D_MAP_SHADOW,
} from "../../threeDMapConstants";
import {
	createMovementHighlightTexture,
	createDummyTerrainGeometry,
	createPlaceholderVoxelAoTexture,
	TERRAIN_MATERIAL_REGISTRY,
} from "../materials";

// ---------------------------------------------------------------------------
// Shared scene bootstrap for the map.
//
// Owns the renderer/scene/lights/post-processing/pre-warm/RAF/resize/stats/
// teardown scaffolding. Everything camera-specific is delegated to a "controller"
// the caller builds via createController -- in practice the single MapModeController
// (MapScene's only consumer), which hosts both the world and first-person cameras
// and swaps between them in place:
//   - camera + controls (the world CameraRig and the first-person camera)
//   - the per-frame callback (rig.update / the FP capsule+look handlers, by mode)
//   - resize behaviour
//   - teardown (rig dispose + FP input detach)
// ---------------------------------------------------------------------------

// dt clamp ceiling so a backgrounded tab resuming doesn't apply one huge step.
const MAX_DELTA_SECONDS = 0.1;
// Triangle-stats debug overlay width (multi-line: TRIS/DRAW/GEOM/TEX/PROG).
const TRIANGLE_STATS_WIDTH = "110px";

function formatTriangleStats(info: THREE.WebGLRenderer["info"]): string {
	const tris = info.render.triangles.toLocaleString();
	const draws = info.render.calls.toLocaleString();
	const geoms = info.memory.geometries.toLocaleString();
	const texs = info.memory.textures.toLocaleString();
	const progs = (info.programs?.length ?? 0).toLocaleString();
	return `TRIS ${tris}\nDRAW ${draws}\nGEOM ${geoms}\nTEX  ${texs}\nPROG ${progs}`;
}

export interface MapSceneControllerContext {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	container: HTMLDivElement;
	performanceMode: boolean;
	/**
	 * Update the active camera on the shared resources + post-processing pass.
	 * Safe to call before they exist (no-op until then). MapModeController calls
	 * this whenever it swaps the active camera (world camera, transition, or FP).
	 */
	setActiveCamera: (camera: THREE.Camera) => void;
}

export interface MapSceneController {
	/** Initial active camera; used for resources, post-processing, and pre-warm. */
	camera: THREE.Camera;
	/** Per-frame, before the shared animationCallbacks run and before render. */
	onFrame: (now: number, dt: number) => void;
	/** Container resized; the core already calls postProcessing.setSize itself. */
	onResize: (width: number, height: number) => void;
	/** Camera/input teardown. (Terrain meshes + the movement-highlight texture are
	 *  owned and disposed by useTerrainMeshes, not here.) */
	dispose: (resources: ThreeDSceneResources) => void;
}

export interface MapSceneCoreOptions {
	performanceMode: boolean;
	/** The core sets this to the scene's directional light on mount, null on unmount. */
	directionalLightRef: RefObject<THREE.DirectionalLight | null>;
	createController: (ctx: MapSceneControllerContext) => MapSceneController;
	/**
	 * When true the RAF loop keeps scheduling but skips per-frame work + render.
	 * Used while the map is mounted-but-hidden (e.g. the DM is on another tab) so
	 * the WebGL stack stays resident — no teardown/rebuild stutter on return —
	 * without burning CPU/GPU rendering an offscreen scene every frame.
	 */
	paused?: boolean;
}

export interface MapSceneCore {
	sceneResources: ThreeDSceneResources | null;
	/** Re-applies the current container size to the controller + post-processing. */
	requestResize: () => void;
}

export function useMapSceneCore(
	containerRef: RefObject<HTMLDivElement | null>,
	options: MapSceneCoreOptions
): MapSceneCore {
	const optionsRef = useRef(options);
	optionsRef.current = options;

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const statsRef = useRef<any>(null);
	const triangleStatsRef = useRef<HTMLDivElement | null>(null);
	const resourcesRef = useRef<ThreeDSceneResources | null>(null);
	const postProcessingRef = useRef<ThreeDMapPostProcessing | null>(null);
	const warmMeshesRef = useRef<THREE.Mesh[]>([]);
	const requestResizeRef = useRef<(() => void) | null>(null);

	const [sceneResources, setSceneResources] =
		useState<ThreeDSceneResources | null>(null);

	const requestResize = useCallback(() => requestResizeRef.current?.(), []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		const { performanceMode, directionalLightRef, createController } =
			optionsRef.current;

		const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
		renderer.setPixelRatio(
			Math.min(
				window.devicePixelRatio,
				performanceMode
					? THREE_D_MAP_RENDERER.PERFORMANCE_MAX_PIXEL_RATIO
					: THREE_D_MAP_RENDERER.MAX_PIXEL_RATIO
			)
		);
		renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		renderer.info.autoReset = false;
		renderer.shadowMap.enabled = true;
		renderer.shadowMap.autoUpdate = false;
		renderer.shadowMap.needsUpdate = true;
		renderer.shadowMap.type = THREE.PCFSoftShadowMap;
		container.appendChild(renderer.domElement);

		const stats = new Stats();
		stats.showPanel(0); // 0: FPS, 1: ms/frame, 2: MB -- click to cycle
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
		triangleStats.style.width = TRIANGLE_STATS_WIDTH;
		triangleStats.style.boxSizing = "border-box";
		triangleStats.style.padding = "2px 3px";
		triangleStats.style.background = "rgba(0, 0, 0, 0.8)";
		triangleStats.style.color = "#0ff";
		triangleStats.style.font = "bold 9px Helvetica, Arial, sans-serif";
		triangleStats.style.lineHeight = "11px";
		triangleStats.style.whiteSpace = "pre";
		triangleStats.style.pointerEvents = "none";
		triangleStats.style.display = "none";
		triangleStats.textContent = formatTriangleStats(renderer.info);
		container.appendChild(triangleStats);
		triangleStatsRef.current = triangleStats;

		const scene = new THREE.Scene();
		scene.background = null;

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
		const shadowMapSize = performanceMode
			? THREE_D_MAP_SHADOW.PERFORMANCE_MAP_SIZE
			: THREE_D_MAP_SHADOW.MAP_SIZE;
		dirLight.shadow.mapSize.set(shadowMapSize, shadowMapSize);
		dirLight.shadow.bias = THREE_D_MAP_SHADOW.BIAS;
		dirLight.shadow.normalBias = THREE_D_MAP_SHADOW.NORMAL_BIAS;
		scene.add(dirLight);
		scene.add(dirLight.target);
		directionalLightRef.current = dirLight;

		// Pushes a camera swap through to the shared resources + post pass. Safe
		// before either exists (the refs are still null during controller setup).
		const setActiveCamera = (cam: THREE.Camera) => {
			if (resourcesRef.current) resourcesRef.current.camera = cam;
			postProcessingRef.current?.setCamera(cam);
		};

		const controller = createController({
			renderer,
			scene,
			container,
			performanceMode,
			setActiveCamera,
		});
		const camera = controller.camera;

		const postProcessing = createThreeDMapPostProcessing(
			renderer,
			scene,
			camera,
			{ performanceMode }
		);
		postProcessingRef.current = postProcessing;

		const movementHighlight = createMovementHighlightTexture(1, 1, 1);
		const resources: ThreeDSceneResources = {
			scene,
			camera,
			domElement: renderer.domElement,
			occlusionTargets: [],
			movementHighlight,
			animationCallbacks: new Set(),
			requestShadowUpdate: () => {
				renderer.shadowMap.needsUpdate = true;
			},
			actorPickTargets: [],
			dragState: { active: false },
			setFogVolume: postProcessing.setFogVolume,
		};

		// Pre-warm: compile every registered shader variant before exposing the
		// scene to the rest of the app, so there is no stutter when terrain first
		// appears. Both movement-highlight variants are warmed (the world view
		// paints range onto the highlight-capable terrain shader).
		let cancelled = false;
		void (async () => {
			const dummyGeo = createDummyTerrainGeometry();
			const dummyHighlight = createMovementHighlightTexture(1, 1, 1);
			const dummyVoxelAo = createPlaceholderVoxelAoTexture();
			const warmMeshes: THREE.Mesh[] = [];
			for (const [, factory] of TERRAIN_MATERIAL_REGISTRY) {
				for (const acceptsMovementHighlight of [false, true]) {
					const result = factory({
						acceptsMovementHighlight,
						performanceMode,
						movementHighlight: acceptsMovementHighlight ? dummyHighlight : undefined,
						voxelAo: dummyVoxelAo,
					});
					const warmMesh = new THREE.Mesh(dummyGeo, result.material);
					scene.add(warmMesh);
					warmMeshes.push(warmMesh);
				}
			}
			warmMeshesRef.current = warmMeshes;
			await renderer.compileAsync(scene, camera);
			if (cancelled) {
				dummyHighlight.texture.dispose();
				dummyVoxelAo.texture.dispose();
				return;
			}
			for (const warmMesh of warmMeshes) scene.remove(warmMesh);
			warmMeshesRef.current = [];
			dummyHighlight.texture.dispose();
			dummyVoxelAo.texture.dispose();
			// Warm geometry and materials are intentionally left undisposed so the
			// compiled WebGL programs stay resident in the driver cache.
			resourcesRef.current = resources;
			setSceneResources(resources);
		})();

		let rafId = 0;
		let lastFrameTime = performance.now();
		const animate = () => {
			rafId = requestAnimationFrame(animate);
			const now = performance.now();
			const dt = Math.min(
				MAX_DELTA_SECONDS,
				Math.max(0, (now - lastFrameTime) / 1000)
			);
			lastFrameTime = now;
			// Mounted but hidden: skip frame work + render entirely. lastFrameTime is
			// still advanced above so dt doesn't spike on resume (it's clamped anyway).
			if (optionsRef.current.paused) return;
			controller.onFrame(now, dt);
			for (const callback of resources.animationCallbacks) {
				callback(now);
			}
			stats.begin();
			renderer.info.reset();
			postProcessing.render();
			if (triangleStats.style.display !== "none") {
				triangleStats.textContent = formatTriangleStats(renderer.info);
			}
			stats.end();
		};
		animate();

		const updateCameraProjection = () => {
			const w = container.clientWidth;
			const h = container.clientHeight;
			if (w === 0 || h === 0) return;
			controller.onResize(w, h);
			postProcessing.setSize(w, h);
		};
		requestResizeRef.current = updateCameraProjection;

		const ro = new ResizeObserver(updateCameraProjection);
		ro.observe(container);

		return () => {
			cancelled = true;
			setSceneResources(null);
			cancelAnimationFrame(rafId);
			ro.disconnect();
			requestResizeRef.current = null;
			// Camera/input teardown (disposes the rig + detaches first-person input).
			controller.dispose(resources);
			// Clean up any warm meshes still in the scene (compileAsync may not have
			// finished). Warm geometry/materials are left undisposed so the compiled
			// WebGL programs stay resident until renderer.dispose().
			for (const m of warmMeshesRef.current) scene.remove(m);
			warmMeshesRef.current = [];
			// Terrain meshes, fog volume, and the movement-highlight texture are owned
			// and torn down by useTerrainMeshes, whose cleanup runs before this one (it
			// is called after useMapSceneCore in MapScene).
			resourcesRef.current = null;
			postProcessing.dispose();
			postProcessingRef.current = null;
			renderer.dispose();
			directionalLightRef.current = null;
			if (renderer.domElement.parentElement === container) {
				container.removeChild(renderer.domElement);
			}
			if (statsRef.current?.dom?.parentElement === container) {
				container.removeChild(statsRef.current.dom);
			}
			if (triangleStatsRef.current?.parentElement === container) {
				container.removeChild(triangleStatsRef.current);
			}
			statsRef.current = null;
			triangleStatsRef.current = null;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	// Backtick (`) shortcut to toggle the Stats.js + triangle-stats overlays.
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

	return { sceneResources, requestResize };
}
