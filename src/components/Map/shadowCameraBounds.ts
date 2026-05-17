import { THREE_D_MAP_SHADOW } from "./threeDMapConstants";

export interface ShadowCameraBounds {
	left: number;
	right: number;
	top: number;
	bottom: number;
	near: number;
	far: number;
}

export function getShadowCameraBounds(
	width: number,
	length: number,
	maxElevation: number
): ShadowCameraBounds {
	const footprintDiagonal = Math.sqrt(width * width + length * length);
	const halfSize = Math.max(
		THREE_D_MAP_SHADOW.MIN_CAMERA_HALF_SIZE,
		footprintDiagonal / 2 +
			maxElevation +
			THREE_D_MAP_SHADOW.CAMERA_HALF_SIZE_PADDING
	);
	const depth = Math.max(
		THREE_D_MAP_SHADOW.MIN_CAMERA_DEPTH,
		Math.max(width, length) *
			THREE_D_MAP_SHADOW.CAMERA_DEPTH_EXTENT_MULTIPLIER +
			maxElevation * THREE_D_MAP_SHADOW.CAMERA_DEPTH_ELEVATION_MULTIPLIER +
			THREE_D_MAP_SHADOW.CAMERA_DEPTH_PADDING
	);

	return {
		left: -halfSize,
		right: halfSize,
		top: halfSize,
		bottom: -halfSize,
		near: THREE_D_MAP_SHADOW.CAMERA_NEAR,
		far: depth,
	};
}
