// Default material (bucket 'default') -- opaque vertex-coloured terrain with
// per-fragment voxel AO and the movement-highlight overlay.
//
// This file is one of the per-material definition files collected by
// materials/index.ts. The default export is the TerrainMaterial record; the
// registry wraps `factory` to install a stable customProgramCacheKey derived
// from bucketKey + shaderVersion + performance mode.

import * as THREE from 'three';
import { THREE_D_TERRAIN_MATERIAL } from '../../threeDMapConstants';
import type {
	MaterialFactory,
	MaterialFactoryParams,
	MaterialFactoryResult,
	MovementHighlightTexture,
	TerrainMaterial,
} from './materialTypes';
import {
	applyVoxelAoUniforms,
	getVoxelAoFragmentHeader,
	VOXEL_AO_CALL,
	VOXEL_AO_VERTEX_BEGIN,
	VOXEL_AO_VERTEX_HEADER,
	type VoxelAoTexture,
} from '../shaders/voxelAoShader';
import {
	applyMovementHighlightUniforms,
	MOVEMENT_HIGHLIGHT_DITHERING,
	MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER,
	MOVEMENT_HIGHLIGHT_VERTEX_BEGIN,
	MOVEMENT_HIGHLIGHT_VERTEX_HEADER,
} from '../shaders/movementHighlightShader';

// ---------------------------------------------------------------------------
// Shader installation -- AO + movement-highlight overlay (the overlay is gated
// by the uHighlightEnabled uniform set in applyMovementHighlightUniforms, so a
// single program serves world view, first-person, and the surroundings skirt).
// ---------------------------------------------------------------------------

function installDefaultShader(
	material: THREE.MeshStandardMaterial,
	voxelAo: VoxelAoTexture,
	movementHighlight: MovementHighlightTexture | undefined,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		applyMovementHighlightUniforms(shader, movementHighlight);

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...VOXEL_AO_VERTEX_HEADER, ...MOVEMENT_HIGHLIGHT_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...VOXEL_AO_VERTEX_BEGIN, ...MOVEMENT_HIGHLIGHT_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...getVoxelAoFragmentHeader(performanceMode), ...MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			`#include <color_fragment>\ndiffuseColor.rgb *= ${VOXEL_AO_CALL};`
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			MOVEMENT_HIGHLIGHT_DITHERING.join('\n')
		);
	};
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export const createDefaultMaterial: MaterialFactory = (params: MaterialFactoryParams): MaterialFactoryResult => {
	const { movementHighlight, voxelAo, performanceMode = false } = params;

	const material = new THREE.MeshStandardMaterial({
		roughness: THREE_D_TERRAIN_MATERIAL.ROUGHNESS,
		metalness: THREE_D_TERRAIN_MATERIAL.METALNESS,
		vertexColors: true,
	});

	installDefaultShader(material, voxelAo, movementHighlight, performanceMode);
	// customProgramCacheKey is set by the registry wrapper.

	return { material, castShadow: true, receiveShadow: true };
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const defaultMaterial: TerrainMaterial = {
	bucketKey: 'default',
	occlusionGroup: 'solid',
	shaderVersion: 2,
	factory: createDefaultMaterial,
	// No `special` block: this is the catch-all material for palette indices 0-239
	// and any unassigned special index.
};

export default defaultMaterial;
