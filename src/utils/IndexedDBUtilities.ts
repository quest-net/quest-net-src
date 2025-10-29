// utils/IndexedDBUtilities.ts
const DB_NAME = "quest-net-db";
const DB_VERSION = 1;
const STORE_NAME = "images";

/**
 * Generic utilities for IndexedDB operations
 * Primarily used for storing binary data like images
 */
export class IndexedDBUtilities {
	private static db: IDBDatabase | null = null;

	/**
	 * Initializes the IndexedDB database
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
				console.log("[IndexedDB] Database opened successfully");
				resolve(request.result);
			};

			request.onupgradeneeded = (event) => {
				const db = (event.target as IDBOpenDBRequest).result;

				// Create object store for images if it doesn't exist
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: "id" });
					console.log("[IndexedDB] Created images object store");
				}
			};
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
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([STORE_NAME], "readwrite");
			const store = transaction.objectStore(STORE_NAME);

			const record = {
				id,
				data,
				metadata: metadata || {},
				timestamp: Date.now(),
			};

			const request = store.put(record);

			request.onsuccess = () => {
				console.log(`[IndexedDB] Saved data with id: ${id}`);
				resolve();
			};

			request.onerror = () => {
				console.error(`[IndexedDB] Failed to save data with id: ${id}`);
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
			const transaction = db.transaction([STORE_NAME], "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.get(id);

			request.onsuccess = () => {
				if (request.result) {
					console.log(`[IndexedDB] Loaded data with id: ${id}`);
					resolve({
						data: request.result.data,
						metadata: request.result.metadata || {},
					});
				} else {
					console.log(`[IndexedDB] No data found for id: ${id}`);
					resolve(null);
				}
			};

			request.onerror = () => {
				console.error(`[IndexedDB] Failed to load data with id: ${id}`);
				reject(request.error);
			};
		});
	}

	/**
	 * Removes data from IndexedDB
	 */
	static async remove(id: string): Promise<void> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([STORE_NAME], "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.delete(id);

			request.onsuccess = () => {
				console.log(`[IndexedDB] Removed data with id: ${id}`);
				resolve();
			};

			request.onerror = () => {
				console.error(`[IndexedDB] Failed to remove data with id: ${id}`);
				reject(request.error);
			};
		});
	}

	/**
	 * Lists all stored IDs
	 */
	static async listIds(): Promise<string[]> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([STORE_NAME], "readonly");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.getAllKeys();

			request.onsuccess = () => {
				console.log(`[IndexedDB] Listed ${request.result.length} ids`);
				resolve(request.result as string[]);
			};

			request.onerror = () => {
				console.error("[IndexedDB] Failed to list ids");
				reject(request.error);
			};
		});
	}

	/**
	 * Clears all data from the store (use with caution!)
	 */
	static async clear(): Promise<void> {
		const db = await this.initDB();

		return new Promise((resolve, reject) => {
			const transaction = db.transaction([STORE_NAME], "readwrite");
			const store = transaction.objectStore(STORE_NAME);
			const request = store.clear();

			request.onsuccess = () => {
				console.log("[IndexedDB] Cleared all data");
				resolve();
			};

			request.onerror = () => {
				console.error("[IndexedDB] Failed to clear data");
				reject(request.error);
			};
		});
	}
}
