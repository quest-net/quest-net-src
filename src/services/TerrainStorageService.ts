import type { Campaign } from "../domains/Campaign/Campaign";
import type { VoxelTerrain } from "../domains/VoxelTerrain/VoxelTerrain";
import {
	IndexedDBUtilities,
	VOXEL_TERRAINS_STORE_NAME,
} from "../utils/IndexedDBUtilities";
import { getMostCommonVoxelTerrainColor } from "../utils/VoxelTerrainEditorUtils";
import { getVoxelCount } from "../utils/VoxelDataUtils";

interface StoredVoxelTerrainRecord {
	Key: string;
	CampaignId: string;
	TerrainId: string;
	Voxels: string;
	SavedAt: number;
}

export class TerrainStorageService {
	static buildStorageKey(campaign: Campaign, terrainId: string): string {
		return `${campaign.Id}:${terrainId}`;
	}

	static isHydrated(terrain: VoxelTerrain | null | undefined): boolean {
		if (!terrain) return false;
		if (terrain.VoxelsLoaded === true) return true;
		if (terrain.VoxelsLoaded === false) return false;
		if (!terrain.VoxelStorageKey) return true;
		return terrain.Voxels.length > 0;
	}

	static updateMetadata(
		terrain: VoxelTerrain,
		storageKey: string = terrain.VoxelStorageKey ?? ""
	): void {
		terrain.VoxelStorageKey = storageKey || terrain.VoxelStorageKey;
		terrain.VoxelCount = getVoxelCount(terrain.Voxels);
		terrain.PreviewColor = getMostCommonVoxelTerrainColor(terrain);
	}

	static async saveTerrain(
		campaign: Campaign,
		terrain: VoxelTerrain
	): Promise<void> {
		const key = terrain.VoxelStorageKey ?? this.buildStorageKey(campaign, terrain.Id);
		const db = await IndexedDBUtilities.getDB();
		const record: StoredVoxelTerrainRecord = {
			Key: key,
			CampaignId: campaign.Id,
			TerrainId: terrain.Id,
			Voxels: terrain.Voxels,
			SavedAt: Date.now(),
		};

		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction([VOXEL_TERRAINS_STORE_NAME], "readwrite");
			const store = transaction.objectStore(VOXEL_TERRAINS_STORE_NAME);
			const request = store.put(record);

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error(
					`[TerrainStorageService] Failed to save terrain: ${terrain.Id}`,
					request.error
				);
				reject(request.error);
			};
		});

		this.updateMetadata(terrain, key);
		terrain.VoxelsLoaded = true;
	}

	static async loadVoxels(
		campaign: Campaign,
		terrain: VoxelTerrain
	): Promise<string | null> {
		if (this.isHydrated(terrain)) {
			return terrain.Voxels;
		}

		const key = terrain.VoxelStorageKey ?? this.buildStorageKey(campaign, terrain.Id);
		const db = await IndexedDBUtilities.getDB();
		const record = await new Promise<StoredVoxelTerrainRecord | null>(
			(resolve, reject) => {
				const transaction = db.transaction([VOXEL_TERRAINS_STORE_NAME], "readonly");
				const store = transaction.objectStore(VOXEL_TERRAINS_STORE_NAME);
				const request = store.get(key);

				request.onsuccess = () => resolve(request.result ?? null);
				request.onerror = () => {
					console.error(
						`[TerrainStorageService] Failed to load terrain: ${terrain.Id}`,
						request.error
					);
					reject(request.error);
				};
			}
		);

		return record?.Voxels ?? null;
	}

	static async hydrateTerrain(
		campaign: Campaign,
		terrainId: string
	): Promise<VoxelTerrain | null> {
		const terrain = campaign.VoxelTerrains.find((t) => t.Id === terrainId);
		if (!terrain) return null;

		const voxels = await this.loadVoxels(campaign, terrain);
		if (voxels === null) return null;

		terrain.Voxels = voxels;
		terrain.VoxelsLoaded = true;
		this.updateMetadata(
			terrain,
			terrain.VoxelStorageKey ?? this.buildStorageKey(campaign, terrain.Id)
		);
		return terrain;
	}

	static async loadTerrainForEditing(
		campaign: Campaign,
		terrain: VoxelTerrain
	): Promise<VoxelTerrain | null> {
		const voxels = await this.loadVoxels(campaign, terrain);
		if (voxels === null) return null;

		const draft: VoxelTerrain = {
			...terrain,
			Voxels: voxels,
			VoxelsLoaded: true,
			VoxelStorageKey:
				terrain.VoxelStorageKey ?? this.buildStorageKey(campaign, terrain.Id),
		};
		this.updateMetadata(draft, draft.VoxelStorageKey);
		return draft;
	}

	static unloadTerrain(terrain: VoxelTerrain): void {
		terrain.Voxels = "";
		terrain.VoxelsLoaded = false;
	}

	static async prepareCampaignAfterLoad(campaign: Campaign): Promise<void> {
		const activeId = campaign.GameState?.VoxelTerrainId;
		if (activeId) {
			const active = await this.hydrateTerrain(campaign, activeId);
			if (!active) {
				console.warn(
					`[TerrainStorageService] Active terrain payload missing: ${activeId}`
				);
			}
		}

		await this.packInactiveTerrains(campaign);
	}

	static async prepareCampaignForStorage(campaign: Campaign): Promise<void> {
		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (this.isHydrated(terrain)) {
				await this.saveTerrain(campaign, terrain);
			}
		}
		this.stripInactiveTerrainVoxels(campaign);
	}

	static async packInactiveTerrains(campaign: Campaign): Promise<void> {
		const activeId = campaign.GameState?.VoxelTerrainId;
		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (terrain.Id === activeId) continue;
			if (!this.isHydrated(terrain)) continue;

			await this.saveTerrain(campaign, terrain);
			this.unloadTerrain(terrain);
		}
	}

	static stripInactiveTerrainVoxels(campaign: Campaign): void {
		const activeId = campaign.GameState?.VoxelTerrainId;
		for (const terrain of campaign.VoxelTerrains ?? []) {
			if (terrain.Id === activeId) continue;
			if (!terrain.VoxelStorageKey) continue;
			this.unloadTerrain(terrain);
		}
	}

	static async hydrateAllTerrains(campaign: Campaign): Promise<Campaign> {
		const clone = structuredClone(campaign);
		for (const terrain of clone.VoxelTerrains ?? []) {
			await this.hydrateTerrain(clone, terrain.Id);
		}
		return clone;
	}

	static async deleteTerrain(
		campaign: Campaign,
		terrain: VoxelTerrain
	): Promise<void> {
		const key = terrain.VoxelStorageKey ?? this.buildStorageKey(campaign, terrain.Id);
		const db = await IndexedDBUtilities.getDB();

		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction([VOXEL_TERRAINS_STORE_NAME], "readwrite");
			const store = transaction.objectStore(VOXEL_TERRAINS_STORE_NAME);
			const request = store.delete(key);

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error(
					`[TerrainStorageService] Failed to delete terrain: ${terrain.Id}`,
					request.error
				);
				reject(request.error);
			};
		});
	}

	static async deleteCampaignTerrains(campaignId: string): Promise<void> {
		const db = await IndexedDBUtilities.getDB();

		await new Promise<void>((resolve, reject) => {
			const transaction = db.transaction([VOXEL_TERRAINS_STORE_NAME], "readwrite");
			const store = transaction.objectStore(VOXEL_TERRAINS_STORE_NAME);
			const request = store.getAll();

			transaction.oncomplete = () => resolve();
			transaction.onerror = () => reject(transaction.error);
			transaction.onabort = () => reject(transaction.error);
			request.onsuccess = () => {
				const records = (request.result ?? []) as StoredVoxelTerrainRecord[];
				for (const record of records) {
					if (record.CampaignId === campaignId) {
						store.delete(record.Key);
					}
				}
			};
			request.onerror = () => reject(request.error);
		});
	}
}
