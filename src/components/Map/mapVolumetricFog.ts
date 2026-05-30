// Screen-space volumetric fog -- a pmndrs `postprocessing` Effect that raymarches
// the terrain's fog-density 3D texture (built by the geometry worker from
// volumetric-flagged voxels; see VoxelTerrainGeometryUtils + fog251Material).
//
// Why screen-space volumetric instead of a surface-shaded fog mesh: a fog mesh
// is a hollow shell with zero thickness, so a camera *inside* the volume sees
// straight out. Marching the volume per pixel against the scene depth buffer is
// consistent from any camera -- it obscures vision correctly both from the
// tactical (orthographic) view and when the first-person camera is submerged.
//
// Technique:
//   - Reconstruct the world-space ray for this pixel from the depth buffer and
//     the camera's inverse-projection + world matrices (handles ortho AND
//     perspective uniformly).
//   - Clip the ray to the fog volume's world-space AABB (slab method).
//   - Clamp the far end to the visible scene depth, so geometry occludes fog.
//   - March a fixed number of steps, sampling density from the 3D texture
//     (linear-filtered, so voxel cells melt into soft fog). Accumulate with
//     Beer-Lambert transmittance, front to back, with an early-out.
//   - Per-pixel dithered start offset hides banding at low step counts.
//
// Density is texture-only (no per-step procedural noise): the painted voxel
// volume is the shape, linear filtering does the smoothing, and a small bounded
// sinusoidal shimmer of the sample position keeps it alive without letting the
// fog drift outside the painted bounds.
//
// Step count is baked into the shader at construction (GLSL loop bounds must be
// constant), so performance mode builds a separate, lower-step instance.

import * as THREE from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';
import type { VoxelTerrainFogVolume } from './Terrain/geometry/VoxelTerrainGeometryUtils';

// ---------------------------------------------------------------------------
// Tuning defaults
// ---------------------------------------------------------------------------

export const VOLUMETRIC_FOG_STEPS_FULL = 12;
export const VOLUMETRIC_FOG_STEPS_PERFORMANCE = 6;

/** Base fog albedo before lighting. Light cool grey. */
const FOG_COLOR = new THREE.Color(0.82, 0.85, 0.90);
/** Ambient floor (0) .. fully sky-lit at the top of the volume (1). */
const FOG_AMBIENT = 0.25;
/** Multiplies sampled density (0..1). Higher = denser fog for the same voxels. */
const FOG_DENSITY_SCALE = 0.4;
/** Beer-Lambert absorption. Higher = fog goes opaque over a shorter distance. */
const FOG_ABSORPTION = 0.8;
/** Amplitude (world units) of the bounded animated shimmer. */
const FOG_SHIMMER = 0.15;

// ---------------------------------------------------------------------------
// Fog-density 3D texture (mirrors createVoxelAoTexture)
// ---------------------------------------------------------------------------

export interface FogVolumeTexture {
	texture: THREE.Data3DTexture;
	origin: THREE.Vector3;
	size: THREE.Vector3;
}

function configureFogTexture(texture: THREE.Data3DTexture): void {
	texture.format = THREE.RedFormat;
	texture.type = THREE.UnsignedByteType;
	// Linear filtering melts the binary voxel cells into a smooth density field.
	texture.magFilter = THREE.LinearFilter;
	texture.minFilter = THREE.LinearFilter;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.wrapR = THREE.ClampToEdgeWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
}

/** Wrap a worker fog-density snapshot as a sampler-ready 3D texture. */
export function createFogVolumeTexture(
	fogVolume: VoxelTerrainFogVolume
): FogVolumeTexture {
	const texture = new THREE.Data3DTexture(
		fogVolume.data,
		fogVolume.voxelWidth,
		fogVolume.voxelHeight,
		fogVolume.voxelLength
	);
	configureFogTexture(texture);
	return {
		texture,
		origin: new THREE.Vector3(
			fogVolume.worldOriginX,
			fogVolume.worldOriginY,
			fogVolume.worldOriginZ
		),
		size: new THREE.Vector3(
			fogVolume.worldSizeX,
			fogVolume.worldSizeY,
			fogVolume.worldSizeZ
		),
	};
}

/** 1x1x1 empty texture bound when no fog is present (effect disabled). */
function createPlaceholderFogTexture(): THREE.Data3DTexture {
	const texture = new THREE.Data3DTexture(new Uint8Array(1), 1, 1, 1);
	configureFogTexture(texture);
	return texture;
}

// ---------------------------------------------------------------------------
// Fragment shader
// ---------------------------------------------------------------------------

function buildFragmentShader(steps: number): string {
	return /* glsl */ `
	uniform highp sampler3D uFogTexture;
	uniform mat4 uProjectionInverse;
	uniform mat4 uCameraMatrixWorld;
	uniform vec3 uFogOrigin;
	uniform vec3 uFogSize;
	uniform vec3 uFogColor;
	uniform float uAmbient;
	uniform float uDensityScale;
	uniform float uAbsorption;
	uniform float uShimmer;
	uniform float uTime;
	uniform float uEnabled;

	vec3 worldFromDepth(vec2 uvCoord, float ndcZ) {
		vec4 clip = vec4(uvCoord * 2.0 - 1.0, ndcZ, 1.0);
		vec4 view = uProjectionInverse * clip;
		view /= view.w;
		vec4 world = uCameraMatrixWorld * view;
		return world.xyz;
	}

	// Slab-method ray/AABB. Returns whether the ray hits, with entry/exit t.
	bool clipBox(vec3 ro, vec3 rd, vec3 bmin, vec3 bmax, out float t0, out float t1) {
		vec3 inv = 1.0 / rd;
		vec3 a = (bmin - ro) * inv;
		vec3 b = (bmax - ro) * inv;
		vec3 tmin = min(a, b);
		vec3 tmax = max(a, b);
		t0 = max(max(tmin.x, tmin.y), tmin.z);
		t1 = min(min(tmax.x, tmax.y), tmax.z);
		return t1 > max(t0, 0.0);
	}

	float sampleFog(vec3 p) {
		vec3 uvw = (p - uFogOrigin) / uFogSize;
		if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
		return texture(uFogTexture, uvw).r;
	}

	void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
		if (uEnabled < 0.5) { outputColor = inputColor; return; }

		vec3 ro = worldFromDepth(uv, -1.0);
		vec3 scenePos = worldFromDepth(uv, depth * 2.0 - 1.0);
		vec3 rd = scenePos - ro;
		float sceneDist = length(rd);
		rd /= max(sceneDist, 1e-5);

		float t0, t1;
		if (!clipBox(ro, rd, uFogOrigin, uFogOrigin + uFogSize, t0, t1)) {
			outputColor = inputColor;
			return;
		}
		t0 = max(t0, 0.0);
		t1 = min(t1, sceneDist); // depth occlusion: stop at visible geometry
		if (t1 <= t0) { outputColor = inputColor; return; }

		float stepSize = (t1 - t0) / float(${steps});
		// Per-pixel + temporal dither on the start offset to hide step banding.
		float dither = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453 + uTime);
		float t = t0 + stepSize * dither;

		float transmittance = 1.0;
		vec3 scattered = vec3(0.0);

		for (int i = 0; i < ${steps}; i++) {
			if (t > t1) break;
			vec3 p = ro + rd * t;
			// Small bounded shimmer -- no net drift, so fog stays in its bounds.
			vec3 sp = p + uShimmer * vec3(
				sin(p.y * 1.7 + uTime * 0.6),
				sin(p.x * 1.3 + uTime * 0.5),
				sin(p.z * 1.5 + uTime * 0.7)
			);
			float d = sampleFog(sp) * uDensityScale;
			if (d > 0.001) {
				float a = 1.0 - exp(-d * stepSize * uAbsorption);
				// Cheap lighting: ambient floor brightening toward the top of the
				// volume (sky-lit). No normals in a volume, so keep it simple.
				float height = clamp((p.y - uFogOrigin.y) / max(uFogSize.y, 1e-3), 0.0, 1.0);
				vec3 col = uFogColor * (uAmbient + (1.0 - uAmbient) * height);
				scattered += transmittance * col * a;
				transmittance *= 1.0 - a;
				if (transmittance < 0.02) break;
			}
			t += stepSize;
		}

		vec3 result = inputColor.rgb * transmittance + scattered;
		outputColor = vec4(result, 1.0);
	}
	`;
}

// ---------------------------------------------------------------------------
// Effect
// ---------------------------------------------------------------------------

export class VolumetricFogEffect extends Effect {
	private fogCamera: THREE.Camera | null;
	private elapsed = 0;
	private readonly placeholderTexture: THREE.Data3DTexture;

	constructor(camera: THREE.Camera | null, steps: number) {
		const placeholder = createPlaceholderFogTexture();
		super('VolumetricFogEffect', buildFragmentShader(steps), {
			attributes: EffectAttribute.DEPTH,
			blendFunction: BlendFunction.NORMAL,
			uniforms: new Map<string, THREE.Uniform>([
				['uFogTexture', new THREE.Uniform(placeholder)],
				['uProjectionInverse', new THREE.Uniform(new THREE.Matrix4())],
				['uCameraMatrixWorld', new THREE.Uniform(new THREE.Matrix4())],
				['uFogOrigin', new THREE.Uniform(new THREE.Vector3())],
				['uFogSize', new THREE.Uniform(new THREE.Vector3(1, 1, 1))],
				['uFogColor', new THREE.Uniform(FOG_COLOR.clone())],
				['uAmbient', new THREE.Uniform(FOG_AMBIENT)],
				['uDensityScale', new THREE.Uniform(FOG_DENSITY_SCALE)],
				['uAbsorption', new THREE.Uniform(FOG_ABSORPTION)],
				['uShimmer', new THREE.Uniform(FOG_SHIMMER)],
				['uTime', new THREE.Uniform(0)],
				['uEnabled', new THREE.Uniform(0)],
			]),
		});
		this.fogCamera = camera;
		this.placeholderTexture = placeholder;
	}

	/** Swap the camera (tactical <-> first-person) without rebuilding the pass. */
	setCamera(camera: THREE.Camera): void {
		this.fogCamera = camera;
	}

	/**
	 * Bind (or clear) the active fog volume. Pass null to disable the effect
	 * cheaply (the march early-outs; the placeholder texture stays bound).
	 */
	setFogVolume(volume: FogVolumeTexture | null): void {
		const u = this.uniforms;
		if (!volume) {
			u.get('uFogTexture')!.value = this.placeholderTexture;
			u.get('uEnabled')!.value = 0;
			return;
		}
		u.get('uFogTexture')!.value = volume.texture;
		(u.get('uFogOrigin')!.value as THREE.Vector3).copy(volume.origin);
		(u.get('uFogSize')!.value as THREE.Vector3).copy(volume.size);
		u.get('uEnabled')!.value = 1;
	}

	override update(
		_renderer: THREE.WebGLRenderer,
		_inputBuffer: THREE.WebGLRenderTarget,
		deltaTime = 0
	): void {
		this.elapsed += deltaTime;
		this.uniforms.get('uTime')!.value = this.elapsed;

		const camera = this.fogCamera;
		if (!camera) return;
		camera.updateMatrixWorld();
		(this.uniforms.get('uProjectionInverse')!.value as THREE.Matrix4)
			.copy((camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).projectionMatrix)
			.invert();
		(this.uniforms.get('uCameraMatrixWorld')!.value as THREE.Matrix4)
			.copy(camera.matrixWorld);
	}
}
