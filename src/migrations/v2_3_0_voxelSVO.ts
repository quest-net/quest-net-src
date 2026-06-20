// src/migrations/v2_3_0_voxelSVO.ts
//
// Converts voxel terrain payloads from the legacy base64 Uint32Array format to
// the base64 Sparse Voxel Octree format used by VoxelDataUtils.

import type { Migration } from "./types";
import { encodeVoxels, getVoxelCount } from "../utils/terrain/data/VoxelDataUtils";
import { base64ToBytes, bytesToBase64 } from "../utils/base64";

// This migration transforms the *legacy on-disk* format, which stored voxels as
// a base64 string, and keeps producing base64 strings (the later 2.10.0
// migration rewrites every record to raw bytes once). The now-bytes codec
// helpers are therefore wrapped with base64 conversion at their edges here.

interface LegacyVoxel {
	x: number;
	y: number;
	z: number;
	color: number;
}

const SVO_MAGIC = "QSVO";

function isAlreadySVO(encoded: string): boolean {
	if (!encoded) return true;

	// Only decode enough base64 to see the 4 magic bytes. 8 chars decode to 6
	// bytes, which is the smallest aligned prefix that covers bytes 0-3. This
	// matters during migration: every legacy terrain is checked once, and the
	// legacy blobs can be megabytes -- decoding the entire string just to read
	// the first four bytes is wasted work.
	if (encoded.length < 8) return false;

	let prefix: string;
	try {
		prefix = atob(encoded.slice(0, 8));
	} catch {
		return false;
	}

	if (prefix.length < SVO_MAGIC.length) return false;

	return (
		prefix.charCodeAt(0) === SVO_MAGIC.charCodeAt(0) &&
		prefix.charCodeAt(1) === SVO_MAGIC.charCodeAt(1) &&
		prefix.charCodeAt(2) === SVO_MAGIC.charCodeAt(2) &&
		prefix.charCodeAt(3) === SVO_MAGIC.charCodeAt(3)
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
	return bytesToBase64(encodeVoxels(decodeLegacyVoxelString(encoded)));
}

// On per-terrain encoding failure we replace the voxel payload with the empty
// SVO ("") rather than leaving the legacy blob. The runtime is SVO-only --
// keeping legacy data on disk would just produce a crash the next time that
// terrain is hydrated. Data is lost on failure, but the campaign stays
// loadable and the pre-migration Context is recoverable from IndexedDB
// (see contextBackup.ts, key "pre-2.3.0").

function migrateTerrain(terrain: any, campaignId: string): boolean {
	if (!terrain || typeof terrain !== "object") return true;
	if (typeof terrain.Voxels !== "string") return true;

	try {
		terrain.Voxels = migrateVoxelString(terrain.Voxels);
		terrain.VoxelCount = getVoxelCount(base64ToBytes(terrain.Voxels));
		return true;
	} catch (error) {
		console.error(
			`[v2.3.0 migration] Failed to re-encode inline voxels for terrain ` +
				`"${terrain.Id ?? "(unknown)"}" in campaign "${campaignId}". ` +
				`Clearing the payload to keep the campaign loadable. The ` +
				`pre-migration Context is backed up under IndexedDB key ` +
				`"pre-2.3.0" if recovery is needed. Original error:`,
			error
		);
		terrain.Voxels = "";
		terrain.VoxelCount = 0;
		return false;
	}
}

async function migrateIdbRecord(
	record: any,
	campaignId: string,
	storage: Parameters<Migration["migrate"]>[1]
): Promise<boolean> {
	const recordKey = record?.Key ?? record?.TerrainId ?? "(unknown)";
	let nextVoxels: string;
	let encodeFailed = false;
	try {
		nextVoxels = migrateVoxelString(record.Voxels);
	} catch (error) {
		console.error(
			`[v2.3.0 migration] Failed to re-encode IndexedDB voxel record ` +
				`"${recordKey}" for campaign "${campaignId}". Clearing the ` +
				`record to keep the campaign loadable. The pre-migration ` +
				`Context is backed up under IndexedDB key "pre-2.3.0" if ` +
				`recovery is needed. Original error:`,
			error
		);
		nextVoxels = "";
		encodeFailed = true;
	}

	// Skip the write when the record is already in the desired form. Only
	// reachable on the success path (an encoding failure always produces "",
	// which is only equal to record.Voxels when the record was already empty
	// -- and an empty record can't have failed encoding in the first place).
	if (nextVoxels === record.Voxels) return !encodeFailed;

	try {
		record.Voxels = nextVoxels;
		await storage.idbPut("voxelTerrains", record);
		return !encodeFailed;
	} catch (error) {
		console.error(
			`[v2.3.0 migration] Failed to persist re-encoded voxel record ` +
				`"${recordKey}" for campaign "${campaignId}". Original error:`,
			error
		);
		return false;
	}
}

export const voxelSVOV230Migration: Migration = {
	version: "2.3.0",
	migrate: async (data: unknown, storage) => {
		const campaign = data as any;
		const campaignId = String(campaign?.Id ?? "(unknown)");
		let inlineFailures = 0;
		let idbFailures = 0;

		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (!migrateTerrain(terrain, campaignId)) inlineFailures++;
		}

		const allRecords = (await storage.idbGetAll("voxelTerrains")) as any[];
		for (const record of allRecords) {
			if (record.CampaignId !== campaign.Id) continue;
			if (typeof record.Voxels !== "string") continue;

			if (!(await migrateIdbRecord(record, campaignId, storage))) {
				idbFailures++;
			}
		}

		if (inlineFailures > 0 || idbFailures > 0) {
			console.warn(
				`[v2.3.0 migration] Completed for campaign "${campaignId}" with ` +
					`${inlineFailures} inline failure(s) and ${idbFailures} IDB ` +
					`record failure(s). Affected terrains had their voxel payload ` +
					`cleared. The pre-migration Context is backed up under ` +
					`IndexedDB key "pre-2.3.0" if recovery is needed. See logs ` +
					`above for per-terrain details.`
			);
		}

		return campaign;
	},
};
