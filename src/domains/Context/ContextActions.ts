// domains/Context/ContextActions.ts

import { Context } from "./Context";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import { UserActions } from "../User/UserActions";
import { APP_VERSION } from "../../version";
import { runMigrations } from "../../updates/migrator";

const STORAGE_KEY = "quest-net-context";
const BACKUP_PREFIX = `${STORAGE_KEY}-backup`;

export const ContextActions = {
	/**
	 * Creates a new context with default values
	 */
	create(): Context {
		const context: Context = {
			User: UserActions.createNewUser(),
			Campaigns: [],
			AppSettings: {},
			version: APP_VERSION,
			SecretModes: {},
		};

		this.save(context);
		return context;
	},

	/**
	 * Loads context from localStorage and runs migrations.
	 * On migration failure, backs up the original context and returns a fresh one.
	 */
	load(): Context | null {
		const stored = LocalStorageUtilities.load<Context>(STORAGE_KEY);
		if (!stored) return null;

		// Keep a clean copy to back up if migration fails
		// You already use structuredClone elsewhere, so we can lean on it.
		const original: Context = structuredClone(stored);

		try {
			const migrated = runMigrations(stored, APP_VERSION);
			
			if (!migrated.SecretModes) {
				migrated.SecretModes = {};
			}

			// If migration changed version, persist
			if (migrated.version !== stored.version) {
				this.save(migrated);
			}

			return migrated;
		} catch (error) {
			console.error("[Context] Failed to migrate context:", error);

			// 1. Back up the original context under a timestamped key
			try {
				const timestamp = new Date().toISOString(); // stable + readable
				const backupKey = `${BACKUP_PREFIX}-${timestamp}`;

				LocalStorageUtilities.save(backupKey, original);

				// Optional: also keep a "latest" pointer for convenience
				LocalStorageUtilities.save(`${BACKUP_PREFIX}-latest`, original);

				console.warn(
					`[Context] Original context backed up under "${backupKey}" (and "${BACKUP_PREFIX}-latest").`
				);
			} catch (backupError) {
				console.error(
					"[Context] Failed to back up original context:",
					backupError
				);
			}

			// 2. Create a fresh context so the app can still load
			const fresh = this.create(); // this will overwrite STORAGE_KEY
			return fresh;
		}
	},

	/**
	 * Saves context to localStorage
	 */
	save(context: Context): void {
		LocalStorageUtilities.save(STORAGE_KEY, context);
	},

	/**
	 * Clears context from localStorage
	 */
	clear(): void {
		LocalStorageUtilities.remove(STORAGE_KEY);
	},

	/**
	 * Sets the user's role and saves context
	 */
	setUserRole(params: { role: "dm" | "player" }, context: Context): void {
		context.User.Role = params.role;
	},
};
