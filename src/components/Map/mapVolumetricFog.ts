// Screen-space volumetric fog -- a pmndrs `postprocessing` Pass that raymarches
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
//   - March at HALF RESOLUTION into an offscreen target, then upscale + composite
//     to full res with a depth-aware bilateral filter (see mapVolumetricCompositor).
//     Half-res cuts the per-pixel march cost ~4x and the upscale doubles as a
//     denoise, so the result is both cheaper and far smoother than marching every
//     pixel directly.
//   - Reconstruct the world-space ray for this pixel from the depth buffer and
//     the camera's inverse-projection + world matrices (handles ortho AND
//     perspective uniformly; ray origin is per-pixel, so ortho is correct).
//   - Clip the ray to the fog volume's world-space AABB (slab method).
//   - Clamp the far end to the visible scene depth, so geometry occludes fog.
//   - March a fixed number of steps, sampling density from the 3D texture
//     (linear-filtered, so voxel cells melt into soft fog). Accumulate with
//     Beer-Lambert transmittance, front to back, with an early-out.
//   - Blue-noise dithered start offset hides banding at low step counts. Blue
//     noise (not a white-noise hash) keeps the residual grain fine and ordered,
//     and it is static (not reseeded per frame) so it does not boil.
//
// The march writes PREMULTIPLIED fog -- rgb = in-scattered light weighted by
// coverage, a = coverage (1 - transmittance) -- and the compositor does the
// scene blend. Density is texture-only (no per-step procedural noise): the
// painted voxel volume is the shape, linear filtering does the smoothing, and a
// small bounded sinusoidal shimmer of the sample position keeps it alive without
// letting the fog drift outside the painted bounds.
//
// Step count is baked into the shader at construction (GLSL loop bounds must be
// constant), so performance mode builds a separate, lower-step instance.

import * as THREE from 'three';
import { Pass } from 'postprocessing';
import type { VoxelTerrainFogVolume } from './Terrain/geometry/VoxelTerrainGeometryUtils';
import { createVolumetricFogCompositorMaterial } from './mapVolumetricCompositor';

// ---------------------------------------------------------------------------
// Tuning defaults
// ---------------------------------------------------------------------------

// Half-res marching buys headroom, so these run higher than the old full-res
// counts (12 / 6) while still costing less overall. Enough steps to resolve the
// fBm detail without ghosting.
export const VOLUMETRIC_FOG_STEPS_FULL = 32;
export const VOLUMETRIC_FOG_STEPS_PERFORMANCE = 16;

/** Fog albedo for wispy/low-density regions (lighter, sky-lit). */
const FOG_COLOR_LOW = new THREE.Color(0.90, 0.92, 0.96);
/** Fog albedo for dense cores (darker/cooler -- fakes self-shadowing). */
const FOG_COLOR_HIGH = new THREE.Color(0.58, 0.62, 0.70);
/** Ambient floor (0) .. fully sky-lit at the top of the volume (1). */
const FOG_AMBIENT = 0.35;
/** Multiplies the modulated density. Higher = denser fog for the same voxels. */
const FOG_DENSITY_SCALE = 1.8;
/** Beer-Lambert absorption. Higher = fog goes opaque over a shorter distance. */
const FOG_ABSORPTION = 0.7;

// --- Animated 3D fBm detail (the actual fog texture) ----------------------
// The painted volume only defines WHERE fog can be (a binary mask). The look --
// fluffy, irregular, parallaxing, alive -- comes from multiplying that mask by a
// multi-octave 3D value-noise field sampled in WORLD space and scrolled over
// time. Sampling at world position is what gives correct parallax (the noise is
// fixed in the world, so panning/zooming reveals different slices) and stops the
// fog reading as a flat screen-space mask.

/** Edge length of the cubic value-noise texture the fBm is built from. */
const NOISE_TEXTURE_SIZE = 64;
/** World units -> noise UV at the base octave. Lower = bigger puffs. */
const NOISE_FREQUENCY = 0.12;
/** Contrast power applied to the normalized fBm. Higher = wispier with denser cores. */
const NOISE_CONTRAST = 1.8;
/** Noise scroll velocity (noise-UV units / second) -- the "wind". */
const NOISE_WIND = new THREE.Vector3(0.015, 0.004, 0.010);
/** fBm octaves baked into the shader loop. (Kept modest: no mipmaps, so high
 *  octaves would otherwise alias.) */
const NOISE_OCTAVES = 4;

/** Blue-noise dither texture (scalar, 64x64, tiled across the screen). */
const BLUE_NOISE_URL = '/materials/fog_251/blueNoise64.png';

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

/**
 * Tiling cubic value-noise texture used as the fBm source. Independent random
 * texels + linear filtering = value noise (smooth interpolation between lattice
 * points); RepeatWrapping makes it tile so it can be sampled at several octave
 * frequencies. Generated once.
 *
 * NO mipmaps: the march samples this inside a dynamic branch, where implicit-LOD
 * texture lookups have undefined derivatives and can pick garbage mip levels
 * (which, with 3D-texture mipmap generation being a flaky path on ANGLE/D3D11,
 * sample as black and kill all density). The shader samples with explicit LOD 0
 * instead, so a single level is all we need.
 */
function createValueNoiseTexture(size: number): THREE.Data3DTexture {
	const data = new Uint8Array(size * size * size);
	for (let i = 0; i < data.length; i++) {
		data[i] = (Math.random() * 256) | 0;
	}
	const texture = new THREE.Data3DTexture(data, size, size, size);
	texture.format = THREE.RedFormat;
	texture.type = THREE.UnsignedByteType;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.wrapR = THREE.RepeatWrapping;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

/** 1x1 mid-grey stand-in bound until the real blue-noise texture loads. */
function createPlaceholderBlueNoise(): THREE.DataTexture {
	const texture = new THREE.DataTexture(
		new Uint8Array([128, 128, 128, 255]),
		1,
		1,
		THREE.RGBAFormat
	);
	texture.needsUpdate = true;
	return texture;
}

function loadBlueNoiseTexture(onLoad: (texture: THREE.Texture) => void): void {
	new THREE.TextureLoader().load(BLUE_NOISE_URL, (texture) => {
		// texelFetch reads raw integer texels: nearest, no mips, treat as data.
		texture.magFilter = THREE.NearestFilter;
		texture.minFilter = THREE.NearestFilter;
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.generateMipmaps = false;
		texture.colorSpace = THREE.NoColorSpace;
		texture.needsUpdate = true;
		onLoad(texture);
	});
}

// ---------------------------------------------------------------------------
// March shader (renders the half-res fog target)
// ---------------------------------------------------------------------------

const MARCH_VERTEX = /* glsl */ `
out vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function buildMarchFragment(steps: number): string {
	return /* glsl */ `
	precision highp float;
	precision highp sampler3D;

	in vec2 vUv;
	out vec4 fragColor;

	uniform highp sampler3D uFogTexture;   // painted volume -- the fog's SHAPE (mask)
	uniform highp sampler3D uNoiseTexture; // tiling value noise -- the fog's TEXTURE
	uniform sampler2D uDepth;
	uniform sampler2D uBlueNoise;
	uniform int uBlueNoiseRes;
	uniform mat4 uProjectionInverse;
	uniform mat4 uCameraMatrixWorld;
	uniform vec3 uFogOrigin;
	uniform vec3 uFogSize;
	uniform vec3 uFogColorLow;
	uniform vec3 uFogColorHigh;
	uniform float uAmbient;
	uniform float uDensityScale;
	uniform float uAbsorption;
	uniform float uNoiseFrequency;
	uniform float uNoiseContrast;
	uniform vec3 uNoiseWind;
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

	// Painted-volume mask (0..1): WHERE fog is allowed. Binary voxels, trilinearly
	// softened, so this alone is a featureless slab -- the detail comes from fBm.
	float sampleMask(vec3 p) {
		vec3 uvw = (p - uFogOrigin) / uFogSize;
		if (any(lessThan(uvw, vec3(0.0))) || any(greaterThan(uvw, vec3(1.0)))) return 0.0;
		return texture(uFogTexture, uvw).r;
	}

	// Multi-octave value noise from the tiling 3D texture. Each octave doubles the
	// frequency (non-integer lacunarity so tiles don't align) and halves the
	// weight -- classic fBm. Returns ~0..1. Explicit LOD 0 (textureLod) because
	// this runs inside a dynamic branch where implicit derivatives are undefined.
	float fbm(vec3 p) {
		float sum = 0.0;
		float amp = 1.0;
		float total = 0.0;
		for (int i = 0; i < ${NOISE_OCTAVES}; i++) {
			sum += textureLod(uNoiseTexture, p, 0.0).r * amp;
			total += amp;
			p *= 2.02;
			amp *= 0.5;
		}
		return sum / total;
	}

	void main() {
		if (uEnabled < 0.5) { fragColor = vec4(0.0); return; }

		float sceneDepth = texture(uDepth, vUv).x;
		vec3 ro = worldFromDepth(vUv, -1.0);
		vec3 scenePos = worldFromDepth(vUv, sceneDepth * 2.0 - 1.0);
		vec3 rd = scenePos - ro;
		float sceneDist = length(rd);
		rd /= max(sceneDist, 1e-5);

		float t0, t1;
		if (!clipBox(ro, rd, uFogOrigin, uFogOrigin + uFogSize, t0, t1)) {
			fragColor = vec4(0.0);
			return;
		}
		t0 = max(t0, 0.0);
		t1 = min(t1, sceneDist); // depth occlusion: stop at visible geometry
		if (t1 <= t0) { fragColor = vec4(0.0); return; }

		float stepSize = (t1 - t0) / float(${steps});
		// Blue-noise dithered start offset to de-band the (now low) step count.
		float dither = texelFetch(uBlueNoise, ivec2(gl_FragCoord.xy) % uBlueNoiseRes, 0).r;
		float t = t0 + stepSize * dither;

		// World-space wind offset applied to the noise sample (NOT the march point),
		// so the fog drifts but stays inside the painted bounds.
		vec3 wind = uNoiseWind * uTime;

		float transmittance = 1.0;
		vec3 scattered = vec3(0.0);

		for (int i = 0; i < ${steps}; i++) {
			if (t > t1) break;
			vec3 p = ro + rd * t;
			float mask = sampleMask(p);
			if (mask > 0.001) {
				// Detail lives in WORLD space -> correct parallax, stable when the
				// camera moves, and animated by the wind scroll.
				float detail = fbm(p * uNoiseFrequency + wind);
				detail = pow(clamp(detail, 0.0, 1.0), uNoiseContrast);
				float d = mask * detail * uDensityScale;
				if (d > 0.001) {
					float a = 1.0 - exp(-d * stepSize * uAbsorption);
					// Density-based colour: wisps glow light, dense cores go darker
					// and cooler -- cheap fake self-shadowing/scattering. Plus a mild
					// sky-lit gradient toward the top of the volume.
					vec3 baseCol = mix(uFogColorLow, uFogColorHigh, detail);
					float height = clamp((p.y - uFogOrigin.y) / max(uFogSize.y, 1e-3), 0.0, 1.0);
					vec3 col = baseCol * (uAmbient + (1.0 - uAmbient) * height);
					scattered += transmittance * col * a;
					transmittance *= 1.0 - a;
					if (transmittance < 0.02) break;
				}
			}
			t += stepSize;
		}

		// Premultiplied fog: rgb already weighted by coverage, a = coverage.
		fragColor = vec4(scattered, 1.0 - transmittance);
	}
	`;
}

function buildMarchMaterial(steps: number): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		name: 'VolumetricFogMarchMaterial',
		glslVersion: THREE.GLSL3,
		depthWrite: false,
		depthTest: false,
		uniforms: {
			uFogTexture: new THREE.Uniform(null),
			uNoiseTexture: new THREE.Uniform(null),
			uDepth: new THREE.Uniform(null),
			uBlueNoise: new THREE.Uniform(null),
			uBlueNoiseRes: new THREE.Uniform(1),
			uProjectionInverse: new THREE.Uniform(new THREE.Matrix4()),
			uCameraMatrixWorld: new THREE.Uniform(new THREE.Matrix4()),
			uFogOrigin: new THREE.Uniform(new THREE.Vector3()),
			uFogSize: new THREE.Uniform(new THREE.Vector3(1, 1, 1)),
			uFogColorLow: new THREE.Uniform(FOG_COLOR_LOW.clone()),
			uFogColorHigh: new THREE.Uniform(FOG_COLOR_HIGH.clone()),
			uAmbient: new THREE.Uniform(FOG_AMBIENT),
			uDensityScale: new THREE.Uniform(FOG_DENSITY_SCALE),
			uAbsorption: new THREE.Uniform(FOG_ABSORPTION),
			uNoiseFrequency: new THREE.Uniform(NOISE_FREQUENCY),
			uNoiseContrast: new THREE.Uniform(NOISE_CONTRAST),
			uNoiseWind: new THREE.Uniform(NOISE_WIND.clone()),
			uTime: new THREE.Uniform(0),
			uEnabled: new THREE.Uniform(0),
		},
		vertexShader: MARCH_VERTEX,
		fragmentShader: buildMarchFragment(steps),
	});
}

// ---------------------------------------------------------------------------
// Pass
// ---------------------------------------------------------------------------

export class VolumetricFogPass extends Pass {
	private fogCamera: THREE.Camera | null;
	private elapsed = 0;
	private readonly marchMaterial: THREE.ShaderMaterial;
	private readonly compositorMaterial: THREE.ShaderMaterial;
	private readonly fogRenderTarget: THREE.WebGLRenderTarget;
	private readonly placeholderFogTexture: THREE.Data3DTexture;
	private readonly placeholderBlueNoise: THREE.DataTexture;
	private readonly noiseTexture: THREE.Data3DTexture;

	constructor(camera: THREE.Camera | null, steps: number) {
		super('VolumetricFogPass');
		// Reads the scene depth produced by the upstream RenderPass; writes the
		// composited result to the output buffer for the next pass (bloom).
		this.needsDepthTexture = true;
		this.needsSwap = true;

		// Disabled until a fog volume is bound, so maps with no fog pay nothing
		// (the composer skips disabled passes entirely).
		this.enabled = false;

		this.fogCamera = camera;
		this.placeholderFogTexture = createPlaceholderFogTexture();
		this.placeholderBlueNoise = createPlaceholderBlueNoise();
		this.noiseTexture = createValueNoiseTexture(NOISE_TEXTURE_SIZE);

		this.marchMaterial = buildMarchMaterial(steps);
		this.marchMaterial.uniforms.uFogTexture.value = this.placeholderFogTexture;
		this.marchMaterial.uniforms.uBlueNoise.value = this.placeholderBlueNoise;
		this.marchMaterial.uniforms.uNoiseTexture.value = this.noiseTexture;
		this.compositorMaterial = createVolumetricFogCompositorMaterial();

		// Half-res offscreen target for the march. Sized in setSize().
		this.fogRenderTarget = new THREE.WebGLRenderTarget(1, 1, {
			type: THREE.HalfFloatType,
			format: THREE.RGBAFormat,
			depthBuffer: false,
			stencilBuffer: false,
		});

		loadBlueNoiseTexture((texture) => {
			this.marchMaterial.uniforms.uBlueNoise.value = texture;
			this.marchMaterial.uniforms.uBlueNoiseRes.value =
				(texture.image as { width: number }).width;
		});
	}

	/** Swap the camera (tactical <-> first-person) without rebuilding the pass. */
	setCamera(camera: THREE.Camera): void {
		this.fogCamera = camera;
	}

	/**
	 * Bind (or clear) the active fog volume. Pass null to disable the pass
	 * entirely (the composer skips it, so it costs nothing when there is no fog).
	 */
	setFogVolume(volume: FogVolumeTexture | null): void {
		const u = this.marchMaterial.uniforms;
		if (!volume) {
			u.uFogTexture.value = this.placeholderFogTexture;
			u.uEnabled.value = 0;
			// Skip the pass wholesale when there is no fog (saves the half-res
			// march AND the full-res composite every frame).
			this.enabled = false;
			return;
		}
		u.uFogTexture.value = volume.texture;
		(u.uFogOrigin.value as THREE.Vector3).copy(volume.origin);
		(u.uFogSize.value as THREE.Vector3).copy(volume.size);
		u.uEnabled.value = 1;
		this.enabled = true;
	}

	override setDepthTexture(
		depthTexture: THREE.Texture,
		_depthPacking?: THREE.DepthPackingStrategies
	): void {
		this.marchMaterial.uniforms.uDepth.value = depthTexture;
		this.compositorMaterial.uniforms.tDepth.value = depthTexture;
	}

	override setSize(width: number, height: number): void {
		this.fogRenderTarget.setSize(
			Math.max(1, Math.ceil(width * 0.5)),
			Math.max(1, Math.ceil(height * 0.5))
		);
		this.compositorMaterial.uniforms.uResolution.value.set(width, height);
	}

	override render(
		renderer: THREE.WebGLRenderer,
		inputBuffer: THREE.WebGLRenderTarget | null,
		outputBuffer: THREE.WebGLRenderTarget | null,
		deltaTime = 0
	): void {
		this.elapsed += deltaTime;
		this.marchMaterial.uniforms.uTime.value = this.elapsed;

		const camera = this.fogCamera;
		if (camera) {
			camera.updateMatrixWorld();
			const projection = (camera as
				| THREE.PerspectiveCamera
				| THREE.OrthographicCamera).projectionMatrix;
			(this.marchMaterial.uniforms.uProjectionInverse.value as THREE.Matrix4)
				.copy(projection)
				.invert();
			(this.marchMaterial.uniforms.uCameraMatrixWorld.value as THREE.Matrix4)
				.copy(camera.matrixWorld);
			(this.compositorMaterial.uniforms.uProjectionInverse.value as THREE.Matrix4)
				.copy(projection)
				.invert();
		}

		// 1. March the fog at half resolution into the offscreen target.
		this.fullscreenMaterial = this.marchMaterial;
		renderer.setRenderTarget(this.fogRenderTarget);
		renderer.render(this.scene, this.camera);

		// 2. Upscale + composite over the scene into the output buffer.
		this.compositorMaterial.uniforms.tFog.value = this.fogRenderTarget.texture;
		this.compositorMaterial.uniforms.tDiffuse.value = inputBuffer
			? inputBuffer.texture
			: null;
		this.fullscreenMaterial = this.compositorMaterial;
		renderer.setRenderTarget(this.renderToScreen ? null : outputBuffer);
		renderer.render(this.scene, this.camera);
	}

	override dispose(): void {
		this.marchMaterial.dispose();
		this.compositorMaterial.dispose();
		this.fogRenderTarget.dispose();
		this.placeholderFogTexture.dispose();
		this.placeholderBlueNoise.dispose();
		this.noiseTexture.dispose();
		super.dispose();
	}
}
