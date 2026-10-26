// Reads and writes .qvx files (Quest-Net voxel terrain, shared with the
// separate qvx tools). Layout: "QVX\x1A" magic, u16 version, u16 reserved, then
// chunks of [4-char id][u32 length][data][u32 crc32]. META is JSON with the
// terrain fields plus a palette/material table for other programs; VOXL is
// [encoding byte][QSVO bytes, deflate-raw when encoding = 1].

import type {
	EditableVoxelTerrain,
	EncodedVoxelSVO,
	VoxelTerrain,
} from "../../../domains/VoxelTerrain/VoxelTerrain";
import { APP_VERSION } from "../../../version";
import { decodeVoxelBuffers } from "../data/VoxelDataUtils";
import { TERRAIN_PALETTE } from "../palette/TerrainPaletteUtils";
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

/** A special material (palette 240-255) as described in a .qvx file's META. */
export interface QvxMaterialEntry {
	index: number;
	label: string;
	color: string;
	passable: boolean;
	seeThrough: boolean;
	volumetric: boolean;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
	const piped = new Blob([bytes as BlobPart]).stream().pipeThrough(stream);
	return new Uint8Array(await new Response(piped).arrayBuffer());
}

function chunk(id: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	for (let i = 0; i < 4; i++) out[i] = id.charCodeAt(i);
	view.setUint32(4, data.length, true);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(data), true);
	return out;
}

/**
 * Encodes a terrain as a .qvx file. `materials` describes the special palette
 * entries (it comes from the render layer, which this data module can't import).
 */
export async function buildQvxFile(
	terrain: EditableVoxelTerrain,
	materials: readonly QvxMaterialEntry[]
): Promise<Uint8Array> {
	const palette = Array.from(
		{ length: 256 },
		(_, i) => TERRAIN_PALETTE[i] ?? materials.find((m) => m.index === i)?.color ?? null
	);
	const meta = {
		format: "qvx",
		version: SUPPORTED_VERSION,
		generator: `quest-net ${APP_VERSION}`,
		terrain: {
			Name: terrain.Name,
			Width: terrain.Width,
			Length: terrain.Length,
			Height: terrain.Height,
			Resolution: terrain.Resolution ?? 1,
			Lighting: terrain.Lighting,
			Background: terrain.Background,
			...(terrain.Surroundings ? { Surroundings: terrain.Surroundings } : {}),
			...(terrain.PreviewColor ? { PreviewColor: terrain.PreviewColor } : {}),
			...(terrain.Tags?.length ? { Tags: terrain.Tags } : {}),
		},
		palette,
		materials,
	};

	const svo = terrain.Voxels;
	const deflated = svo.length ? await pipe(svo, new CompressionStream("deflate-raw")) : svo;
	const useDeflate = deflated.length < svo.length;
	const voxl = new Uint8Array(1 + (useDeflate ? deflated.length : svo.length));
	voxl[0] = useDeflate ? 1 : 0;
	voxl.set(useDeflate ? deflated : svo, 1);

	const parts = [
		new Uint8Array([...MAGIC, SUPPORTED_VERSION, 0, 0, 0]),
		chunk("META", new TextEncoder().encode(JSON.stringify(meta))),
		chunk("VOXL", voxl),
	];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let offset = 0;
	for (const p of parts) {
		out.set(p, offset);
		offset += p.length;
	}
	return out;
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
		voxels = await pipe(voxl.subarray(1), new DecompressionStream("deflate-raw"));
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
