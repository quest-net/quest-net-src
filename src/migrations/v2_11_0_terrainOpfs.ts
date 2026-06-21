// src/migrations/v2_11_0_terrainOpfs.ts
//
// Moves terrain voxel payloads out of the `voxelTerrains` IndexedDB store and
// into OPFS (Origin Private File System). From 2.11.0 the runtime stores and
// reads terrain bytes from OPFS (via OpfsUtilities) -- IndexedDB writes were blocking the
// main thread for up to ~1.5s on large terrains. This is a clean break: after
// migration the runtime never reads the IDB terrain store again.
//
// For every voxelTerrains record belonging to this campaign:
//   1. Write its bytes + ContentHash into OPFS (one file per terrain).
//   2. Delete the now-migrated IDB record to reclaim space.
// A per-record failure logs and continues so a single bad blob never blocks the
// campaign from loading; the always-correct network re-fetch (players) or
// re-author (DM) repairs anything that fails to copy.
//
// The campaign object itself is unchanged -- terrain metadata already carries
// ContentHash (from the 2.7.0 / 2.10.0 migrations), and by the time this runs
// the 2.10.0 migration has already converted any base64 payloads to bytes.

import type { Migration } from "./types";
import { OpfsUtilities } from "../utils/OpfsUtilities";
import { hashVoxels } from "../utils/terrain/data/VoxelDataUtils";

const VOXEL_TERRAINS_STORE = "voxelTerrains";

// Mirrors TerrainStorageService's OPFS layout. Inlined (not imported) so this
// frozen migration captures the scheme as it was at write time.
const terrainPath = (campaignId: string, terrainId: string): string =>
	`terrains/${campaignId}/${terrainId}`;

export const terrainOpfsV2110Migration: Migration = {
	version: "2.11.0",
	migrate: async (data, storage) => {
		const campaign = data as any;
		if (!campaign || typeof campaign !== "object") return campaign;

		const campaignId = campaign.Id;
		if (!campaignId) return campaign;

		const records = (await storage.idbGetAll(VOXEL_TERRAINS_STORE)) as any[];
		for (const record of records) {
			if (!record || record.CampaignId !== campaignId) continue;

			const bytes = record.Voxels;
			if (!(bytes instanceof Uint8Array)) {
				console.error(
					`[v2.11.0 migration] Skipping non-byte voxel record ` +
						`"${record.Key ?? record.TerrainId ?? "(unknown)"}".`
				);
				continue;
			}

			try {
				const contentHash = record.ContentHash ?? hashVoxels(bytes);
				await OpfsUtilities.save(
					terrainPath(campaignId, String(record.TerrainId)),
					bytes,
					{ contentHash }
				);
				await storage.idbDelete(VOXEL_TERRAINS_STORE, record.Key);
			} catch (error) {
				console.error(
					`[v2.11.0 migration] Failed to move voxel record to OPFS ` +
						`"${record.Key ?? record.TerrainId ?? "(unknown)"}".`,
					error
				);
			}
		}

		return campaign;
	},
};
