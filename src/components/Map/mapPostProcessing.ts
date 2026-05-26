import * as THREE from 'three';
import {
	BloomEffect,
	EffectComposer,
	EffectPass,
	RenderPass,
} from 'postprocessing';
import { THREE_D_MAP_BLOOM } from './threeDMapConstants';

export interface ThreeDMapPostProcessing {
	render: () => void;
	setSize: (width: number, height: number) => void;
	dispose: () => void;
}

export function createThreeDMapPostProcessing(
	renderer: THREE.WebGLRenderer,
	scene: THREE.Scene,
	camera: THREE.Camera
): ThreeDMapPostProcessing {
	const composer = new EffectComposer(renderer, {
		frameBufferType: THREE.HalfFloatType,
		multisampling: renderer.capabilities.isWebGL2
			? THREE_D_MAP_BLOOM.MULTISAMPLING
			: 0,
	});

	composer.addPass(new RenderPass(scene, camera));
	composer.addPass(new EffectPass(
		camera,
		new BloomEffect({
			intensity: THREE_D_MAP_BLOOM.INTENSITY,
			luminanceThreshold: THREE_D_MAP_BLOOM.LUMINANCE_THRESHOLD,
			luminanceSmoothing: THREE_D_MAP_BLOOM.LUMINANCE_SMOOTHING,
			mipmapBlur: true,
			radius: THREE_D_MAP_BLOOM.RADIUS,
			levels: THREE_D_MAP_BLOOM.LEVELS,
		})
	));

	return {
		render: () => composer.render(),
		setSize: (width, height) => composer.setSize(width, height),
		dispose: () => composer.dispose(),
	};
}
