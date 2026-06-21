// Ambient occlusion is no longer baked at mesh-build time. It is computed per
// fragment by sampling the voxel-occupancy 3D texture (see
// `VoxelTerrainOccupancy` in VoxelTerrainGeometryUtils.ts and the AO shader
// chunks in Terrain/shaders/voxelAoShader.ts). This file holds the per-face
// geometry definitions consumed by the greedy mesher plus the occupancy-volume
// downsample budget.

// The occupancy/fog 3D textures are a dense N^3 byte volume. AO + fog are
// low-frequency (world-space sampling, linear-filtered), so the volume can be
// downsampled without visible change while bounding GPU memory. We cap the
// largest texture dimension at this many texels; the mesher scatters voxels
// into a grid coarsened by the power-of-two factor `chooseOccupancyDownsampleFactor`
// returns. At the current 64-tactical cap (<=256 voxels/axis) the factor is 1,
// i.e. a no-op -- this only engages once terrains grow past the budget.
export const AO_OCCUPANCY_MAX_TEXELS = 256;

/**
 * Smallest power-of-two downsample factor such that ceil(maxVoxelDim / factor)
 * <= budget. Returns 1 (no downsampling) whenever the grid already fits the
 * budget. Mirrors the ceil-divide the WASM mesher uses to size the volume.
 */
export function chooseOccupancyDownsampleFactor(
	maxVoxelDim: number,
	budget: number = AO_OCCUPANCY_MAX_TEXELS
): number {
	let factor = 1;
	while (Math.ceil(maxVoxelDim / factor) > budget) {
		factor *= 2;
	}
	return factor;
}

export interface VoxelFaceDefinition {
	normal: [number, number, number];
	neighborOffset: [number, number, number];
	corners: Array<[number, number, number]>;
}

export const VOXEL_FACE_DEFINITIONS: VoxelFaceDefinition[] = [
	{
		normal: [1, 0, 0],
		neighborOffset: [1, 0, 0],
		corners: [
			[0.5, -0.5, -0.5],
			[0.5, 0.5, -0.5],
			[0.5, 0.5, 0.5],
			[0.5, -0.5, 0.5],
		],
	},
	{
		normal: [-1, 0, 0],
		neighborOffset: [-1, 0, 0],
		corners: [
			[-0.5, -0.5, 0.5],
			[-0.5, 0.5, 0.5],
			[-0.5, 0.5, -0.5],
			[-0.5, -0.5, -0.5],
		],
	},
	{
		normal: [0, 1, 0],
		neighborOffset: [0, 1, 0],
		corners: [
			[-0.5, 0.5, 0.5],
			[0.5, 0.5, 0.5],
			[0.5, 0.5, -0.5],
			[-0.5, 0.5, -0.5],
		],
	},
	{
		normal: [0, -1, 0],
		neighborOffset: [0, -1, 0],
		corners: [
			[-0.5, -0.5, -0.5],
			[0.5, -0.5, -0.5],
			[0.5, -0.5, 0.5],
			[-0.5, -0.5, 0.5],
		],
	},
	{
		normal: [0, 0, 1],
		neighborOffset: [0, 0, 1],
		corners: [
			[-0.5, -0.5, 0.5],
			[0.5, -0.5, 0.5],
			[0.5, 0.5, 0.5],
			[-0.5, 0.5, 0.5],
		],
	},
	{
		normal: [0, 0, -1],
		neighborOffset: [0, 0, -1],
		corners: [
			[0.5, -0.5, -0.5],
			[-0.5, -0.5, -0.5],
			[-0.5, 0.5, -0.5],
			[0.5, 0.5, -0.5],
		],
	},
];
