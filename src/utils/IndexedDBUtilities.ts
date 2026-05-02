// utils/IndexedDBUtilities.ts
import type { Campaign } from "../domains/Campaign/Campaign";
import type { CampaignInfo } from "../domains/Campaign/Campaign";

const DB_NAME = "quest-net-db";
const DB_VERSION = 2;
const IMAGE_STORE = "images";
const CAMPAIGN_STORE = "campaigns";

/**
 * Generic utilities for IndexedDB operations.
 * Stores:
 *   - "images"   (v1): binary image data keyed by Image.Id
 *   - "campaigns"(v2): full Campaign objects keyed by Campaign.Id
 *     DM campaigns  → keyPath = Campaign.Id (GUID)
 *     Player cached → keyPath = Campaign.Id which equals Campaign.RoomCode
 *                     (StateSync.sanitizeForPlayers replaces Id with RoomCode)
 */
export class IndexedDBUtilities {
	private static db: IDBDatabase | null = null;

	/**
	 * Initializes the IndexedDB database (singleton, lazy).
	 */
	private static async initDB(): Promise<IDBDatabase> {
		if (this.db) {
			return this.db;
		}

		return new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				console.error("[IndexedDB] Failed to open database");
				reject(request.error);
			};

			request.onsuccess = () => {
				this.db = request.result;
				resolve(request.result);
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// v1: image binary store
				if (!db.objectStoreNames.contains(IMAGE_STORE)) {
					db.createObjectStore(IMAGE_STORE, { keyPath: "id" });
				}

				// v2: campaign object store
				if (!db.objectStoreNames.contains(CAMPAIGN_STORE)) {
					db.createObjectStore(CAMPAIGN_STORE, { keyPath: "Id" });
				}
			};
		});
	}

	// -------------------------------------------------------------------------
	// Image store (original API — unchanged)
	// -------------------------------------------------------------------------

	/**
	 * Saves binary data (like an image) to IndexedDB
	 */
	static async save(
		id: string,
		data: Blob | ArrayBuffer,
		metadata?: Record<string, any>
	): Promise<void> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([IMAGE_STORE], "readwrite");
			const store = transaction.objectStore(IMAGE_STORE);

			const record = {
				id,
				data,
				metadata: metadata || {},
				timestamp: Date.now(),
			};

			const request = store.put(record);

			request.onsuccess = () => {
				resolve();
			};

			request.onerror = () => {
				console.error(`[IndexedDB] Failed to save image id: ${id}`);
				reject(request.error);
			};
		});
	}

	/**
	 * Loads binary data from IndexedDB
	 */
	static async load(
		id: string
	): Promise<{
		data: Blob | ArrayBuffer;
		metadata: Record<string, any>;
	} | null> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([IMAGE_STORE], "readonly");
			const store = transaction.objectStore(IMAGE_STORE);
			const request = store.get(id);

			request.onsuccess = () => {
				if (request.result) {
					resolve({
						data: request.result.data,
						metadata: request.result.metadata || {},
					});
				} else {
					console.log(`[IndexedDB] No image found for id: ${id}`);
					resolve(null);
				}
			};

			request.onerror = () => {
				console.error(`[IndexedDB] Failed to load image id: ${id}`);
				reject(request.error);
			};
		});
	}

	/**
	 * Removes an image from IndexedDB
	 */
	static async remove(id: string): Promise<void> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([IMAGE_STORE], "readwrite");
			const store = transaction.objectStore(IMAGE_STORE);
			const request = store.delete(id);

			request.onsuccess = () => {
				resolve();
			};

			request.onerror = () => {
				console.error(`[IndexedDB] Failed to remove image id: ${id}`);
				reject(request.error);
			};
		});
	}

	/**
	 * Lists all stored image IDs
	 */
	static async listIds(): Promise<string[]> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([IMAGE_STORE], "readonly");
			const store = transaction.objectStore(IMAGE_STORE);
			const request = store.getAllKeys();

			request.onsuccess = () => {
				resolve(request.result as string[]);
			};

			request.onerror = () => {
				console.error("[IndexedDB] Failed to list image ids");
				reject(request.error);
			};
		});
	}

	/**
	 * Clears all images from the image store (use with caution!)
	 */
	static async clear(): Promise<void> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([IMAGE_STORE], "readwrite");
			const store = transaction.objectStore(IMAGE_STORE);
			const request = store.clear();

			request.onsuccess = () => {
				resolve();
			};

			request.onerror = () => {
				console.error("[IndexedDB] Failed to clear image store");
				reject(request.error);
			};
		});
	}

	// -------------------------------------------------------------------------
	// Campaign store (v2)
	// -------------------------------------------------------------------------

	/**
	 * Saves a full Campaign object to IndexedDB.
	 * Uses Campaign.Id as the key (GUID for DM campaigns, RoomCode for player-cached).
	 */
	static async saveCampaign(campaign: Campaign): Promise<void> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([CAMPAIGN_STORE], "readwrite");
			const store = transaction.objectStore(CAMPAIGN_STORE);
			store.put(campaign);

			transaction.oncomplete = () => resolve();
			transaction.onerror = () => {
				console.error(`[IndexedDB] Failed to save campaign: ${campaign.Id}`);
				reject(transaction.error);
			};
			transaction.onabort = () => {
				console.error(`[IndexedDB] Aborted saving campaign: ${campaign.Id}`);
				reject(transaction.error);
			};
		});
	}

	/**
	 * Loads a full Campaign from IndexedDB by its Id.
	 * Works for both DM campaigns (Id = GUID) and player-cached campaigns (Id = RoomCode).
	 */
	static async loadCampaign(id: string): Promise<Campaign | null> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([CAMPAIGN_STORE], "readonly");
			const store = transaction.objectStore(CAMPAIGN_STORE);
			const request = store.get(id);

			request.onsuccess = () => {
				resolve(request.result ?? null);
			};
			request.onerror = () => {
				console.error(`[IndexedDB] Failed to load campaign: ${id}`);
				reject(request.error);
			};
		});
	}

	/**
	 * Removes a campaign from IndexedDB by its Id.
	 */
	static async removeCampaign(id: string): Promise<void> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([CAMPAIGN_STORE], "readwrite");
			const store = transaction.objectStore(CAMPAIGN_STORE);
			const request = store.delete(id);

			request.onsuccess = () => resolve();
			request.onerror = () => {
				console.error(`[IndexedDB] Failed to remove campaign: ${id}`);
				reject(request.error);
			};
		});
	}

	/**
	 * Returns lightweight CampaignInfo stubs for all stored campaigns.
	 * Reads all campaigns but maps to stub shape — useful for recovery/migration only.
	 * Normally the stub list is maintained in Context.Campaigns (localStorage).
	 */
	static async listCampaignInfos(): Promise<CampaignInfo[]> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([CAMPAIGN_STORE], "readonly");
			const store = transaction.objectStore(CAMPAIGN_STORE);
			const request = store.getAll();

			request.onsuccess = () => {
				const campaigns = request.result as Campaign[];
				resolve(
					campaigns.map((c) => ({
						Id: c.Id,
						Name: c.Name,
						RoomCode: c.RoomCode,
						CreatedAt: c.CreatedAt,
					}))
				);
			};
			request.onerror = () => {
				console.error("[IndexedDB] Failed to list campaign infos");
				reject(request.error);
			};
		});
	}
}
