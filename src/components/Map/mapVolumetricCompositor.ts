// Upscale + composite material for the half-resolution volumetric fog pass.
//
// The fog march (see mapVolumetricFog) runs at half resolution into an offscreen
// target to cut the per-pixel raymarch cost ~4x. This material upscales that
// half-res result back to full resolution and composites it over the rendered
// scene. A naive bilinear upscale would halo fog across depth discontinuities
// (fog bleeding past the silhouette of a wall or actor); instead we do a small
// depth-aware "edge push": for each full-res pixel we nudge the fog sample
// toward neighbours that lie on the same surface (similar view-space Z), which
// keeps fog edges crisp against geometry. Adapted from the bilateral upscale in
// Ameobea/three-volumetric-pass (compositor.frag), reworked to use view-space Z
// reconstructed from the projection inverse so it is correct for BOTH the
// orthographic tactical camera and the perspective first-person camera.
//
// The fog target stores PREMULTIPLIED fog: rgb = in-scattered light already
// weighted by coverage, a = coverage (1 - transmittance). So compositing is a
// plain premultiplied-over: scene * (1 - a) + rgb. (Do NOT use mix() here -- the
// fog rgb is already premultiplied, unlike the source library which kept colour
// and density separate.)

import * as THREE from 'three';

const COMPOSITOR_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMPOSITOR_FRAGMENT = /* glsl */ `
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D tFog;          // half-res, premultiplied fog (rgb = scattered, a = coverage)
uniform sampler2D tDiffuse;      // full-res rendered scene
uniform highp sampler2D tDepth;  // full-res scene depth (raw, non-linear)
uniform mat4 uProjectionInverse;
uniform vec2 uResolution;        // full-res
uniform float uEdgeStrength;

// Baked constant so the loop bounds are unambiguous across drivers.
const float EDGE_RADIUS = 2.0;

// View-space Z from raw depth. Works for ortho (w stays 1) and perspective alike.
float viewZ(vec2 uvCoord, float rawDepth) {
	vec4 clip = vec4(uvCoord * 2.0 - 1.0, rawDepth * 2.0 - 1.0, 1.0);
	vec4 view = uProjectionInverse * clip;
	return view.z / view.w;
}

void main() {
	float d0 = texture(tDepth, vUv).x;
	float z0 = viewZ(vUv, d0);

	// Steer the fog sample toward neighbours on the same surface so the upscaled
	// half-res fog does not halo across depth edges.
	vec2 push = vec2(0.0);
	float count = 0.0;
	for (float x = -EDGE_RADIUS; x <= EDGE_RADIUS; x += 1.0) {
		for (float y = -EDGE_RADIUS; y <= EDGE_RADIUS; y += 1.0) {
			vec2 off = vec2(x, y) / uResolution;
			float zs = viewZ(vUv + off, texture(tDepth, vUv + off).x);
			if (abs(zs - z0) < 0.05 * abs(z0)) {
				push += vec2(x, y);
				count += 1.0;
			}
		}
	}
	if (count == 0.0) count = 1.0;
	push /= count;
	vec2 fogUv = length(push) > 0.0
		? vUv + uEdgeStrength * (normalize(push) / uResolution)
		: vUv;

	vec4 fog = texture(tFog, fogUv);
	vec3 scene = texture(tDiffuse, vUv).rgb;
	// Premultiplied-over composite.
	fragColor = vec4(scene * (1.0 - fog.a) + fog.rgb, 1.0);
}
`;

/** Strength (in pixels) of the depth-aware edge push during upscale. */
const FOG_COMPOSITOR_EDGE_STRENGTH = 2.0;

/** Build the fullscreen material that upscales + composites the fog target. */
export function createVolumetricFogCompositorMaterial(): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		name: 'VolumetricFogCompositorMaterial',
		glslVersion: THREE.GLSL3,
		depthWrite: false,
		depthTest: false,
		uniforms: {
			tFog: new THREE.Uniform(null),
			tDiffuse: new THREE.Uniform(null),
			tDepth: new THREE.Uniform(null),
			uProjectionInverse: new THREE.Uniform(new THREE.Matrix4()),
			uResolution: new THREE.Uniform(new THREE.Vector2(1, 1)),
			uEdgeStrength: new THREE.Uniform(FOG_COMPOSITOR_EDGE_STRENGTH),
		},
		vertexShader: COMPOSITOR_VERTEX,
		fragmentShader: COMPOSITOR_FRAGMENT,
	});
}
