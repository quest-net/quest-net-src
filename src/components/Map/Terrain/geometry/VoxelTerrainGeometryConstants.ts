// Ambient occlusion curve: maps AO level (0 = maximally occluded, 3 = fully lit)
// to a per-vertex float multiplier written into the aoStrength attribute at
// mesh-build time. Applied in the fragment shader (diffuseColor.rgb *= vAoStrength)
// so it works correctly for any material variant including textured surfaces.
export const VOXEL_AO_CURVE = [0.45, 0.65, 0.82, 1.0] as const;

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
