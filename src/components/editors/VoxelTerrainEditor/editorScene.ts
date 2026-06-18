// Three.js scene setup for the voxel terrain editor.
//
// The cameras, their controls, freecam movement and mode switching all live in
// the shared `CameraRig` (src/utils/camera). This module owns the rest of the
// editor scene -- renderer, lights, terrain material, grid/hover/selection/chunk
// groups -- and configures a rig with the editor's tuning. `resources.camera`
// points at whichever camera the rig has active; picking, rendering and
// projection all read through it so they're naturally camera-agnostic.

import * as THREE from "three";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { CameraRig, type CameraRigConfig } from "../../../utils/camera/CameraRig";
import { installEditorTerrainShader } from "./editorTerrainShader";

const EDITOR_PIXEL_RATIO = 1;

const EDITOR_CAMERA_RIG_CONFIG: CameraRigConfig = {
	ortho: {
		near: -100,
		far: 1000,
		initialHalfSize: 14,
		distanceMultiplier: 1.65,
		// Wider than the freecam framing so the whole build stays in view, with a
		// height term so tall terrains fit and a floor for tiny ones.
		framing: { floor: 6, diagonalMultiplier: 1.15, heightMultiplier: 0.9 },
	},
	perspective: { fov: 70, near: 0.05, far: 1000 },
	controls: {
		dampingFactor: 0.08,
		minZoom: 0.4,
		maxZoom: 10,
		// Left paints; middle orbits; right pans. (Right-hold acquires freecam
		// look mode, handled by the rig when in freecam.)
		mouseButtons: { LEFT: null, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN },
	},
	freecam: {
		baseMoveSpeed: 10,
		minSpeedMult: 0.15,
		maxSpeedMult: 6,
		speedStep: 1.15,
		initialDistanceMultiplier: 1.3,
	},
};

export interface EditorSceneResources {
	scene: THREE.Scene;
	renderer: THREE.WebGLRenderer;
	/** Shared camera rig owning both cameras, controls and freecam input. */
	rig: CameraRig;
	/** Active camera. Points at the rig's ortho or perspective camera; updated
	 *  by the rig's onActiveCameraChange callback on mode switch. */
	camera: THREE.OrthographicCamera | THREE.PerspectiveCamera;
	orthoCamera: THREE.OrthographicCamera;
	freecamCamera: THREE.PerspectiveCamera;
	controls: CameraRig["controls"];
	pointerLockControls: CameraRig["pointerLockControls"];
	gridGroup: THREE.Group;
	hoverGroup: THREE.Group;
	selectionGroup: THREE.Group;
	chunkGroup: THREE.Group;
	terrainMaterial: THREE.MeshStandardMaterial;
}

export function createEditorScene(
	container: HTMLDivElement,
	readOnly: boolean,
): EditorSceneResources {
	const renderer = new THREE.WebGLRenderer({
		antialias: false,
		alpha: true,
		powerPreference: "high-performance",
	});
	renderer.setPixelRatio(EDITOR_PIXEL_RATIO);
	renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	renderer.domElement.style.touchAction = "none";
	renderer.domElement.style.cursor = readOnly ? "default" : "crosshair";
	container.appendChild(renderer.domElement);

	const scene = new THREE.Scene();
	scene.background = null;

	const width  = container.clientWidth  || 1;
	const height = container.clientHeight || 1;
	const aspect = width / height;

	const rig = new CameraRig(renderer.domElement, aspect, EDITOR_CAMERA_RIG_CONFIG);
	rig.resize(width, height);

	scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, Math.PI * 0.75));
	const directional = new THREE.DirectionalLight(0xffffff, Math.PI * 1.6);
	directional.position.set(18, 32, 22);
	scene.add(directional);

	const gridGroup      = new THREE.Group();
	const hoverGroup     = new THREE.Group();
	const selectionGroup = new THREE.Group();
	const chunkGroup     = new THREE.Group();
	scene.add(gridGroup, selectionGroup, hoverGroup, chunkGroup);

	const terrainMaterial = new THREE.MeshStandardMaterial({
		roughness: 0.78,
		metalness: 0,
		vertexColors: true,
	});
	// "Specialness" hint: voxels painted with a special material (palette
	// index >= 240) get a subtle world-space diagonal stripe so they read as
	// distinct from a same-coloured normal voxel.
	installEditorTerrainShader(terrainMaterial);

	return {
		scene, renderer,
		rig,
		camera: rig.orthoCamera,
		orthoCamera: rig.orthoCamera,
		freecamCamera: rig.perspectiveCamera,
		controls: rig.controls,
		pointerLockControls: rig.pointerLockControls,
		gridGroup, hoverGroup, selectionGroup, chunkGroup,
		terrainMaterial,
	};
}

export function resizeRenderer(
	resources: EditorSceneResources,
	container: HTMLDivElement,
): void {
	const width  = container.clientWidth  || 1;
	const height = container.clientHeight || 1;
	resources.rig.resize(width, height);
	resources.renderer.setSize(width, height);
}

/**
 * Reset the orthographic camera to its default isometric framing for the
 * given terrain. Does not affect the freecam camera.
 */
export function frameOrthoCamera(
	resources: EditorSceneResources,
	terrain: VoxelTerrain,
	container: HTMLDivElement,
): void {
	resources.rig.resize(container.clientWidth || 1, container.clientHeight || 1);
	resources.rig.frameOrtho({
		width: terrain.Width,
		length: terrain.Length,
		height: terrain.Height,
	});
}

// ---------------------------------------------------------------------------
// Disposal helpers
// ---------------------------------------------------------------------------

export function disposeMaterial(material: THREE.Material | THREE.Material[]): void {
	if (Array.isArray(material)) {
		for (const m of material) m.dispose();
		return;
	}
	material.dispose();
}

export function disposeObjectTree(object: THREE.Object3D): void {
	object.traverse((child) => {
		const mesh = child as THREE.Mesh;
		if (mesh.geometry) mesh.geometry.dispose();
		if (mesh.material) disposeMaterial(mesh.material);
	});
}

export function clearObjectGroup(group: THREE.Group): void {
	disposeObjectTree(group);
	group.clear();
}
