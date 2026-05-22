// src/components/Map/Materials/installSpecialMaterials.ts
//
// Installs the special material shader extensions onto a MeshStandardMaterial
// via onBeforeCompile -- special materials only, no movement highlight.
//
// Use this for renderers that don't need the gameplay overlay (e.g. the
// first-person map). The isometric map uses its own installTerrainShaderExtensions
// in 3DMap.tsx, which combines this logic with the movement highlight in a
// single onBeforeCompile pass (Three.js only supports one per material).
//
// Returns a specialUniforms object. The caller must update
// specialUniforms.uTime.value = now / 1000 each animation frame.

import * as THREE from 'three';
import { SPECIAL_MATERIAL_REGISTRY } from './allMaterials';

export function installSpecialMaterialShader(
	material: THREE.MeshStandardMaterial
): { uTime: { value: number } } {
	const specialUniforms = { uTime: { value: 0 } };

	material.onBeforeCompile = (shader) => {
		shader.uniforms.uTime = specialUniforms.uTime;

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				'uniform float uTime;',
				'attribute float voxelMaterialSlot;',
				'varying float vVoxelMaterialSlot;',
				'varying vec3 vSpecialWorldPos;',
				'varying vec3 vSpecialWorldNormal;',
				SPECIAL_MATERIAL_REGISTRY.buildVertexGLSL(),
			].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			[
				'#include <begin_vertex>',
				'vVoxelMaterialSlot = voxelMaterialSlot;',
				'vSpecialWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
				'vSpecialWorldNormal = normalize(mat3(modelMatrix) * normal);',
				'applySpecialMaterialVertex(voxelMaterialSlot, transformed, normal, uTime);',
			].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			[
				'#include <common>',
				'uniform float uTime;',
				'varying float vVoxelMaterialSlot;',
				'varying vec3 vSpecialWorldPos;',
				'varying vec3 vSpecialWorldNormal;',
				SPECIAL_MATERIAL_REGISTRY.buildFragmentGLSL(),
			].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			[
				'applySpecialMaterial(vVoxelMaterialSlot, vSpecialWorldPos, vSpecialWorldNormal, uTime, gl_FragColor);',
				'#include <dithering_fragment>',
			].join('\n')
		);
	};
	material.needsUpdate = true;
	return specialUniforms;
}
