// src/migrations/v2_7_0_terrainContentHash.ts
//
// Decouples terrain voxel payloads from the synced campaign object. Before
// 2.7.0 each VoxelTerrain carried its voxels (Voxels/VoxelsLoaded) and a secret
// VoxelStorageKey. From 2.7.0 the canonical terrain carries only metadata plus a
// ContentHash; the payload lives per-client in IndexedDB / the runtime buffer.
//
// This migration, for every terrain on the campaign:
//   1. Resolves the voxel payload -- from the inline `Voxels` field (export
//      files) or, when stubbed, from the existing IndexedDB record.
//   2. Computes its ContentHash and stamps ContentHash + VoxelCount on the
//      terrain metadata.
//   3. Writes/refreshes the IndexedDB record so it carries the ContentHash
//      (what the runtime compares against to detect a stale cached payload).
//   4. Strips the legacy Voxels / VoxelsLoaded / VoxelStorageKey fields off the
//      campaign object.
//
// Mirrors the dual inline+IDB handling of the 2.3.0 SVO migration. Uses only
// header-level helpers (getVoxelCount, hashVoxels) -- never the async WASM
// codec -- so it is safe to run during load. PreviewColor is left as-is (it was
// already stamped by the pre-2.7.0 metadata path).

import type { Migration } from "./types";
import { getVoxelCount, hashVoxels } from "../utils/terrain/data/VoxelDataUtils";
import { base64ToBytes } from "../utils/base64";

const VOXEL_TERRAINS_STORE = "voxelTerrains";

export const terrainContentHashV270Migration: Migration = {
	version: "2.7.0",
	migrate: async (data, storage) => {
		const campaign = data as any;
		if (!campaign || typeof campaign !== "object") return campaign;

		const campaignId = String(campaign.Id ?? "");
		const terrains = Array.isArray(campaign.VoxelTerrains)
			? campaign.VoxelTerrains
			: [];

		for (const terrain of terrains) {
			if (!terrain || typeof terrain !== "object") continue;
			const terrainId = String(terrain.Id ?? "");

			// Canonical key the runtime's buildStorageKey will compute for this
			// campaign + terrain. The write MUST land here so hydration finds it.
			// On import the campaign was just re-id'd, so this is the new id.
			const writeKey = `${campaignId}:${terrainId}`;

			// Legacy IDB key to read stubbed payloads from: prefer the stored
			// VoxelStorageKey (it may reference an older id scheme), else the
			// canonical key.
			const readKey =
				(typeof terrain.VoxelStorageKey === "string" && terrain.VoxelStorageKey) ||
				writeKey;

			const inline =
				typeof terrain.Voxels === "string" && terrain.Voxels.length > 0
					? terrain.Voxels
					: null;

			let voxels = "";
			if (inline !== null) {
				voxels = inline;
			} else {
				const record = (await storage.idbGet(VOXEL_TERRAINS_STORE, readKey)) as any;
				if (record && typeof record.Voxels === "string") {
					voxels = record.Voxels;
				}
			}

			// `voxels` is the legacy base64 string; the codec helpers now operate on
			// bytes, so decode for the hash/count. The byte-derived ContentHash is
			// what the runtime recomputes on hydrate, so computing it here keeps the
			// record consistent.
			let contentHash: string;
			let voxelCount: number;
			try {
				const bytes = base64ToBytes(voxels);
				contentHash = hashVoxels(bytes);
				voxelCount = getVoxelCount(bytes);
			} catch (error) {
				console.error(
					`[v2.7.0 migration] Invalid voxel payload for terrain ` +
						`"${terrainId}" in campaign "${campaignId}". Treating as empty.`,
					error
				);
				voxels = "";
				contentHash = hashVoxels(new Uint8Array(0));
				voxelCount = 0;
			}

			// Stamp synced metadata; drop the legacy payload fields off the object.
			terrain.ContentHash = contentHash;
			terrain.VoxelCount = voxelCount;
			delete terrain.Voxels;
			delete terrain.VoxelsLoaded;
			delete terrain.VoxelStorageKey;

			// Persist the payload to IndexedDB with its ContentHash so the runtime
			// can hydrate it and detect staleness.
			try {
				await storage.idbPut(VOXEL_TERRAINS_STORE, {
					Key: writeKey,
					CampaignId: campaignId,
					TerrainId: terrainId,
					Voxels: voxels,
					ContentHash: contentHash,
					SavedAt: Date.now(),
				});
			} catch (error) {
				console.error(
					`[v2.7.0 migration] Failed to write terrain record "${writeKey}".`,
					error
				);
			}
		}

		return campaign;
	},
};
