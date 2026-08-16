// utils/IndexedDBUtilities.ts
const DB_NAME = "quest-net-db";
// Bumped to 5 to add the "contextBackups" object store, used by the 2.3.0
// migration to snapshot the localStorage Context before applying risky
// transformations. IndexedDB cannot open a later version DB as an earlier one,
// so older builds will still see their existing stores after this upgrade -- we
// just add another store alongside them.
const DB_VERSION = 5;
const STORE_NAME = "images";
export const CAMPAIGNS_STORE_NAME = "campaigns";
export const VOXEL_TERRAINS_STORE_NAME = "voxelTerrains";
export const CONTEXT_BACKUPS_STORE_NAME = "contextBackups";

interface ImageRecord {
	id: string;
	data: Blob | ArrayBuffer;
	metadata?: Record<string, any>;
	timestamp: number;
}

/**
 * Generic utilities for IndexedDB operations
 * Primarily used for storing binary data like images
 */
export class IndexedDBUtilities {
	private static dbPromise: Promise<IDBDatabase> | null = null;

	/**
	 * Opens (and upgrades, if needed) the shared database. One cached promise for
	 * the whole app, so nothing races another opener to upgrade it.
	 */
	private static getDB(): Promise<IDBDatabase> {
		if (this.dbPromise) return this.dbPromise;

		this.dbPromise = new Promise((resolve, reject) => {
			const request = indexedDB.open(DB_NAME, DB_VERSION);

			request.onerror = () => {
				console.error("[IndexedDB] Failed to open database");
				this.dbPromise = null;
				reject(request.error);
			};

			request.onsuccess = () => resolve(request.result);

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Image binaries.
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: "id" });
				}

				// Full Campaign payloads.
				if (!db.objectStoreNames.contains(CAMPAIGNS_STORE_NAME)) {
					db.createObjectStore(CAMPAIGNS_STORE_NAME, { keyPath: "Id" });
				}

				// Legacy voxel terrain payloads. Terrain now lives in OPFS, but the
				// pre-2.11.0 migration chain still reads and rewrites this store while
				// moving old campaigns across, so it must exist even on a fresh DB.
				if (!db.objectStoreNames.contains(VOXEL_TERRAINS_STORE_NAME)) {
					db.createObjectStore(VOXEL_TERRAINS_STORE_NAME, { keyPath: "Key" });
				}

				// One-shot Context snapshots taken right before risky migrations run
				// (added for 2.3.0). Records are keyed by a stable backup key (e.g.
				// "pre-2.3.0") so the same backup is never overwritten by a subsequent
				// failed reload.
				if (!db.objectStoreNames.contains(CONTEXT_BACKUPS_STORE_NAME)) {
					db.createObjectStore(CONTEXT_BACKUPS_STORE_NAME, { keyPath: "Key" });
				}
			};
		});
		return this.dbPromise;
	}

	/**
	 * Runs a single request against one object store and resolves with its
	 * result. The one place IndexedDB's event API is adapted to promises --
	 * every read/write in the app (here, campaigns, context backups, migrations)
	 * goes through it.
	 */
	static async op<T>(
		storeName: string,
		mode: IDBTransactionMode,
		run: (store: IDBObjectStore) => IDBRequest<T>
	): Promise<T> {
		const db = await this.getDB();
		return new Promise<T>((resolve, reject) => {
			const request = run(db.transaction([storeName], mode).objectStore(storeName));
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
	}

	/**
	 * Saves binary data (like an image) to IndexedDB
	 */
	static async save(
		id: string,
		data: Blob | ArrayBuffer,
		metadata?: Record<string, any>
	): Promise<void> {
		await this.op(STORE_NAME, "readwrite", (store) =>
			store.put({ id, data, metadata: metadata || {}, timestamp: Date.now() })
		);
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
		const record = await this.op<ImageRecord | undefined>(
			STORE_NAME,
			"readonly",
			(store) => store.get(id)
		);
		return record ? { data: record.data, metadata: record.metadata || {} } : null;
	}

	/**
	 * Every stored binary id. Keys only -- no blobs are read, so this is cheap
	 * even with hundreds of images (used to detect binaries lost to eviction).
	 */
	static async listIds(): Promise<Set<string>> {
		const keys = await this.op<IDBValidKey[]>(STORE_NAME, "readonly", (store) =>
			store.getAllKeys()
		);
		return new Set(keys.map(String));
	}

	/**
	 * Removes data from IndexedDB
	 */
	static async remove(id: string): Promise<void> {
		await this.op(STORE_NAME, "readwrite", (store) => store.delete(id));
	}
}
