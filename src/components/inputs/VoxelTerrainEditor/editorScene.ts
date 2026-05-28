// Three.js scene setup for the voxel terrain editor.
//
// Creates the orthographic camera, OrbitControls, renderer, light rig, and the
// scene groups the editor renders into (gridGroup, hoverGroup, selectionGroup,
// chunkGroup). Also exposes disposal helpers and the camera framing routine
// run on shape changes.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { VoxelTerrain } from "../../../domains/VoxelTerrain/VoxelTerrain";
import { installEditorTerrainShader } from "./editorTerrainShader";

export const INITIAL_CAMERA_HALF_SIZE = 14;
export const CAMERA_DISTANCE_MULTIPLIER = 1.65;
const EDITOR_PIXEL_RATIO = 1;

export interface EditorSceneResources {
	scene: THREE.Scene;
	camera: THREE.OrthographicCamera;
	renderer: THREE.WebGLRenderer;
	controls: OrbitControls;
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

	const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
	const camera = new THREE.OrthographicCamera(
		-INITIAL_CAMERA_HALF_SIZE * aspect,
		 INITIAL_CAMERA_HALF_SIZE * aspect,
		 INITIAL_CAMERA_HALF_SIZE,
		-INITIAL_CAMERA_HALF_SIZE,
		-100, 1000,
	);
	const initialDist = INITIAL_CAMERA_HALF_SIZE * CAMERA_DISTANCE_MULTIPLIER;
	camera.position.set(initialDist, initialDist, initialDist);

	scene.add(new THREE.HemisphereLight(0xffffff, 0x94a3b8, Math.PI * 0.75));
	const directional = new THREE.DirectionalLight(0xffffff, Math.PI * 1.6);
	directional.position.set(18, 32, 22);
	scene.add(directional);

	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minZoom = 0.4;
	controls.maxZoom = 10;
	controls.mouseButtons.LEFT   = null as unknown as THREE.MOUSE;
	controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
	controls.mouseButtons.RIGHT  = THREE.MOUSE.PAN;
	controls.update();

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
	// distinct from a same-coloured normal voxel. The pattern is constant in
	// world space (stable across camera moves) and gated by a per-vertex
	// isSpecial flag so plain voxels are unaffected.
	installEditorTerrainShader(terrainMaterial);

	return {
		scene, camera, renderer, controls,
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
	const aspect = width / height;
	const halfSize = resources.camera.top;
	resources.camera.left  = -halfSize * aspect;
	resources.camera.right =  halfSize * aspect;
	resources.camera.updateProjectionMatrix();
	resources.renderer.setSize(width, height);
}

export function frameCamera(
	resources: EditorSceneResources,
	terrain: VoxelTerrain,
	container: HTMLDivElement,
): void {
	const halfSize = Math.max(
		6,
		((terrain.Width + terrain.Length) / Math.SQRT2 / 2) * 1.15,
		terrain.Height * 0.9,
	);
	const aspect = (container.clientWidth || 1) / (container.clientHeight || 1);
	const camera   = resources.camera;
	const controls = resources.controls;
	const centerY  = Math.max(0, terrain.Height / 2 - 0.5);
	const dist     = halfSize * CAMERA_DISTANCE_MULTIPLIER;

	camera.left   = -halfSize * aspect;
	camera.right  =  halfSize * aspect;
	camera.top    =  halfSize;
	camera.bottom = -halfSize;
	camera.position.set(dist, dist, dist);
	camera.zoom = 1;
	camera.updateProjectionMatrix();
	controls.target.set(0, centerY, 0);
	controls.cursor.set(0, centerY, 0);
	controls.maxTargetRadius = Math.max(8, Math.sqrt(terrain.Width ** 2 + terrain.Length ** 2));
	controls.update();
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
