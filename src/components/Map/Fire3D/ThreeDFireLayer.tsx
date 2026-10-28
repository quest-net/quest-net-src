// Fire layer. Draws flames for fire voxels (palette 253); the voxels' own cube
// faces render invisibly.
//
// Each vertical run of fire voxels in one voxel column becomes one flame card,
// so a tall stack reads as one tall flame rather than a pile of small ones.
// Three things anchor a flame to what it stands on: the base fade and the noise
// are sized in voxels (not card height), so tall flames keep a short solid base
// and gain tongues instead of stretching; a contact glow is drawn on the surface
// under every grounded flame; and a fixed pool of point lights flickers on the
// biggest clusters. Embers rise above each flame, animated purely on the GPU.
// Flames are unlit and HDR, so the bloom pass picks them up.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { VoxelTerrainIndex } from "../../../utils/terrain/data/VoxelTerrainIndex";
import { voxelCenterToWorld } from "../../../utils/terrain/data/VoxelTerrainIndex";
import { decodeVoxelBuffers, unpackVoxel } from "../../../utils/terrain/data/VoxelDataUtils";
import type { ThreeDSceneResources } from "../Actors3D/actorTokenTypes";
import { THREE_D_FIRE } from "../threeDMapConstants";
import fire253Material from "../Terrain/materials/fire253Material";

// Read from the material record so the slot is defined in one place.
const FIRE_PALETTE_INDEX = fire253Material.special!.paletteIndex;


interface FireRun {
	/** World-space bottom center of the run. */
	x: number;
	y: number;
	z: number;
	/** Run height in voxels. */
	voxels: number;
	/** A solid voxel sits directly under the run (it gets a contact glow). */
	grounded: boolean;
}

interface FireData {
	runs: FireRun[];
	voxelSize: number;
	lights: THREE.Vector3[];
}

function collectFire(voxels: Uint8Array, index: VoxelTerrainIndex): FireData {
	const byColumn = new Map<number, number[]>();
	const clusters = new Map<string, { sum: THREE.Vector3; count: number }>();
	const res = index.resolution;
	const cellVoxels = THREE_D_FIRE.LIGHT_CELL_TILES * res;

	// Scan the raw typed arrays: this runs on every terrain change, and most
	// voxels are not fire, so build no per-voxel objects.
	const { positions, colors } = decodeVoxelBuffers(voxels);
	for (let i = 0; i < colors.length; i++) {
		if (colors[i] !== FIRE_PALETTE_INDEX) continue;
		const voxel = unpackVoxel(positions[i], colors[i]);
		const key = voxel.x + voxel.z * 65536;
		let ys = byColumn.get(key);
		if (!ys) byColumn.set(key, (ys = []));
		ys.push(voxel.y);

		const cellKey = `${Math.floor(voxel.x / cellVoxels)},${Math.floor(voxel.z / cellVoxels)}`;
		let cluster = clusters.get(cellKey);
		if (!cluster) clusters.set(cellKey, (cluster = { sum: new THREE.Vector3(), count: 0 }));
		const c = voxelCenterToWorld(index, voxel.x, voxel.y, voxel.z);
		cluster.sum.add(new THREE.Vector3(c.x, c.y, c.z));
		cluster.count++;
	}

	const runs: FireRun[] = [];
	for (const [key, ys] of byColumn) {
		const vx = key % 65536;
		const vz = Math.floor(key / 65536);
		ys.sort((a, b) => a - b);
		let start = 0;
		for (let i = 1; i <= ys.length; i++) {
			if (i < ys.length && ys[i] === ys[i - 1] + 1) continue;
			const bottom = ys[start];
			const c = voxelCenterToWorld(index, vx, bottom, vz);
			runs.push({
				x: c.x,
				y: c.y - 0.5 / res,
				z: c.z,
				voxels: i - start,
				grounded: bottom > 0 && index.hasVoxel(vx, bottom - 1, vz),
			});
			start = i;
		}
	}

	const lights = Array.from(clusters.values())
		.sort((a, b) => b.count - a.count)
		.slice(0, THREE_D_FIRE.LIGHT_COUNT)
		.map((cluster) => cluster.sum.divideScalar(cluster.count).add(new THREE.Vector3(0, 0.6, 0)));

	return { runs, voxelSize: index.voxelSize, lights };
}

// Deterministic per-flame randomness so identical runs don't read as a fence.
function rand(x: number, z: number, k: number): number {
	const s = Math.sin(x * 12.9898 + z * 78.233 + k * 37.719) * 43758.5453;
	return s - Math.floor(s);
}

/** Card placement for a run: base point (world) and size (world). */
function getFlameTransform(run: FireRun, voxelSize: number) {
	const heightScale = 0.75 + 0.55 * rand(run.x, run.z, 1);
	const widthScale = 0.85 + 0.35 * rand(run.x, run.z, 2);
	return {
		x: run.x + (rand(run.x, run.z, 3) - 0.5) * 0.3 * voxelSize,
		y: run.y - THREE_D_FIRE.SINK * voxelSize,
		z: run.z + (rand(run.x, run.z, 4) - 0.5) * 0.3 * voxelSize,
		width: THREE_D_FIRE.WIDTH * widthScale * voxelSize,
		height: (run.voxels + THREE_D_FIRE.OVERSHOOT) * heightScale * voxelSize,
	};
}

// ---------------------------------------------------------------------------
// GLSL
// ---------------------------------------------------------------------------

const FIRE_NOISE_GLSL = /* glsl */ `
uniform float uTime;
float fireHash(vec3 p) {
	p = fract(p * 0.3183099 + 0.1);
	p *= 17.0;
	return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float fireNoise(vec3 x) {
	vec3 i = floor(x);
	vec3 f = fract(x);
	f = f * f * (3.0 - 2.0 * f);
	return mix(
		mix(mix(fireHash(i), fireHash(i + vec3(1, 0, 0)), f.x),
			mix(fireHash(i + vec3(0, 1, 0)), fireHash(i + vec3(1, 1, 0)), f.x), f.y),
		mix(mix(fireHash(i + vec3(0, 0, 1)), fireHash(i + vec3(1, 0, 1)), f.x),
			mix(fireHash(i + vec3(0, 1, 1)), fireHash(i + vec3(1, 1, 1)), f.x), f.y),
		f.z);
}
float fireFbm(vec3 p) {
	float v = 0.0;
	float a = 0.5;
	for (int i = 0; i < 4; i++) {
		v += a * fireNoise(p);
		p = p * 2.03 + vec3(1.7, 9.2, 3.1);
		a *= 0.5;
	}
	return v;
}
`;

// heat 0..1 -> HDR blackbody-ish ramp. Values above 1 feed the bloom pass.
const FIRE_RAMP_GLSL = /* glsl */ `
vec3 fireRamp(float heat) {
	vec3 c = mix(vec3(0.55, 0.04, 0.0), vec3(1.5, 0.32, 0.02), smoothstep(0.0, 0.2, heat));
	c = mix(c, vec3(2.0, 0.95, 0.12), smoothstep(0.2, 0.5, heat));
	c = mix(c, vec3(2.0, 1.3, 0.4), smoothstep(0.5, 0.95, heat));
	return c;
}
`;

// Cards: rotated about the vertical axis to face the camera and leaned partly
// toward it so they still read from steep angles.
const CARD_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
varying float vHeightVoxels;
uniform float uVoxelSize;
void main() {
	vec3 base = instanceMatrix[3].xyz;
	float w = length(instanceMatrix[0].xyz);
	float h = length(instanceMatrix[1].xyz);
	vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
	right.y = 0.0;
	right = dot(right, right) > 1e-6 ? normalize(right) : vec3(1.0, 0.0, 0.0);
	vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
	vec3 up = normalize(mix(vec3(0.0, 1.0, 0.0), camUp, 0.45));
	vec3 world = base + right * position.x * w + up * (position.y + 0.5) * h;
	vUv = uv;
	vSeed = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
	vHeightVoxels = h / uVoxelSize;
	gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}
`;

const CARD_FRAGMENT = /* glsl */ `
${FIRE_NOISE_GLSL}
${FIRE_RAMP_GLSL}
varying vec2 vUv;
varying float vSeed;
varying float vHeightVoxels;
void main() {
	// q.x across the card (-1..1), q.y up the card (0..1).
	vec2 q = vec2(vUv.x * 2.0 - 1.0, vUv.y);
	// Height above the card bottom, in voxels: noise and the base fade use this
	// so a tall flame gains tongues and keeps a short base instead of stretching.
	float yv = vUv.y * vHeightVoxels;
	float t = uTime * (0.9 + vSeed * 0.3) + vSeed * 17.0;
	vec3 np = vec3(q.x * 2.2, yv * 1.25 - t * 2.2, vSeed * 13.0);
	// fBm clusters near 0.5; stretch it to roughly -1..1.
	float n1 = (fireFbm(np) - 0.5) * 2.6;
	float n2 = (fireFbm(np * 1.9 + vec3(5.2, -t * 0.8, 1.3)) - 0.5) * 2.6;
	float sway = (fireNoise(vec3(t * 0.9, vSeed * 7.0, 0.0)) - 0.5) * 0.5 * q.y * q.y;
	// Noise bends the outline (more toward the tip) and nudges it vertically.
	float x = q.x - sway + n1 * 0.35 * q.y;
	float y = q.y + n2 * 0.12;
	float halfWidth = mix(0.85, 0.08, clamp(pow(max(y, 0.0), 0.9), 0.0, 1.0));
	float body = 1.0 - abs(x) / max(halfWidth, 0.05);
	// A solid base whose top is eaten away by the rising noise.
	float heat = body * (0.6 + 0.6 * (1.0 - q.y)) - max(0.0, n2) * 0.5 * q.y - q.y * 0.15;
	// Rounded base, fixed in voxels: it starts where the card meets the
	// surface (SINK) and is solid half a voxel later at every card height.
	float baseFade = smoothstep(${(THREE_D_FIRE.SINK * 0.5).toFixed(2)}, ${(THREE_D_FIRE.SINK + 0.4).toFixed(2)}, yv - 0.3 * q.x * q.x);
	float alpha = smoothstep(0.0, 0.12, heat) * baseFade;
	if (alpha <= 0.001) discard;
	// Premultiplied: partly covers what is behind, partly adds to it.
	gl_FragColor = vec4(fireRamp(heat) * alpha, alpha * 0.6);
}
`;

// Contact glow: a soft flickering pool of firelight on the surface under a
// grounded flame. Added (not blended) since it is light.
const GLOW_VERTEX = /* glsl */ `
varying vec2 vUv;
varying float vSeed;
void main() {
	vec3 base = instanceMatrix[3].xyz;
	vUv = uv;
	vSeed = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
	gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
${FIRE_NOISE_GLSL}
varying vec2 vUv;
varying float vSeed;
void main() {
	float d = length(vUv - 0.5) * 2.0;
	float flicker = 0.75 + 0.5 * fireNoise(vec3(uTime * 3.0, vSeed * 31.0, 0.0));
	float glow = pow(max(0.0, 1.0 - d), 2.2) * flicker;
	if (glow <= 0.002) discard;
	gl_FragColor = vec4(vec3(1.0, 0.42, 0.1) * glow * 0.55, glow * 0.55);
}
`;

// Embers: points that rise from inside the flame, drift, and fade. Position
// is a pure function of time and per-point seed, so there is no CPU update.
const EMBER_VERTEX = /* glsl */ `
${FIRE_NOISE_GLSL}
attribute vec4 aEmber; // xyz = flame base (world), w = seed
attribute float aRise; // how far it climbs (world)
uniform float uVoxelSize;
uniform float uViewportHeight;
varying float vFade;
void main() {
	float seed = aEmber.w;
	float life = fract(uTime * (0.35 + 0.25 * seed) + seed * 7.13);
	vec3 drift = vec3(
		fireNoise(vec3(seed * 40.0, life * 2.0, 0.0)) - 0.5,
		0.0,
		fireNoise(vec3(0.0, life * 2.0, seed * 40.0)) - 0.5
	) * uVoxelSize * 1.6 * life;
	vec3 world = aEmber.xyz + drift + vec3(0.0, aRise * life + uVoxelSize * 0.4, 0.0);
	vFade = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.55, 1.0, life));
	gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
	// World size -> pixels, valid for both orthographic (w = 1) and perspective.
	float worldSize = uVoxelSize * (0.035 + 0.03 * seed);
	gl_PointSize = max(1.5, worldSize * projectionMatrix[1][1] * uViewportHeight * 0.5 / gl_Position.w);
}
`;

const EMBER_FRAGMENT = /* glsl */ `
varying float vFade;
void main() {
	float d = length(gl_PointCoord - 0.5) * 2.0;
	float a = (1.0 - smoothstep(0.4, 1.0, d)) * vFade;
	if (a <= 0.01) discard;
	// Alpha must match coverage: the canvas is transparent where there is no
	// terrain, and alpha 1 there would turn a faint ember into a dark dot.
	gl_FragColor = vec4(vec3(2.4, 1.0, 0.25) * a, a);
}
`;

const PREMULTIPLIED_BLENDING = {
	blending: THREE.CustomBlending,
	blendSrc: THREE.OneFactor,
	blendDst: THREE.OneMinusSrcAlphaFactor,
} as const;

interface ThreeDFireLayerProps {
	resources: ThreeDSceneResources;
	terrainVoxels: Uint8Array;
	terrainIndex: VoxelTerrainIndex;
}

export function ThreeDFireLayer({ resources, terrainVoxels, terrainIndex }: ThreeDFireLayerProps) {
	const fire = useMemo(
		() => collectFire(terrainVoxels, terrainIndex),
		// The revision is the value-equal identity of the voxel payload.
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[terrainIndex.revision]
	);

	useEffect(() => {
		if (fire.runs.length === 0) return;
		const { runs, voxelSize } = fire;
		const group = new THREE.Group();
		const timeUniform = { value: 0 };
		const voxelSizeUniform = { value: voxelSize };
		const viewportHeightUniform = { value: resources.domElement.height };
		const disposables: { dispose(): void }[] = [];
		const matrix = new THREE.Matrix4();

		// Flame cards.
		const cardGeometry = new THREE.PlaneGeometry(1, 1);
		const cardMaterial = new THREE.ShaderMaterial({
			vertexShader: CARD_VERTEX,
			fragmentShader: CARD_FRAGMENT,
			uniforms: { uTime: timeUniform, uVoxelSize: voxelSizeUniform },
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			...PREMULTIPLIED_BLENDING,
		});
		const cards = new THREE.InstancedMesh(cardGeometry, cardMaterial, runs.length);
		runs.forEach((run, i) => {
			const f = getFlameTransform(run, voxelSize);
			matrix.makeScale(f.width, f.height, f.width);
			matrix.setPosition(f.x, f.y, f.z);
			cards.setMatrixAt(i, matrix);
		});
		cards.frustumCulled = false; // the vertex shader moves the cards; the bounds are wrong
		cards.renderOrder = THREE_D_FIRE.RENDER_ORDER;
		group.add(cards);
		// The mesh itself owns the instance-matrix GPU buffer.
		disposables.push(cards, cardGeometry, cardMaterial);

		// Contact glow under grounded flames.
		const grounded = runs.filter((run) => run.grounded);
		if (grounded.length > 0) {
			const glowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
			const glowMaterial = new THREE.ShaderMaterial({
				vertexShader: GLOW_VERTEX,
				fragmentShader: GLOW_FRAGMENT,
				uniforms: { uTime: timeUniform },
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending,
				polygonOffset: true,
				polygonOffsetFactor: -1,
				polygonOffsetUnits: -4,
			});
			const glows = new THREE.InstancedMesh(glowGeometry, glowMaterial, grounded.length);
			const size = THREE_D_FIRE.GLOW_SIZE * voxelSize;
			grounded.forEach((run, i) => {
				matrix.makeScale(size, 1, size);
				matrix.setPosition(run.x, run.y + 0.002, run.z);
				glows.setMatrixAt(i, matrix);
			});
			glows.renderOrder = THREE_D_FIRE.RENDER_ORDER - 1;
			group.add(glows);
			disposables.push(glows, glowGeometry, glowMaterial);
		}

		// Embers.
		const emberCount = runs.length * THREE_D_FIRE.EMBERS_PER_FLAME;
		const emberData = new Float32Array(emberCount * 4);
		const emberRise = new Float32Array(emberCount);
		runs.forEach((run, i) => {
			const f = getFlameTransform(run, voxelSize);
			for (let k = 0; k < THREE_D_FIRE.EMBERS_PER_FLAME; k++) {
				const j = i * THREE_D_FIRE.EMBERS_PER_FLAME + k;
				emberData.set([f.x, f.y, f.z, rand(run.x, run.z, 10 + k)], j * 4);
				emberRise[j] = f.height + THREE_D_FIRE.EMBER_RISE * voxelSize;
			}
		});
		const emberGeometry = new THREE.BufferGeometry();
		// Positions are computed in the shader; three.js still needs a position attribute.
		emberGeometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(emberCount * 3), 3));
		emberGeometry.setAttribute("aEmber", new THREE.BufferAttribute(emberData, 4));
		emberGeometry.setAttribute("aRise", new THREE.BufferAttribute(emberRise, 1));
		const emberMaterial = new THREE.ShaderMaterial({
			vertexShader: EMBER_VERTEX,
			fragmentShader: EMBER_FRAGMENT,
			uniforms: {
				uTime: timeUniform,
				uVoxelSize: voxelSizeUniform,
				uViewportHeight: viewportHeightUniform,
			},
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		const embers = new THREE.Points(emberGeometry, emberMaterial);
		embers.frustumCulled = false;
		embers.renderOrder = THREE_D_FIRE.RENDER_ORDER + 1;
		group.add(embers);
		disposables.push(emberGeometry, emberMaterial);

		// Always the full pool while any fire exists: three.js bakes the light
		// count into every shader, so a count that followed the cluster count
		// would recompile all terrain materials on each fire edit. Spare lights
		// sit at intensity 0.
		const lights = Array.from({ length: THREE_D_FIRE.LIGHT_COUNT }, (_, i) => {
			const position = fire.lights[i];
			const light = new THREE.PointLight(
				THREE_D_FIRE.LIGHT_COLOR,
				position ? THREE_D_FIRE.LIGHT_INTENSITY : 0,
				THREE_D_FIRE.LIGHT_DISTANCE,
				THREE_D_FIRE.LIGHT_DECAY
			);
			if (position) light.position.copy(position);
			group.add(light);
			return light;
		});
		const litCount = fire.lights.length;

		resources.scene.add(group);
		if (import.meta.env.DEV) (window as any).__qnFireLayer = group; // test kit's fire-look scenario
		const tick = (now: number) => {
			const t = now * 0.001;
			timeUniform.value = t;
			viewportHeightUniform.value = resources.domElement.height;
			lights.forEach((light, i) => {
				if (i >= litCount) return;
				const flicker =
					0.8 + 0.12 * Math.sin(t * 9.1 + i * 2.3) + 0.08 * Math.sin(t * 23.7 + i * 5.1);
				light.intensity = THREE_D_FIRE.LIGHT_INTENSITY * flicker;
			});
		};
		resources.animationCallbacks.add(tick);

		return () => {
			resources.animationCallbacks.delete(tick);
			resources.scene.remove(group);
			for (const d of disposables) d.dispose();
		};
	}, [resources, fire]);

	return null;
}
