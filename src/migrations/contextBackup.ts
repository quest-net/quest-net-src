// src/migrations/contextBackup.ts
//
// One-shot snapshot of the localStorage Context, taken right before risky
// schema migrations run. Stored in IndexedDB rather than localStorage so the
// backup itself doesn't compete with the original for the (already-strained)
// localStorage quota.
//
// Each backup key is written exactly once per device. If a record under that
// key already exists, we leave it alone -- otherwise a half-migrated reload
// would clobber the only good snapshot.

import {
	CONTEXT_BACKUPS_STORE_NAME,
	IndexedDBUtilities,
} from "../utils/IndexedDBUtilities";

interface ContextBackupRecord {
	Key: string;
	SourceVersion: string;
	SavedAt: number;
	Context: unknown;
}

/**
 * Snapshots the raw localStorage Context into IndexedDB if no backup exists
 * for the given key yet. Returns true if a new backup was written, false if
 * one already exists or the operation failed.
 *
 * Failure paths (IDB unavailable, quota, etc.) are logged but never rethrown;
 * the caller should treat this as best-effort safety, not a hard requirement.
 */
export async function backupContextOnce(
	backupKey: string,
	sourceVersion: string,
	rawContext: unknown
): Promise<boolean> {
	try {
		const db = await IndexedDBUtilities.getDB();

		const existing = await new Promise<unknown>((resolve, reject) => {
			const tx = db.transaction([CONTEXT_BACKUPS_STORE_NAME], "readonly");
			const req = tx.objectStore(CONTEXT_BACKUPS_STORE_NAME).get(backupKey);
			req.onsuccess = () => resolve(req.result ?? null);
			req.onerror = () => reject(req.error);
		});

		if (existing) {
			return false;
		}

		const record: ContextBackupRecord = {
			Key: backupKey,
			SourceVersion: sourceVersion,
			SavedAt: Date.now(),
			Context: rawContext,
		};

		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction([CONTEXT_BACKUPS_STORE_NAME], "readwrite");
			const req = tx.objectStore(CONTEXT_BACKUPS_STORE_NAME).put(record);
			req.onsuccess = () => resolve();
			req.onerror = () => reject(req.error);
		});

		console.log(
			`[ContextBackup] Snapshotted Context (source version "${sourceVersion}") under IndexedDB key "${backupKey}".`
		);
		return true;
	} catch (error) {
		console.error(
			`[ContextBackup] Failed to back up Context under key "${backupKey}":`,
			error
		);
		return false;
	}
}
