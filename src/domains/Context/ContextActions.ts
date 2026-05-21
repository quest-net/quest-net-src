// domains/Context/ContextActions.ts

import { Context } from "./Context";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import { UserActions } from "../User/UserActions";
import { APP_VERSION } from "../../version";
import { CampaignLoadingService } from "../../services/CampaignLoadingService";
import type { Campaign } from "../Campaign/Campaign";
import type { CampaignInfo } from "../Campaign/CampaignInfo";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import { runMigrations } from "../../migrations/runMigrations";
import { contextMigrations } from "../../migrations/contextMigrations";
import { campaignMigrations } from "../../migrations/campaignMigrations";
import { backupContextOnce } from "../../migrations/contextBackup";
import { addMissingDefaultVoxelStamps } from "../../data/defaultVoxelStamps";

const STORAGE_KEY = "quest-net-context";
const BACKUP_PREFIX = `${STORAGE_KEY}-backup`;

// One-shot IndexedDB backup taken right before the 2.3.0 voxel SVO migration
// reshapes terrain payloads. Keyed by version so future risky migrations can
// add their own pre-snapshot under a distinct key without clobbering this one.
const PRE_SVO_BACKUP_KEY = "pre-2.3.0";
const PRE_SVO_BACKUP_THRESHOLD = "2.3.0";

function isOlderVersion(a: string, b: string): boolean {
	const pa = a.split(".").map(Number);
	const pb = b.split(".").map(Number);
	const len = Math.max(pa.length, pb.length);
	for (let i = 0; i < len; i++) {
		const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
		if (diff !== 0) return diff < 0;
	}
	return false;
}

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
			const storedVersion: string = (stored as any).version ?? "0.0.0";

			// Safety net for the 2.3.0 voxel SVO migration: snapshot the raw
			// stored Context (with its inline legacy voxel payload) into
			// IndexedDB before any transformation runs. Best-effort -- failure
			// to back up is logged but does not block the migration.
			if (isOlderVersion(storedVersion, PRE_SVO_BACKUP_THRESHOLD)) {
				await backupContextOnce(PRE_SVO_BACKUP_KEY, storedVersion, original);
			}

			// Run context-level migrations (operates on the raw stored object).
			const context = (await runMigrations(
				stored,
				storedVersion,
				contextMigrations
			)) as Context;
			const hadPersistedOptimisticFlag = "IsOptimistic" in context;
			delete context.IsOptimistic;

			// Run campaign-level migrations for the ActiveCampaign stored in
			// localStorage.  The IDB copies of inactive campaigns are migrated
			// lazily on first load via CampaignLoadingService.loadCampaign.
			if (context.ActiveCampaign && storedVersion !== APP_VERSION) {
				context.ActiveCampaign = (await runMigrations(
					context.ActiveCampaign,
					storedVersion,
					campaignMigrations
				)) as Campaign;
			}

			if (!context.SecretModes) {
				context.SecretModes = {};
			}
			if (!Array.isArray(context.Campaigns)) {
				context.Campaigns = [];
			}
			// ActiveCampaign is not persisted (it's just a localStorage cache),
			// but ensure the field always exists so consumers can rely on it.
			if (!("ActiveCampaign" in context) || context.ActiveCampaign === undefined) {
				(context as Context).ActiveCampaign = null;
			}

			// Legacy reshape: if any entry in Campaigns is still a full Campaign
			// (the pre-split layout), pack it into IndexedDB and replace it with
			// a CampaignInfo. This runs at most once per device after upgrade.
			const fullCampaigns: Campaign[] = [];
			const newCampaigns: CampaignInfo[] = [];
			let didReshape = false;
			for (const entry of context.Campaigns as Array<CampaignInfo | Campaign>) {
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
				context.Campaigns = newCampaigns;
			}

			// Stamp the current version so the field stays current.
			context.version = APP_VERSION;

			const addedDefaultVoxelStamps = context.ActiveCampaign
				? addMissingDefaultVoxelStamps(context.ActiveCampaign)
				: 0;
			const didPrepareActiveCampaign = !!context.ActiveCampaign;
			if (context.ActiveCampaign) {
				await TerrainStorageService.prepareCampaignAfterLoad(
					context.ActiveCampaign
				);
			}

			if (
				didReshape ||
				didPrepareActiveCampaign ||
				hadPersistedOptimisticFlag ||
				addedDefaultVoxelStamps > 0
			) {
				this.save(context);
			}

			return context;
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
		const persistedContext: Context = { ...context };
		delete persistedContext.IsOptimistic;
		LocalStorageUtilities.save(STORAGE_KEY, persistedContext);
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
