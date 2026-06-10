import * as THREE from 'three';
import {
	BloomEffect,
	DepthOfFieldEffect,
	EffectComposer,
	EffectPass,
	RenderPass,
} from 'postprocessing';
import { THREE_D_MAP_BLOOM, THREE_D_MAP_DOF } from './threeDMapConstants';
import {
	VolumetricFogPass,
	VOLUMETRIC_FOG_STEPS_FULL,
	VOLUMETRIC_FOG_STEPS_PERFORMANCE,
	type FogVolumeTexture,
} from './mapVolumetricFog';

export interface ThreeDMapPostProcessing {
	render: () => void;
	setSize: (width: number, height: number) => void;
	dispose: () => void;
	setCamera: (camera: THREE.Camera) => void;
	/** Bind the active fog-density volume (or null to disable fog). */
	setFogVolume: (volume: FogVolumeTexture | null) => void;
	/**
	 * Aim the depth-of-field distance blur: `target` (world space) is kept in
	 * focus each frame, sharp within `range` world units of it, blurring
	 * progressively beyond. No-op in performance mode (the effect is skipped).
	 */
	setDepthOfFieldFocus: (target: THREE.Vector3, range: number) => void;
}

interface ThreeDMapPostProcessingOptions {
	performanceMode?: boolean;
}

export function createThreeDMapPostProcessing(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera,
	options: ThreeDMapPostProcessingOptions = {}
): ThreeDMapPostProcessing {
	const bloom = options.performanceMode
		? {
				intensity: THREE_D_MAP_BLOOM.PERFORMANCE_INTENSITY,
				luminanceThreshold: THREE_D_MAP_BLOOM.PERFORMANCE_LUMINANCE_THRESHOLD,
				luminanceSmoothing: THREE_D_MAP_BLOOM.PERFORMANCE_LUMINANCE_SMOOTHING,
				radius: THREE_D_MAP_BLOOM.PERFORMANCE_RADIUS,
				levels: THREE_D_MAP_BLOOM.PERFORMANCE_LEVELS,
				multisampling: THREE_D_MAP_BLOOM.PERFORMANCE_MULTISAMPLING,
				mipmapBlur: false,
		  }
		: {
				intensity: THREE_D_MAP_BLOOM.INTENSITY,
				luminanceThreshold: THREE_D_MAP_BLOOM.LUMINANCE_THRESHOLD,
				luminanceSmoothing: THREE_D_MAP_BLOOM.LUMINANCE_SMOOTHING,
				radius: THREE_D_MAP_BLOOM.RADIUS,
				levels: THREE_D_MAP_BLOOM.LEVELS,
				multisampling: THREE_D_MAP_BLOOM.MULTISAMPLING,
				mipmapBlur: true,
		  };
	const composer = new EffectComposer(renderer, {
		frameBufferType: THREE.HalfFloatType,
		multisampling: renderer.capabilities.isWebGL2
			? bloom.multisampling
			: 0,
	});

	const renderPass = new RenderPass(scene, camera);

	// Volumetric fog: its own depth-reading pass, composited onto the rendered
	// scene BEFORE bloom so dense fog can bloom. Marches at half resolution and
	// upscales (see mapVolumetricFog), with fewer raymarch steps in performance
	// mode (same shader/look, just coarser). The composer wires a depth texture
	// automatically because this pass declares needsDepthTexture.
	const fogPass = new VolumetricFogPass(
		camera,
		options.performanceMode
			? VOLUMETRIC_FOG_STEPS_PERFORMANCE
			: VOLUMETRIC_FOG_STEPS_FULL
	);

	// Distance blur: depth-of-field auto-focused on a world target (the terrain
	// center, supplied later via setDepthOfFieldFocus once terrain extents are
	// known). Keeps the playable area sharp and progressively blurs the far
	// surroundings, which also hides procedural-material aliasing at distance.
	// Works for both camera types -- the CoC material operates in linear depth
	// and re-adopts camera settings through the EffectPass mainCamera setter.
	// Skipped in performance mode. Until the first setDepthOfFieldFocus call,
	// the huge UNFOCUSED_RANGE keeps the whole scene effectively sharp.
	const dofEffect = options.performanceMode
		? null
		: new DepthOfFieldEffect(camera, {
				worldFocusRange: THREE_D_MAP_DOF.UNFOCUSED_RANGE,
				bokehScale: THREE_D_MAP_DOF.BOKEH_SCALE,
				resolutionScale: THREE_D_MAP_DOF.RESOLUTION_SCALE,
		  });
	// The CoC material stores the focus range normalized against the active
	// camera's near/far slab, which differs between the ortho world camera and
	// the perspective/first-person cameras. Track the range in world units so
	// setCamera can re-apply it after every swap.
	let dofFocusRange: number = THREE_D_MAP_DOF.UNFOCUSED_RANGE;

	const effectPass = new EffectPass(
		camera,
		...(dofEffect ? [dofEffect] : []),
		new BloomEffect({
			intensity: bloom.intensity,
			luminanceThreshold: bloom.luminanceThreshold,
			luminanceSmoothing: bloom.luminanceSmoothing,
			mipmapBlur: bloom.mipmapBlur,
			radius: bloom.radius,
			levels: bloom.levels,
		})
	);
	composer.addPass(renderPass);
	composer.addPass(fogPass);
	composer.addPass(effectPass);

	return {
		render: () => composer.render(),
		setSize: (width, height) => composer.setSize(width, height),
		dispose: () => composer.dispose(),
		setCamera: (newCamera: THREE.Camera) => {
			renderPass.mainCamera = newCamera;
			effectPass.mainCamera = newCamera;
			fogPass.setCamera(newCamera);
			if (dofEffect) {
				dofEffect.cocMaterial.worldFocusRange = dofFocusRange;
			}
		},
		setFogVolume: (volume) => fogPass.setFogVolume(volume),
		setDepthOfFieldFocus: (target, range) => {
			if (!dofEffect) return;
			dofEffect.target = target;
			dofEffect.cocMaterial.worldFocusRange = range;
			dofFocusRange = range;
		},
	};
}
