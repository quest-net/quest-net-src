import * as THREE from 'three';

/** Create a module-lifetime cache for standard and performance color textures. */
export function createTerrainColorTextureGetter(
	url: string,
	anisotropy = 8,
	performanceAnisotropy = 1
): (performanceMode: boolean) => THREE.Texture {
	let standardTexture: THREE.Texture | null = null;
	let performanceTexture: THREE.Texture | null = null;

	const load = (performanceMode: boolean): THREE.Texture => {
		const texture = new THREE.TextureLoader().load(url);
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.magFilter = THREE.LinearFilter;
		texture.minFilter = performanceMode
			? THREE.LinearFilter
			: THREE.LinearMipmapLinearFilter;
		texture.anisotropy = performanceMode
			? performanceAnisotropy
			: anisotropy;
		texture.generateMipmaps = !performanceMode;
		return texture;
	};

	return (performanceMode) => performanceMode
		? (performanceTexture ??= load(true))
		: (standardTexture ??= load(false));
}
