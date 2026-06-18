// Ambient occlusion is no longer baked at mesh-build time. It is computed per
// fragment by sampling the voxel-occupancy 3D texture (see
// `VoxelTerrainOccupancy` in VoxelTerrainGeometryUtils.ts and the AO shader
// chunks in Terrain/shaders/voxelAoShader.ts). This file now only contains the
// per-face geometry definitions consumed by the greedy mesher.

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
