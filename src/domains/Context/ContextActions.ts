// domains/Context/ContextActions.ts

import { Context } from "./Context";
import { Campaign } from "../Campaign/Campaign";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import { IndexedDBUtilities } from "../../utils/IndexedDBUtilities";
import { UserActions } from "../User/UserActions";
import { APP_VERSION } from "../../version";
import { runMigrations } from "../../updates/migrator";
import {
	markIDBMigrationsComplete,
	runIDBMigrations,
} from "../../updates/idb-migrator";
import { isGUID } from "../../utils/UrlParser";

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
	 * Loads context from localStorage, runs sync migrations, then async IDB migrations.
	 * ActiveCampaign is never persisted — it starts undefined and is populated by
	 * CampaignView when the user navigates to a campaign URL.
	 * On failure, backs up the original context and returns a fresh one.
	 */
	async load(): Promise<Context | null> {
		const stored = LocalStorageUtilities.load<Context>(STORAGE_KEY);
		if (!stored) return null;

		const original: Context = structuredClone(stored);

		try {
			// 1. Sync context migrations (schema changes, version bump)
			let context = runMigrations(stored, APP_VERSION);

			if (!context.SecretModes) {
				context.SecretModes = {};
			}

			// 2. Async IDB migrations (campaign extraction, etc.)
			context = await runIDBMigrations(context, APP_VERSION);

			// 3. Persist the migrated context before marking the IDB chain complete.
			this.save(context);
			markIDBMigrationsComplete(APP_VERSION);
			this.cleanupLegacyPlayerCampaignCaches(context).catch((cleanupError) =>
				console.warn(
					"[Context] Failed to clean up legacy player campaign caches:",
					cleanupError
				)
			);

			return context;
		} catch (error) {
			console.error("[Context] Failed to migrate context:", error);

			try {
				const timestamp = new Date().toISOString();
				const backupKey = `${BACKUP_PREFIX}-${timestamp}`;
				LocalStorageUtilities.save(backupKey, original);
				LocalStorageUtilities.save(`${BACKUP_PREFIX}-latest`, original);
				console.warn(
					`[Context] Original context backed up under "${backupKey}" and "${BACKUP_PREFIX}-latest".`
				);
			} catch (backupError) {
				console.error("[Context] Failed to back up original context:", backupError);
			}

			throw error;
		}
	},

	/**
	 * Saves context to localStorage.
	 * ActiveCampaign is stripped before writing (runtime-only, lives in IndexedDB).
	 * If ActiveCampaign is present it is also written to IndexedDB fire-and-forget.
	 */
	save(context: Context): void {
		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		const { ActiveCampaign, ...contextForStorage } = context;
		LocalStorageUtilities.save(STORAGE_KEY, contextForStorage);

		if (ActiveCampaign) {
			IndexedDBUtilities.saveCampaign(ActiveCampaign).catch((err) =>
				console.error("[Context] Failed to persist campaign to IDB:", err)
			);
		}
	},

	/**
	 * Loads the campaign matching the given URL identifier from IndexedDB and
	 * sets it as context.ActiveCampaign.
	 * - If a different campaign is already active, it is flushed to IDB first.
	 * - Returns the loaded campaign, or null if not found in IDB.
	 */
	async loadActiveCampaign(
		identifier: string,
		context: Context
	): Promise<Campaign | null> {
		const active = context.ActiveCampaign;
		const isDM = isGUID(identifier);

		// Already the right campaign — nothing to do
		if (active) {
			const matches = isDM
				? active.Id === identifier
				: active.RoomCode === identifier;
			if (matches) return active;

			// Different campaign is active — flush it first to avoid losing state
			await this.flushActiveCampaign(active);
		}

		const campaign = await IndexedDBUtilities.loadCampaign(identifier);
		if (campaign) {
			context.ActiveCampaign = campaign;
		}
		return campaign;
	},

	/**
	 * Explicitly writes the active campaign to IndexedDB.
	 * Call before swapping to a different campaign.
	 */
	async flushActiveCampaign(campaign: Campaign): Promise<void> {
		await IndexedDBUtilities.saveCampaign(campaign);
	},

	/**
	 * Removes legacy player cache keys only after the new IDB records, context
	 * stubs, and IDB version marker have all been committed.
	 */
	async cleanupLegacyPlayerCampaignCaches(context: Context): Promise<void> {
		const legacyKeys = LocalStorageUtilities.listKeysWithPrefix("campaign_");
		for (const key of legacyKeys) {
			const roomCode = key.slice("campaign_".length);
			const hasStub = context.Campaigns.some((campaign) => campaign.Id === roomCode);
			if (!hasStub) continue;

			const storedCampaign = await IndexedDBUtilities.loadCampaign(roomCode);
			if (storedCampaign) {
				LocalStorageUtilities.remove(key);
			}
		}
	},

	/**
	 * Clears context from localStorage
	 */
	clear(): void {
		LocalStorageUtilities.remove(STORAGE_KEY);
	},

	/**
	 * Sets the user's role (does not call save — caller is responsible)
	 */
	setUserRole(params: { role: "dm" | "player" }, context: Context): void {
		context.User.Role = params.role;
	},
};
