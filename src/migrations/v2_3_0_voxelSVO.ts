// src/migrations/v2_3_0_voxelSVO.ts
//
// Converts voxel terrain payloads from the legacy base64 Uint32Array format to
// the base64 Sparse Voxel Octree format used by VoxelDataUtils.

import type { Migration } from "./types";
import { encodeVoxels, getVoxelCount } from "../utils/terrain/data/VoxelDataUtils";

interface LegacyVoxel {
	x: number;
	y: number;
	z: number;
	color: number;
}

const SVO_MAGIC = "QSVO";

function base64ToBytes(encoded: string): Uint8Array {
	if (!encoded) return new Uint8Array(0);

	const binary = atob(encoded);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}

function isAlreadySVO(encoded: string): boolean {
	if (!encoded) return true;

	const bytes = base64ToBytes(encoded);
	if (bytes.length < SVO_MAGIC.length) return false;

	return (
		bytes[0] === SVO_MAGIC.charCodeAt(0) &&
		bytes[1] === SVO_MAGIC.charCodeAt(1) &&
		bytes[2] === SVO_MAGIC.charCodeAt(2) &&
		bytes[3] === SVO_MAGIC.charCodeAt(3)
	);
}

function* decodeLegacyVoxelString(encoded: string): Generator<LegacyVoxel> {
	const bytes = base64ToBytes(encoded);
	if (bytes.length % 4 !== 0) {
		throw new Error("Legacy voxel payload byte length is not divisible by 4.");
	}

	const values = new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
	for (let i = 0; i < values.length; i++) {
		const value = values[i];
		const position = Math.floor(value / 256);
		yield {
			x: position & 0xff,
			y: (position >>> 8) & 0xff,
			z: (position >>> 16) & 0xff,
			color: value & 0xff,
		};
	}
}

function migrateVoxelString(encoded: string): string {
	if (!encoded || isAlreadySVO(encoded)) return encoded;
	return encodeVoxels(decodeLegacyVoxelString(encoded));
}

function migrateTerrain(terrain: any): void {
	if (!terrain || typeof terrain !== "object") return;
	if (typeof terrain.Voxels !== "string") return;

	terrain.Voxels = migrateVoxelString(terrain.Voxels);
	terrain.VoxelCount = getVoxelCount(terrain.Voxels);
}

export const voxelSVOV230Migration: Migration = {
	version: "2.3.0",
	migrate: async (data: unknown, storage) => {
		const campaign = data as any;

		for (const terrain of campaign.VoxelTerrains ?? []) {
			migrateTerrain(terrain);
		}

		const allRecords = await storage.idbGetAll("voxelTerrains") as any[];
		for (const record of allRecords) {
			if (record.CampaignId !== campaign.Id) continue;
			if (typeof record.Voxels !== "string") continue;

			record.Voxels = migrateVoxelString(record.Voxels);
			await storage.idbPut("voxelTerrains", record);
		}

		return campaign;
	},
};
