// utils/LocalStorageUtilities.ts

/**
 * Error thrown when a localStorage write fails because the browser's storage
 * quota (typically ~5 MB) has been exceeded. Distinct from generic save
 * failures so callers / UI can react specifically (see the quota notifier
 * below and StorageQuotaErrorOverlay).
 */
export class StorageQuotaError extends Error {
	constructor(
		public readonly key: string,
		public readonly cause: unknown
	) {
		super(
			`localStorage quota exceeded while saving key "${key}". ` +
				`The campaign data is too large to fit in browser storage.`
		);
		this.name = "StorageQuotaError";
	}
}

/**
 * Detects the QuotaExceededError a browser raises when localStorage is full.
 * Covers the spec name/code (22) plus Firefox's legacy variant (1014). Also
 * treats a zero-length storage as a strong signal, since some browsers report
 * code 0 / generic names once the store is wedged full.
 */
function isQuotaExceededError(error: unknown): boolean {
	if (!(error instanceof DOMException)) return false;
	return (
		error.name === "QuotaExceededError" ||
		error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
		error.code === 22 ||
		error.code === 1014
	);
}

type QuotaListener = () => void;
const quotaListeners = new Set<QuotaListener>();

/**
 * Subscribe to localStorage-quota-exceeded events. The returned function
 * unsubscribes. Used by StorageQuotaErrorOverlay to surface a friendly,
 * blocking error instead of letting the failed write bubble up and crash.
 */
export function onStorageQuotaExceeded(listener: QuotaListener): () => void {
	quotaListeners.add(listener);
	return () => {
		quotaListeners.delete(listener);
	};
}

function notifyStorageQuotaExceeded(): void {
	for (const listener of quotaListeners) {
		try {
			listener();
		} catch (e) {
			console.error("[LocalStorage] quota listener threw:", e);
		}
	}
}

/**
 * Generic utilities for localStorage operations
 */
export class LocalStorageUtilities {
	/**
	 * Writes an already-serialized string to localStorage with quota handling.
	 *
	 * On a quota-exceeded failure, notifies registered listeners (so the UI can
	 * show a friendly "contact the developer" message) and rethrows a typed
	 * StorageQuotaError. Other failures are logged and rethrown unchanged.
	 */
	private static writeRaw(key: string, value: string): void {
		try {
			localStorage.setItem(key, value);
		} catch (error) {
			if (isQuotaExceededError(error)) {
				console.error(
					`[LocalStorage] Quota exceeded while saving key ${key}:`,
					error
				);
				notifyStorageQuotaExceeded();
				throw new StorageQuotaError(key, error);
			}
			console.error(`[LocalStorage] Failed to save to key ${key}:`, error);
			throw error;
		}
	}

	/**
	 * Saves JSON-serializable data to localStorage under a given key. Throws on
	 * failure (use trySave for a best-effort, non-throwing variant).
	 */
	static save<T>(key: string, data: T): void {
		this.writeRaw(key, JSON.stringify(data));
	}

	/**
	 * Best-effort JSON save (the object counterpart to saveString). Use for
	 * non-critical preferences whose loss is acceptable.
	 *
	 * Unlike save(), this NEVER throws: a failed write is swallowed after being
	 * logged, and a quota error still fires the storage-full overlay via the
	 * notifier inside writeRaw. Returns true on success, false if the write
	 * failed (including a JSON.stringify failure on circular data).
	 */
	static trySave<T>(key: string, data: T): boolean {
		try {
			this.writeRaw(key, JSON.stringify(data));
			return true;
		} catch {
			// writeRaw already logged the failure (and notified on quota); a
			// dropped preference is non-critical, so we don't propagate.
			return false;
		}
	}

	/**
	 * Best-effort save of a plain string (no JSON-wrapping). Use for small
	 * primitive preferences (view mode, flags, etc.) whose read side does a raw
	 * getItem.
	 *
	 * Unlike save(), this NEVER throws: a failed write is swallowed after being
	 * logged, and a quota error still fires the storage-full overlay via the
	 * notifier inside writeRaw. This lets callers fire-and-forget without their
	 * own try/catch. Returns true on success, false if the write failed.
	 */
	static saveString(key: string, value: string): boolean {
		try {
			this.writeRaw(key, value);
			return true;
		} catch {
			// writeRaw already logged the failure (and notified on quota); a
			// dropped preference is non-critical, so we don't propagate.
			return false;
		}
	}

	/**
	 * Reads a plain string from localStorage (the read counterpart to
	 * saveString). Returns null when the key is absent or storage is unavailable.
	 */
	static loadString(key: string): string | null {
		try {
			return localStorage.getItem(key);
		} catch (error) {
			console.error(`[LocalStorage] Failed to read key ${key}:`, error);
			return null;
		}
	}

	/**
	 * Loads data from localStorage for a given key
	 */
	static load<T>(key: string): T | null {
		try {
			const json = localStorage.getItem(key);
			if (!json) {
				return null;
			}

			const data = JSON.parse(json) as T;
			return data;
		} catch (error) {
			console.error(`[LocalStorage] Failed to load from key ${key}:`, error);
			return null;
		}
	}

	/**
	 * Removes data from localStorage
	 */
	static remove(key: string): void {
		localStorage.removeItem(key);
	}

	/**
	 * Checks if a key exists in localStorage
	 */
	static exists(key: string): boolean {
		return localStorage.getItem(key) !== null;
	}

	/**
	 * Clears all data from localStorage (use with caution!)
	 */
	static clear(): void {
		localStorage.clear();
	}
}
