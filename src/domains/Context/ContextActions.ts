// domains/Context/ContextActions.ts

import { Context } from "./Context";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import { UserActions } from "../User/UserActions";
import { APP_VERSION } from "../../version";
import { runMigrations } from "../../updates/migrator";
import { CampaignLoadingService } from "../../services/CampaignLoadingService";
import type { Campaign } from "../Campaign/Campaign";
import type { CampaignInfo } from "../Campaign/CampaignInfo";

const STORAGE_KEY = "quest-net-context";
const BACKUP_PREFIX = `${STORAGE_KEY}-backup`;

/**
 * Detects the legacy on-disk shape where Context.Campaigns held full Campaign
 * objects (with their GameState etc.) instead of CampaignInfo metadata. We
 * key off the GameState field since CampaignInfo never has one.
 */
function looksLikeFullCampaign(c: any): c is Campaign {
	return c && typeof c === "object" && "GameState" in c && "Settings" in c;
}

export const ContextActions = {
	/**
	 * Creates a new context with default values
	 */
	create(): Context {
		const context: Context = {
			User: UserActions.createNewUser(),
			Campaigns: [],
			ActiveCampaign: null,
			AppSettings: {},
			version: APP_VERSION,
			SecretModes: {},
		};

		this.save(context);
		return context;
	},

	/**
	 * Loads context from localStorage and runs migrations.
	 *
	 * Async because, on first load after upgrading from the pre-split layout,
	 * we may need to write each existing Campaign out to IndexedDB.
	 *
	 * On migration failure, backs up the original context and returns a fresh one.
	 */
	async load(): Promise<Context | null> {
		const stored = LocalStorageUtilities.load<Context>(STORAGE_KEY);
		if (!stored) return null;

		// Keep a clean copy to back up if migration fails
		const original: Context = structuredClone(stored);

		try {
			const migrated = runMigrations(stored, APP_VERSION);
			const didMigrateContext = migrated.version !== stored.version;

			if (!migrated.SecretModes) {
				migrated.SecretModes = {};
			}
			if (!Array.isArray(migrated.Campaigns)) {
				migrated.Campaigns = [];
			}
			// ActiveCampaign is not persisted (it's just a localStorage cache),
			// but ensure the field always exists so consumers can rely on it.
			if (!("ActiveCampaign" in migrated) || migrated.ActiveCampaign === undefined) {
				(migrated as Context).ActiveCampaign = null;
			}

			// Legacy reshape: if any entry in Campaigns is still a full Campaign
			// (the pre-split layout), pack it into IndexedDB and replace it with
			// a CampaignInfo. This runs at most once per device after upgrade.
			const fullCampaigns: Campaign[] = [];
			const newCampaigns: CampaignInfo[] = [];
			let didReshape = false;
			for (const entry of migrated.Campaigns as Array<CampaignInfo | Campaign>) {
				if (looksLikeFullCampaign(entry)) {
					fullCampaigns.push(entry);
					newCampaigns.push(CampaignLoadingService.buildInfo(entry));
					didReshape = true;
				} else {
					newCampaigns.push(entry as CampaignInfo);
				}
			}

			if (didReshape) {
				console.log(
					`[Context] Splitting ${fullCampaigns.length} legacy campaign(s) out to IndexedDB`
				);
				for (const c of fullCampaigns) {
					try {
						await CampaignLoadingService.saveCampaign(c);
					} catch (e) {
						console.error(
							`[Context] Failed to pack legacy campaign ${c.Id} into IndexedDB:`,
							e
						);
					}
				}
				migrated.Campaigns = newCampaigns;
			}

			const hasOutdatedCampaignInfo = migrated.Campaigns.some(
				(c) => c.Version !== APP_VERSION
			);
			if (didMigrateContext || hasOutdatedCampaignInfo) {
				await CampaignLoadingService.migrateStoredCampaigns(migrated);
			}

			// If migration changed version OR we reshaped, persist
			if (didMigrateContext || didReshape || hasOutdatedCampaignInfo) {
				this.save(migrated);
			}

			return migrated;
		} catch (error) {
			console.error("[Context] Failed to migrate context:", error);

			// 1. Back up the original context under a timestamped key
			try {
				const timestamp = new Date().toISOString();
				const backupKey = `${BACKUP_PREFIX}-${timestamp}`;

				LocalStorageUtilities.save(backupKey, original);
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
			const fresh = this.create();
			return fresh;
		}
	},

	/**
	 * Saves context to localStorage. ActiveCampaign rides along in
	 * localStorage during play so reloads pick up where the user left off; we
	 * only "pack" it back out to IndexedDB when switching to a different
	 * campaign (see CampaignLoadingService and CampaignView).
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
		if (params.role === "dm" && context.ActiveCampaign) {
			UserActions.clearSelectedCharacter(
				{ campaignId: context.ActiveCampaign.Id },
				context
			);
			UserActions.clearSelectedCharacter(
				{ campaignId: context.ActiveCampaign.RoomCode },
				context
			);
		}
	},
};
