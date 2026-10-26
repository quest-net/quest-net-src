// Reads .qvx files (Quest-Net voxel terrain, made by the separate qvx tools).
// Layout: "QVX\x1A" magic, u16 version, u16 reserved, then chunks of
// [4-char id][u32 length][data][u32 crc32]. META is JSON with the terrain
// fields; VOXL is [encoding byte][QSVO bytes, deflate-raw when encoding = 1].

import type {
	EncodedVoxelSVO,
	VoxelTerrain,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import { decodeVoxelBuffers } from "../data/VoxelDataUtils";
import {
	maxTacticalDimensionForResolution,
	MAX_VOXEL_TERRAIN_RESOLUTION,
	MIN_VOXEL_TERRAIN_RESOLUTION,
} from "../editor/VoxelTerrainEditorUtils";

const MAGIC = [0x51, 0x56, 0x58, 0x1a];
const SUPPORTED_VERSION = 1;

// The terrain keeps its own Name and Tags; everything about its shape and look
// comes from the file.
export type QvxImportResult = Pick<
	VoxelTerrain,
	"Width" | "Length" | "Height" | "Resolution" | "Background" | "Surroundings"
> & { Lighting?: VoxelTerrain["Lighting"]; Voxels: EncodedVoxelSVO };

export function isQvxFile(buffer: ArrayBuffer): boolean {
	const bytes = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
	return bytes.length === 4 && MAGIC.every((b, i) => bytes[i] === b);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
	let c = 0xffffffff;
	for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function isPositiveInt(v: unknown): v is number {
	return typeof v === "number" && Number.isInteger(v) && v > 0;
}

export async function parseQvxFile(buffer: ArrayBuffer): Promise<QvxImportResult> {
	if (!isQvxFile(buffer) || buffer.byteLength < 8) throw new Error("Not a valid .qvx file.");
	const bytes = new Uint8Array(buffer);
	const view = new DataView(buffer);
	const version = view.getUint16(4, true);
	if (version > SUPPORTED_VERSION) {
		throw new Error(`This .qvx file is version ${version}; this version of Quest-Net reads up to ${SUPPORTED_VERSION}.`);
	}

	const chunks = new Map<string, Uint8Array>();
	for (let offset = 8; offset < bytes.length; ) {
		if (offset + 12 > bytes.length) throw new Error(".qvx file is truncated.");
		const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
		const length = view.getUint32(offset + 4, true);
		if (offset + 12 + length > bytes.length) throw new Error(".qvx file is truncated.");
		const data = bytes.subarray(offset + 8, offset + 8 + length);
		if (crc32(data) !== view.getUint32(offset + 8 + length, true)) {
			throw new Error(`.qvx file is corrupted (${id} chunk).`);
		}
		chunks.set(id, data);
		offset += 12 + length;
	}

	const metaBytes = chunks.get("META");
	const voxl = chunks.get("VOXL");
	if (!metaBytes || !voxl?.length) throw new Error(".qvx file is missing its terrain data.");

	let terrain: Record<string, any>;
	try {
		terrain = JSON.parse(new TextDecoder().decode(metaBytes)).terrain;
	} catch {
		throw new Error(".qvx file has an unreadable header.");
	}
	const { Width, Length, Height, Resolution } = terrain ?? {};
	if (![Width, Length, Height, Resolution].every(isPositiveInt)) {
		throw new Error(".qvx file has an invalid terrain size.");
	}
	if (Resolution < MIN_VOXEL_TERRAIN_RESOLUTION || Resolution > MAX_VOXEL_TERRAIN_RESOLUTION) {
		throw new Error(`.qvx resolution ${Resolution} is not supported (${MIN_VOXEL_TERRAIN_RESOLUTION}-${MAX_VOXEL_TERRAIN_RESOLUTION}).`);
	}
	const maxDimension = maxTacticalDimensionForResolution(Resolution);
	if (Math.max(Width, Length, Height) > maxDimension) {
		throw new Error(`This terrain (${Width}x${Length}x${Height} tiles at resolution ${Resolution}) is larger than the ${maxDimension}-tile maximum.`);
	}

	let voxels: Uint8Array;
	if (voxl[0] === 0) {
		voxels = voxl.slice(1);
	} else if (voxl[0] === 1) {
		const stream = new Blob([voxl.slice(1)]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
		voxels = new Uint8Array(await new Response(stream).arrayBuffer());
	} else {
		throw new Error(`.qvx voxel encoding ${voxl[0]} is not supported.`);
	}

	// Decoding validates the octree; then make sure every voxel fits the terrain.
	const { positions } = decodeVoxelBuffers(voxels);
	const maxX = Width * Resolution, maxY = Height * Resolution, maxZ = Length * Resolution;
	for (let i = 0; i < positions.length; i++) {
		const p = positions[i];
		if ((p & 0xff) >= maxX || ((p >>> 8) & 0xff) >= maxY || ((p >>> 16) & 0xff) >= maxZ) {
			throw new Error(".qvx file has voxels outside its terrain size.");
		}
	}

	const lighting = terrain.Lighting;
	const validLighting =
		lighting &&
		typeof lighting.Color === "string" &&
		[lighting.Intensity, lighting.Rotation, lighting.Elevation].every((v) => typeof v === "number");
	return {
		Width,
		Length,
		Height,
		Resolution,
		...(validLighting ? { Lighting: lighting } : {}),
		Background: terrain.Background ?? {},
		Surroundings: terrain.Surroundings,
		Voxels: voxels,
	};
}
