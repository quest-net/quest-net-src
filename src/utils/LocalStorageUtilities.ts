// utils/LocalStorageUtilities.ts

/**
 * Generic utilities for localStorage operations
 */
export class LocalStorageUtilities {
	/**
	 * Saves data to localStorage under a given key
	 */
	static save<T>(key: string, data: T): void {
		try {
			const json = JSON.stringify(data);
			localStorage.setItem(key, json);
		} catch (error) {
			console.error(`[LocalStorage] Failed to save to key ${key}:`, error);
			throw error;
		}
	}

	/**
	 * Loads data from localStorage for a given key
	 */
	static load<T>(key: string): T | null {
		try {
			const json = localStorage.getItem(key);
			if (!json) {
				console.log(`[LocalStorage] No data found for key: ${key}`);
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
