// domains/Context/ContextService.ts

import { Context } from "./Context";
import { LocalStorageUtilities } from "../../utils/LocalStorageUtilities";
import { UserUtils } from "../User/UserUtils";
import { APP_VERSION } from "../../version";
import { CampaignLoadingService } from "../../services/CampaignLoadingService";
import type { Campaign } from "../Campaign/Campaign";
import type { CampaignInfo } from "../Campaign/CampaignInfo";
import { TerrainStorageService } from "../../services/TerrainStorageService";
import {
	getTerrainVoxels,
	hasTerrainPayload,
} from "../../utils/terrain/data/terrainPayloadStore";
import { runMigrations } from "../../migrations/runMigrations";
import { contextMigrations } from "../../migrations/contextMigrations";
import { campaignMigrations } from "../../migrations/campaignMigrations";
import { backupContextOnce } from "../../migrations/contextBackup";
import { addMissingDefaultVoxelStamps } from "../../data/defaultVoxelStamps";

const STORAGE_KEY = "quest-net-context";
const BACKUP_PREFIX = `${STORAGE_KEY}-backup`;

// Tracks each materialized terrain's voxels most recently written to IndexedDB
// (keyed by `${campaignId}:${terrainId}` -> voxel value), so flush() only
// re-writes a terrain when its voxels actually changed. Keying on value (not
// reference) keeps the player path correct, which structuredClones the campaign
// on every state sync (fresh-but-equal string).
const lastPersistedTerrainVoxels = new Map<string, string>();

// The canonical campaign object no longer carries voxel payloads (they live in
// TerrainPayloadStore + IndexedDB), so the localStorage copy is naturally
// payload-free -- no stripping needed.
function persistToLocalStorage(context: Context): void {
	const persistedContext: Context = { ...context };
	delete persistedContext.IsOptimistic;
	LocalStorageUtilities.save(STORAGE_KEY, persistedContext);
}

/**
 * Writes every currently-materialized terrain's voxels to IndexedDB, but only
 * when they have changed since the last write. IndexedDB is the per-client
 * source of truth for terrain payloads; hydrateTerrain reads them back on next
 * load. With multi-terrain worlds several terrains may be materialized at once.
 */
async function writeHydratedTerrainsThroughIfChanged(
	context: Context
): Promise<void> {
	const campaign = context.ActiveCampaign;
	if (!campaign) return;
	for (const terrain of campaign.VoxelTerrains ?? []) {
		if (!hasTerrainPayload(terrain.Id)) continue;
		const voxels = getTerrainVoxels(terrain.Id);
		const key = `${campaign.Id}:${terrain.Id}`;
		if (lastPersistedTerrainVoxels.get(key) === voxels) continue;
		try {
			await TerrainStorageService.saveTerrain(campaign, terrain);
			lastPersistedTerrainVoxels.set(key, voxels);
		} catch (error) {
			console.error(
				"[Context] Failed to persist terrain to IndexedDB:",
				error
			);
		}
	}
}

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

export const ContextService = {
	/**
	 * Creates a new context with default values
	 */
	create(): Context {
		const context: Context = {
			User: UserUtils.createNewUser(),
			Campaigns: [],
			ActiveCampaign: null,
			AppSettings: {},
			version: APP_VERSION,
			SecretModes: {},
			ViewedTerrains: {},
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
			if (!context.ViewedTerrains) {
				context.ViewedTerrains = {};
			}
			if (!Array.isArray(context.Campaigns)) {
				context.Campaigns = [];
			}
			// Ensure the field always exists (default null) so consumers can
			// rely on it being present even on contexts stored before it existed.
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

			// Prepare (resets the per-client payload buffer for this campaign and
			// hydrates the kept terrains from IndexedDB) BEFORE adding default
			// stamps -- otherwise the buffer reset would discard the freshly
			// materialized stamp payloads before flush() can persist them.
			const didPrepareActiveCampaign = !!context.ActiveCampaign;
			if (context.ActiveCampaign) {
				await TerrainStorageService.prepareCampaignAfterLoad(
					context.ActiveCampaign
				);
			}
			const addedDefaultVoxelStamps = context.ActiveCampaign
				? addMissingDefaultVoxelStamps(context.ActiveCampaign)
				: 0;

			if (
				didReshape ||
				didPrepareActiveCampaign ||
				hadPersistedOptimisticFlag ||
				addedDefaultVoxelStamps > 0
			) {
				// flush (not save) so the active terrain is written through to
				// IndexedDB and the stored Context is voxel-stubbed. This also
				// migrates any legacy inline-voxel payload still sitting in
				// localStorage into IndexedDB on first load.
				await this.flush(context);
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
		// Synchronous save. The campaign object is already payload-free (voxels
		// live in TerrainPayloadStore / IndexedDB), so this is cheap.
		persistToLocalStorage(context);
	},

	/**
	 * Debounced persistence path used by triggerContextUpdate. Writes the active
	 * terrain's voxels to IndexedDB (only when they changed) and persists a
	 * voxel-stubbed Context to localStorage, keeping the large terrain blob off
	 * the per-action serialization path.
	 */
	async flush(context: Context): Promise<void> {
		await writeHydratedTerrainsThroughIfChanged(context);
		persistToLocalStorage(context);
	},

	/**
	 * Clears context from localStorage
	 */
	clear(): void {
		lastPersistedTerrainVoxels.clear();
		LocalStorageUtilities.remove(STORAGE_KEY);
	},

	/**
	 * Sets the user's role and saves context
	 */
	setUserRole(params: { role: "dm" | "player" }, context: Context): void {
		context.User.Role = params.role;
		if (params.role === "dm" && context.ActiveCampaign) {
			UserUtils.clearSelectedCharacter(
				{ campaignId: context.ActiveCampaign.Id },
				context
			);
			UserUtils.clearSelectedCharacter(
				{ campaignId: context.ActiveCampaign.RoomCode },
				context
			);
		}
	},
};
