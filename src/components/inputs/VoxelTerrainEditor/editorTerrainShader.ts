// Editor terrain shader patch.
//
// Adds a per-vertex `isSpecial` attribute (0.0 or 1.0) and, for fragments
// belonging to special-material voxels, multiplies diffuseColor by a subtle
// world-space diagonal stripe. The stripe is computed from world position so
// it stays put as the camera moves; the slight Y-axis weighting (0.5) makes
// it visible on vertical side faces too without doubling the visual density
// on horizontal top faces.
//
// Magnitude (mix(0.82, 1.0, stripe)) is picked to be "a hint, not a feature":
// readable at editor zoom levels but quiet enough that the swatch color
// remains the dominant cue.

import type * as THREE from "three";

export function installEditorTerrainShader(material: THREE.MeshStandardMaterial): void {
	material.onBeforeCompile = (shader) => {
		shader.vertexShader = shader.vertexShader.replace(
			'#include <common>',
			[
				'#include <common>',
				'attribute float isSpecial;',
				'varying float vIsSpecial;',
				'varying vec3 vEditorWorldPos;',
			].join('\n'),
		);
		shader.vertexShader = shader.vertexShader.replace(
			'#include <begin_vertex>',
			[
				'#include <begin_vertex>',
				'vIsSpecial = isSpecial;',
				'vEditorWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;',
			].join('\n'),
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <common>',
			[
				'#include <common>',
				'varying float vIsSpecial;',
				'varying vec3 vEditorWorldPos;',
			].join('\n'),
		);
		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			[
				'#include <color_fragment>',
				'if (vIsSpecial > 0.5) {',
				'	float stripeT = (vEditorWorldPos.x + vEditorWorldPos.y * 0.5 + vEditorWorldPos.z) * 4.0;',
				'	float stripe = step(0.5, fract(stripeT));',
				'	diffuseColor.rgb *= mix(0.82, 1.0, stripe);',
				'}',
			].join('\n'),
		);
	};
	// Stable cache key in case the editor material is ever rebuilt across
	// remounts; cheap insurance against accidental recompiles.
	material.customProgramCacheKey = () => 'voxel-editor-terrain-v1';
	material.needsUpdate = true;
}
