// src/migrations/MigrationStorage.ts
import { IndexedDBUtilities } from "../utils/IndexedDBUtilities";
import { LocalStorageUtilities } from "../utils/LocalStorageUtilities";

/**
 * Provides cross-boundary I/O access for migrations that need to read or
 * write to IndexedDB stores or localStorage keys outside the record being
 * migrated.
 *
 * Migrations should call these methods instead of reaching into storage
 * directly, so the runner can swap in test implementations as needed.
 */
export interface MigrationStorage {
	/** Returns the full IDB record for the given store + key, or undefined if absent. */
	idbGet(store: string, key: string): Promise<unknown>;
	/** Writes a full record into the store (uses the store's keyPath automatically). */
	idbPut(store: string, record: unknown): Promise<void>;
	/** Deletes the record at key from the store. No-op if not found. */
	idbDelete(store: string, key: string): Promise<void>;
	/** Returns all primary keys in the store as strings. */
	idbGetAllKeys(store: string): Promise<string[]>;
	/** Returns all records in the store. */
	idbGetAll(store: string): Promise<unknown[]>;

	/** Returns a localStorage value parsed as JSON, or null if absent. */
	lsGet(key: string): unknown;
	/** Saves a value as JSON to localStorage. */
	lsSet(key: string, value: unknown): void;
	/** Removes a key from localStorage. */
	lsDelete(key: string): void;
}

// ---------------------------------------------------------------------------
// Default implementation backed by real storage
// ---------------------------------------------------------------------------

function idbOp<T>(
	db: IDBDatabase,
	store: string,
	mode: IDBTransactionMode,
	fn: (objectStore: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
	return new Promise((resolve, reject) => {
		const tx = db.transaction([store], mode);
		const req = fn(tx.objectStore(store));
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

export class DefaultMigrationStorage implements MigrationStorage {
	private readonly dbPromise: Promise<IDBDatabase>;

	constructor() {
		this.dbPromise = IndexedDBUtilities.getDB();
	}

	async idbGet(store: string, key: string): Promise<unknown> {
		const db = await this.dbPromise;
		return idbOp(db, store, "readonly", (s) => s.get(key));
	}

	async idbPut(store: string, record: unknown): Promise<void> {
		const db = await this.dbPromise;
		await idbOp<IDBValidKey>(db, store, "readwrite", (s) => s.put(record));
	}

	async idbDelete(store: string, key: string): Promise<void> {
		const db = await this.dbPromise;
		await idbOp<undefined>(db, store, "readwrite", (s) => s.delete(key));
	}

	async idbGetAllKeys(store: string): Promise<string[]> {
		const db = await this.dbPromise;
		const keys = await idbOp<IDBValidKey[]>(db, store, "readonly", (s) => s.getAllKeys());
		return keys.map(String);
	}

	async idbGetAll(store: string): Promise<unknown[]> {
		const db = await this.dbPromise;
		return idbOp<unknown[]>(db, store, "readonly", (s) => s.getAll());
	}

	lsGet(key: string): unknown {
		return LocalStorageUtilities.load(key);
	}

	lsSet(key: string, value: unknown): void {
		LocalStorageUtilities.save(key, value);
	}

	lsDelete(key: string): void {
		localStorage.removeItem(key);
	}
}
