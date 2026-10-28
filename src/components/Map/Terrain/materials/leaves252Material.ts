// Leaves material (palette index 252).
//
// Alpha-cutout foliage, built on the iron bars approach (world-projected
// texture + alphaTest) with three differences:
//   - DoubleSide: a leaf blob meshes as a hollow shell (same-material neighbors
//     cull their shared faces), so through the gaps in the near faces you see
//     the inside of the far faces. That gives a canopy two layers of depth
//     instead of letting you see straight through it.
//   - Own occlusion group: faces against other materials are kept, so leaves
//     placed against stone bricks show the bricks through the gaps (moss/ivy).
//   - Casts shadows through a cutout depth material, so canopies cast dappled
//     shadows with the holes in them rather than solid blocks.
//
// Texture: Faithful 64x oak leaves (Faithful License, credit required), tinted
// and upscaled; see public/materials/leaves_252/CREDITS.txt.

import * as THREE from 'three';
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
import {
	applyHeroOcclusionUniforms,
	HERO_OCCLUSION_DISCARD,
	HERO_OCCLUSION_FRAGMENT_HEADER,
	HERO_OCCLUSION_VERTEX_BEGIN,
	HERO_OCCLUSION_VERTEX_HEADER,
	type HeroOcclusionUniforms,
} from '../shaders/heroOcclusionShader';
import { createTerrainColorTextureGetter } from './terrainColorTexture';

// ---------------------------------------------------------------------------
// Tuning knobs
// ---------------------------------------------------------------------------

const LEAVES_TEXTURE_URL = '/materials/leaves_252/leaves_256x256.png';
const LEAVES_SWATCH = '#3f8f2a';
const LEAVES_TEXTURE_REPEAT = 1.0;

const LEAVES_ROUGHNESS = 0.8;
const LEAVES_METALNESS = 0.0;

// Alpha threshold for the cutout. Pixels with alpha below this are discarded.
const LEAVES_ALPHA_TEST = 0.5;

const getLeavesTexture = createTerrainColorTextureGetter(LEAVES_TEXTURE_URL);

// Same tri-planar pick as the color pass, shared by the shadow pass so the
// shadow holes line up with the visible holes.
const LEAVES_UV_FUNCTION = [
	'uniform sampler2D leavesMap;',
	'vec2 getLeavesUv(vec3 worldPosition, vec3 worldNormal) {',
	'	vec3 n = abs(normalize(worldNormal));',
	'	if (n.y >= n.x && n.y >= n.z) return worldPosition.xz;',
	'	if (n.x >= n.z) return worldPosition.zy;',
	'	return worldPosition.xy;',
	'}',
];

const LEAVES_UV_SCALE = LEAVES_TEXTURE_REPEAT.toFixed(1);

// ---------------------------------------------------------------------------
// Color pass
// ---------------------------------------------------------------------------

function installLeaves252Shader(
	material: THREE.MeshStandardMaterial,
	texture: THREE.Texture,
	voxelAo: VoxelAoTexture,
	movementHighlight: MovementHighlightTexture | undefined,
	heroOcclusion: HeroOcclusionUniforms | undefined,
	performanceMode: boolean
): void {
	material.onBeforeCompile = (shader) => {
		applyVoxelAoUniforms(shader, voxelAo);
		shader.uniforms.leavesMap = { value: texture };
		applyMovementHighlightUniforms(shader, movementHighlight);
		applyHeroOcclusionUniforms(shader, heroOcclusion);

		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			['#include <common>', ...VOXEL_AO_VERTEX_HEADER, ...MOVEMENT_HIGHLIGHT_VERTEX_HEADER, ...HERO_OCCLUSION_VERTEX_HEADER].join('\n')
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			['#include <begin_vertex>', ...VOXEL_AO_VERTEX_BEGIN, ...MOVEMENT_HIGHLIGHT_VERTEX_BEGIN, ...HERO_OCCLUSION_VERTEX_BEGIN].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			['#include <common>', ...getVoxelAoFragmentHeader(performanceMode), ...LEAVES_UV_FUNCTION, ...MOVEMENT_HIGHLIGHT_FRAGMENT_HEADER, ...HERO_OCCLUSION_FRAGMENT_HEADER].join('\n')
		);
		// diffuseColor.a carries the cutout so three.js's built-in alphaTest discards the gaps.
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			[
				'#include <color_fragment>',
				`vec4 leavesTexel = texture2D(leavesMap, getLeavesUv(vVoxelAoWorldPosition, vVoxelAoWorldNormal) * ${LEAVES_UV_SCALE});`,
				'diffuseColor.rgb *= leavesTexel.rgb;',
				'diffuseColor.a *= leavesTexel.a;',
				`diffuseColor.rgb *= ${VOXEL_AO_CALL};`,
			].join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <clipping_planes_fragment>',
			HERO_OCCLUSION_DISCARD.join('\n')
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <dithering_fragment>',
			MOVEMENT_HIGHLIGHT_DITHERING.join('\n')
		);
	};
}

// ---------------------------------------------------------------------------
// Shadow pass: depth material with the same cutout
// ---------------------------------------------------------------------------

function createLeavesDepthMaterial(texture: THREE.Texture): THREE.MeshDepthMaterial {
	const material = new THREE.MeshDepthMaterial({
		depthPacking: THREE.RGBADepthPacking,
		alphaTest: LEAVES_ALPHA_TEST,
		side: THREE.DoubleSide,
	});
	material.onBeforeCompile = (shader) => {
		shader.uniforms.leavesMap = { value: texture };
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				['#include <common>', 'varying vec3 vLeavesWorldPosition;', 'varying vec3 vLeavesWorldNormal;'].join('\n')
			)
			.replace(
				'#include <begin_vertex>',
				[
					'#include <begin_vertex>',
					'vLeavesWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;',
					'vLeavesWorldNormal = mat3(modelMatrix) * normal;',
				].join('\n')
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				['#include <common>', 'varying vec3 vLeavesWorldPosition;', 'varying vec3 vLeavesWorldNormal;', ...LEAVES_UV_FUNCTION].join('\n')
			)
			.replace(
				'#include <alphamap_fragment>',
				[
					'#include <alphamap_fragment>',
					`diffuseColor.a *= texture2D(leavesMap, getLeavesUv(vLeavesWorldPosition, vLeavesWorldNormal) * ${LEAVES_UV_SCALE}).a;`,
				].join('\n')
			);
	};
	material.customProgramCacheKey = () => 'terrain-leaves_252-depth-v1';
	return material;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

const createLeaves252Material: MaterialFactory = (
	params: MaterialFactoryParams
): MaterialFactoryResult => {
	const { movementHighlight, voxelAo, heroOcclusion, performanceMode = false } = params;
	const texture = getLeavesTexture(performanceMode);

	const material = new THREE.MeshStandardMaterial({
		roughness: LEAVES_ROUGHNESS,
		metalness: LEAVES_METALNESS,
		vertexColors: false,
		alphaTest: LEAVES_ALPHA_TEST,
		side: THREE.DoubleSide,
	});

	installLeaves252Shader(material, texture, voxelAo, movementHighlight, heroOcclusion, performanceMode);

	return {
		material,
		castShadow: true,
		receiveShadow: true,
		customDepthMaterial: createLeavesDepthMaterial(texture),
		renderOrder: 2,       // same slot as the other cutout material (iron bars)
	};
};

// ---------------------------------------------------------------------------
// Material definition (collected by materials/index.ts)
// ---------------------------------------------------------------------------

const leaves252Material: TerrainMaterial = {
	bucketKey: 'leaves_252',
	occlusionGroup: 'leaves_252',
	shaderVersion: 1,
	geometry: {
		vertexColors: false,
	},
	seeThrough: true,
	factory: createLeaves252Material,
	special: {
		paletteIndex: 252,
		label: 'Leaves',
		swatchColor: LEAVES_SWATCH,
		category: 'nature',
	},
};

export default leaves252Material;
