// src/migrations/v2_10_0_voxelBytes.ts
//
// Switches the at-rest voxel payload from a base64 string to raw SVO bytes
// (Uint8Array), the new canonical form. Builds before 2.10.0 stored each
// terrain's voxels as a base64 string in its IndexedDB record; from 2.10.0 the
// runtime stores and reads bytes directly (the wire, the WASM codec, and IDB all
// want bytes, so base64 only bought a decode on every read).
//
// For every voxelTerrains record belonging to this campaign:
//   1. Decode the base64 `Voxels` string to bytes.
//   2. Recompute `ContentHash` from those bytes. hashVoxels now digests bytes,
//      not base64 characters, so an old-scheme hash no longer matches what the
//      runtime computes -- recomputing here is what realigns the two schemes.
//   3. Write the record back with byte `Voxels` + the new ContentHash.
// Then stamp each recomputed hash onto the matching campaign terrain so the
// synced metadata agrees with the stored payload (and the new scheme reaches
// players via state sync). After this runs, runtime code assumes bytes
// everywhere -- no legacy-shape detection lives outside this migration.
//
// Codec-free (base64 decode + a byte hash only), so it is safe to run at load,
// like the 2.3.0 / 2.7.0 terrain migrations.

import type { Migration } from "./types";
import { hashVoxels } from "../utils/terrain/data/VoxelDataUtils";
import { base64ToBytes } from "../utils/base64";

const VOXEL_TERRAINS_STORE = "voxelTerrains";

export const voxelBytesV2100Migration: Migration = {
	version: "2.10.0",
	migrate: async (data, storage) => {
		const campaign = data as any;
		if (!campaign || typeof campaign !== "object") return campaign;

		const campaignId = campaign.Id;
		const hashByTerrainId = new Map<string, string>();

		const records = (await storage.idbGetAll(VOXEL_TERRAINS_STORE)) as any[];
		for (const record of records) {
			if (!record || record.CampaignId !== campaignId) continue;

			let bytes: Uint8Array;
			try {
				// Pre-2.10.0 records hold a base64 string; convert to bytes. A record
				// already in byte form (e.g. one written by importTerrainPayloads
				// before this migration runs on an import) is taken as-is.
				bytes =
					typeof record.Voxels === "string"
						? base64ToBytes(record.Voxels)
						: (record.Voxels as Uint8Array);
				if (!(bytes instanceof Uint8Array)) continue;
			} catch (error) {
				console.error(
					`[v2.10.0 migration] Failed to decode voxel record ` +
						`"${record.Key ?? record.TerrainId ?? "(unknown)"}"; clearing it ` +
						`to keep the campaign loadable.`,
					error
				);
				bytes = new Uint8Array(0);
			}

			const contentHash = hashVoxels(bytes);
			record.Voxels = bytes;
			record.ContentHash = contentHash;
			hashByTerrainId.set(String(record.TerrainId), contentHash);

			try {
				await storage.idbPut(VOXEL_TERRAINS_STORE, record);
			} catch (error) {
				console.error(
					`[v2.10.0 migration] Failed to write byte voxel record ` +
						`"${record.Key ?? record.TerrainId ?? "(unknown)"}".`,
					error
				);
			}
		}

		// Realign the synced terrain metadata with the recomputed (byte-scheme)
		// hashes so hydration sees a matching ContentHash instead of re-fetching.
		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (!terrain || typeof terrain !== "object") continue;
			const newHash = hashByTerrainId.get(String(terrain.Id));
			if (newHash !== undefined) terrain.ContentHash = newHash;
		}

		return campaign;
	},
};
