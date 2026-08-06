// src/migrations/MigrationStorage.ts
import { IndexedDBUtilities } from "../utils/IndexedDBUtilities";
import { LocalStorageUtilities } from "../utils/LocalStorageUtilities";

/**
 * Cross-boundary I/O for migrations that need to read or write IndexedDB stores
 * or localStorage keys outside the record being migrated.
 *
 * Migrations call these instead of reaching into storage directly, so every
 * migration's storage access is visible in one place.
 */
export const migrationStorage = {
	/** Returns the full IDB record for the given store + key, or undefined if absent. */
	idbGet(store: string, key: string): Promise<unknown> {
		return IndexedDBUtilities.op(store, "readonly", (s) => s.get(key));
	},

	/** Writes a full record into the store (uses the store's keyPath automatically). */
	async idbPut(store: string, record: unknown): Promise<void> {
		await IndexedDBUtilities.op(store, "readwrite", (s) => s.put(record));
	},

	/** Deletes the record at key from the store. No-op if not found. */
	async idbDelete(store: string, key: string): Promise<void> {
		await IndexedDBUtilities.op(store, "readwrite", (s) => s.delete(key));
	},

	/** Returns all primary keys in the store as strings. */
	async idbGetAllKeys(store: string): Promise<string[]> {
		const keys = await IndexedDBUtilities.op<IDBValidKey[]>(store, "readonly", (s) =>
			s.getAllKeys()
		);
		return keys.map(String);
	},

	/** Returns all records in the store. */
	idbGetAll(store: string): Promise<unknown[]> {
		return IndexedDBUtilities.op<unknown[]>(store, "readonly", (s) => s.getAll());
	},

	/** Returns a localStorage value parsed as JSON, or null if absent. */
	lsGet(key: string): unknown {
		return LocalStorageUtilities.load(key);
	},

	/** Saves a value as JSON to localStorage. */
	lsSet(key: string, value: unknown): void {
		LocalStorageUtilities.save(key, value);
	},

	/** Removes a key from localStorage. */
	lsDelete(key: string): void {
		localStorage.removeItem(key);
	},
};

export type MigrationStorage = typeof migrationStorage;
