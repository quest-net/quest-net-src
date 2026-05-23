// src/components/Map/Materials/terrainMaterial.ts
//
// The single place that builds a terrain MeshStandardMaterial.
//
// Three.js allows only one onBeforeCompile per material, so we compose all
// per-feature GLSL contributions (special materials, movement highlight, future
// overlays) through a TerrainShaderExtension list and inject them in a single
// pass. Both the isometric DM map (3DMap.tsx) and the first-person view
// (FirstPerson/terrain.ts) go through this factory; the only difference is
// which extensions they pass in.
//
// The composer always emits two world-space varyings that any extension can
// read in its body GLSL:
//   varying vec3 vTerrainWorldPos;
//   varying vec3 vTerrainWorldNormal;

import * as THREE from 'three';

import { THREE_D_TERRAIN_MATERIAL } from '../threeDMapConstants';
import { SPECIAL_MATERIAL_REGISTRY } from './allMaterials';
import type { TerrainShaderExtension } from './types';
import type { VoxelTerrainLighting } from '../../../domains/VoxelTerrain/VoxelTerrain';

export interface TerrainMaterialBundle {
	material: THREE.MeshStandardMaterial;
	/**
	 * Per-frame hook. Pass each frame's `performance.now()`-style timestamp
	 * (in ms). Internally calls every extension's tickTime if it provided one.
	 */
	tickTime: (now: number) => void;
}

export interface SpecialMaterialsExtension extends TerrainShaderExtension {
	setTerrainLighting: (lighting: VoxelTerrainLighting | null | undefined) => void;
}

/**
 * Creates a terrain MeshStandardMaterial with the given shader extensions
 * layered into a single onBeforeCompile. Body GLSL from earlier extensions in
 * the array runs first in the fragment shader, so callers control overlay
 * order by ordering the extensions list.
 */
export function createTerrainMaterial(
	extensions: ReadonlyArray<TerrainShaderExtension>
): TerrainMaterialBundle {
	const material = new THREE.MeshStandardMaterial({
		roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
		metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
		vertexColors: true,
	});

	material.onBeforeCompile = (shader) => {
		for (const ext of extensions) {
			if (!ext.uniforms) continue;
			for (const [name, uniform] of Object.entries(ext.uniforms)) {
				shader.uniforms[name] = uniform;
			}
		}

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				'varying vec3 vTerrainWorldPos;',
				'varying vec3 vTerrainWorldNormal;',
				...extensions.map((ext) => ext.vertexHeaderGLSL ?? ''),
			].join('\n')
		);

		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			[
				'#include <begin_vertex>',
				'vTerrainWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
				'vTerrainWorldNormal = normalize(mat3(modelMatrix) * normal);',
				...extensions.map((ext) => ext.vertexBodyGLSL ?? ''),
			].join('\n')
		);

		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			[
				'#include <common>',
				'varying vec3 vTerrainWorldPos;',
				'varying vec3 vTerrainWorldNormal;',
				...extensions.map((ext) => ext.fragmentHeaderGLSL ?? ''),
			].join('\n')
		);

		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			[
				...extensions.map((ext) => ext.fragmentBodyGLSL ?? ''),
				'#include <dithering_fragment>',
			].join('\n')
		);
	};
	material.needsUpdate = true;

	const tickTime = (now: number) => {
		for (const ext of extensions) {
			ext.tickTime?.(now);
		}
	};

	return { material, tickTime };
}

/**
 * Builds the special-materials extension: declares the per-voxel material slot
 * attribute, emits the dispatcher GLSL assembled from the registry, and ticks
 * its own `uTime` uniform once per frame so animated materials (water, etc.)
 * advance. Safe to use when the registry is empty -- the dispatcher becomes a
 * no-op stub.
 */
export function createSpecialMaterialsExtension(
	lighting?: VoxelTerrainLighting | null
): SpecialMaterialsExtension {
	const uTime = { value: 0 };
	const uTerrainLightColor = { value: new THREE.Color('#ffffff') };
	const uTerrainLightIntensity = { value: 1.15 };

	const setTerrainLighting = (nextLighting: VoxelTerrainLighting | null | undefined) => {
		uTerrainLightColor.value.set(nextLighting?.Color ?? '#ffffff');
		uTerrainLightIntensity.value = Math.max(0, nextLighting?.Intensity ?? 1.15);
	};
	setTerrainLighting(lighting);

	return {
		uniforms: { uTime, uTerrainLightColor, uTerrainLightIntensity },
		vertexHeaderGLSL: [
			'uniform float uTime;',
			'attribute float voxelMaterialSlot;',
			'varying float vVoxelMaterialSlot;',
			SPECIAL_MATERIAL_REGISTRY.buildVertexGLSL(),
		].join('\n'),
		vertexBodyGLSL: [
			'vVoxelMaterialSlot = voxelMaterialSlot;',
			'applySpecialMaterialVertex(voxelMaterialSlot, transformed, normal, uTime);',
		].join('\n'),
		fragmentHeaderGLSL: [
			'uniform float uTime;',
			'uniform vec3 uTerrainLightColor;',
			'uniform float uTerrainLightIntensity;',
			'varying float vVoxelMaterialSlot;',
			SPECIAL_MATERIAL_REGISTRY.buildFragmentGLSL(),
		].join('\n'),
		fragmentBodyGLSL:
			'applySpecialMaterial(vVoxelMaterialSlot, vTerrainWorldPos, vTerrainWorldNormal, uTime, gl_FragColor);',
		tickTime: (now) => {
			uTime.value = now / 1000;
		},
		setTerrainLighting,
	};
}
