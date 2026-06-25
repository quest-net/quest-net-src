// services/CloudBackupService.ts
//
// Orchestration for Google Drive campaign backup. Bridges the app/campaign
// domain (CampaignUtils, CampaignLoadingService, Context) and the pure transport
// layer (GoogleDriveBackupService). Owns the "invisible by default" policy:
// silently back up every DM campaign on app open, silently restore campaigns
// that exist in Drive but not locally, and surface only a single confirm modal
// when a Drive backup is genuinely newer than a local copy.

import {
	contextStore,
	forceContextRerender,
	markCampaignUpdated,
} from "../domains/Context/contextStore";
import { Context } from "../domains/Context/Context";
import { CampaignInfo } from "../domains/Campaign/CampaignInfo";
import {
	CampaignUtils,
	type CampaignCountDiff,
} from "../domains/Campaign/CampaignUtils";
import { CampaignLoadingService } from "./CampaignLoadingService";
import {
	GoogleDriveBackupService,
	type BackupFileMeta,
	type DriveBackupMeta,
} from "./GoogleDriveBackupService";
import {
	AppSettingUtils,
	PROFILE_SYNCED_APP_SETTING_KEYS,
} from "../domains/AppSetting/AppSettingUtils";
import { isCloudBackupConfigured } from "../config/googleDrive";
import { isGUID } from "../utils/UrlParser";
import { APP_VERSION } from "../version";

/** A Drive backup that is newer than its local counterpart, awaiting confirm. */
export interface PendingRestore {
	backup: DriveBackupMeta;
	local: CampaignInfo;
	diff: CampaignCountDiff;
}

export interface SyncResult {
	/** How many absent campaigns were silently restored as copies. */
	restoredCount: number;
	/** Newer-than-local backups that need a user confirm before applying. */
	newer: PendingRestore[];
}

/** Local last-updated time for a campaign (0 if never recorded). Callers fall
 *  back to the campaign's CreatedAt when this is 0. */
function lastUpdatedOf(context: Context, campaignId: string): number {
	return context.LastUpdated?.[campaignId] ?? 0;
}

/** The synced "account" profile — the content of the Drive profile.json file. */
interface ProfilePayload {
	version: string;
	lastUpdated: number;
	user: { Name: string };
	appSettings: Record<string, string>;
}

/** Builds the profile payload from live context (allowlisted AppSettings only). */
function buildProfilePayload(
	context: Context,
	lastUpdated: number
): ProfilePayload {
	const appSettings: Record<string, string> = {};
	for (const key of PROFILE_SYNCED_APP_SETTING_KEYS) {
		const value = context.AppSettings[key];
		if (typeof value === "string") appSettings[key] = value;
	}
	return {
		version: APP_VERSION,
		lastUpdated,
		user: { Name: context.User.Name },
		appSettings,
	};
}

/** Adopts a downloaded profile onto the live context (allowlisted keys only).
 *  Merges AppSettings rather than replacing, so device-local keys (notably the
 *  cloudBackup connection blob) are preserved. */
function applyProfilePayload(payload: ProfilePayload): void {
	const name = payload?.user?.Name;
	if (typeof name === "string" && name.trim()) {
		contextStore.User.Name = name;
	}
	const incoming = payload?.appSettings ?? {};
	for (const key of PROFILE_SYNCED_APP_SETTING_KEYS) {
		const value = incoming[key];
		if (typeof value === "string") contextStore.AppSettings[key] = value;
	}
}

export const CloudBackupService = {
	isConfigured(): boolean {
		return isCloudBackupConfigured();
	},

	isConnected(context: Context): boolean {
		return AppSettingUtils.getCloudBackup(context)?.connected === true;
	},

	/** Campaigns this user is the DM of (GUID id) — the only ones we back up. */
	dmCampaigns(context: Context): CampaignInfo[] {
		return context.Campaigns.filter((c) => isGUID(c.Id));
	},

	/** Acquires a Drive session and records the connection. */
	async connect(interactive: boolean): Promise<{ email?: string }> {
		const { email } = await GoogleDriveBackupService.connect({ interactive });
		AppSettingUtils.setCloudBackupConnected(
			{ connected: true, email },
			contextStore
		);
		return { email };
	},

	disconnect(): void {
		GoogleDriveBackupService.disconnect();
		AppSettingUtils.clearCloudBackup(contextStore);
	},

	/** Ensures a live token without re-prompting when one is already held. */
	async ensureSession(): Promise<void> {
		if (GoogleDriveBackupService.hasLiveToken()) return;
		await this.connect(false);
	},

	// -------------------------------------------------------------------------
	// Backup
	// -------------------------------------------------------------------------

	/**
	 * Loads a DM campaign, ensures it has a stable BackupKey (persisting it), and
	 * uploads it — unless the cloud already holds an equal-or-newer state.
	 */
	async backupCampaign(
		info: CampaignInfo,
		context: Context,
		cloudMeta?: DriveBackupMeta
	): Promise<void> {
		const campaign =
			context.ActiveCampaign && context.ActiveCampaign.Id === info.Id
				? context.ActiveCampaign
				: await CampaignLoadingService.loadCampaign(info.Id);
		if (!campaign) return;

		// Ensure a stable BackupKey and mirror it onto the in-memory CampaignInfo
		// so future on-open matching is cheap (no payload load required).
		let key = campaign.BackupKey;
		const ci = context.Campaigns.find((c) => c.Id === info.Id);
		if (!key) {
			key = crypto.randomUUID();
			campaign.BackupKey = key;
			if (ci) ci.BackupKey = key;
			await CampaignLoadingService.saveCampaign(campaign);
		} else if (ci && ci.BackupKey !== key) {
			ci.BackupKey = key;
		}

		const lastUpdated =
			lastUpdatedOf(context, campaign.Id) || campaign.CreatedAt;
		// Never upload over an equal-or-newer cloud state (skips unchanged
		// campaigns and prevents a stale device clobbering a newer backup).
		if (cloudMeta && cloudMeta.lastUpdated >= lastUpdated) return;

		const exportData = await CampaignUtils.buildExportDataForCampaign(campaign);
		const json = JSON.stringify(exportData);
		const meta: BackupFileMeta = {
			backupKey: key,
			campaignName: campaign.Name,
			lastUpdated,
			version: exportData.version,
			counts: CampaignUtils.campaignCounts(campaign),
		};
		await GoogleDriveBackupService.uploadBackup(json, meta, cloudMeta?.fileId);
	},

	/** Backs up every DM campaign whose local state is newer than the cloud. */
	async backupAllDmCampaigns(
		context: Context,
		backups?: DriveBackupMeta[]
	): Promise<void> {
		await this.ensureSession();
		const cloud = backups ?? (await GoogleDriveBackupService.listBackups());
		const cloudByKey = new Map(cloud.map((b) => [b.backupKey, b]));

		for (const info of this.dmCampaigns(context)) {
			const cloudMeta = info.BackupKey
				? cloudByKey.get(info.BackupKey)
				: undefined;
			await this.backupCampaign(info, context, cloudMeta);
		}
	},

	/** Manual "Back up now" entry point; records the resulting status. */
	async backupNow(context: Context): Promise<void> {
		try {
			await this.backupAllDmCampaigns(context);
			AppSettingUtils.setCloudBackupStatus({ ok: true }, contextStore);
		} catch (e) {
			AppSettingUtils.setCloudBackupStatus(
				{ ok: false, error: e instanceof Error ? e.message : String(e) },
				contextStore
			);
			throw e;
		}
	},

	// -------------------------------------------------------------------------
	// Restore
	// -------------------------------------------------------------------------

	/** Restores a cloud backup with no local counterpart as a brand-new copy. */
	async restoreCopy(
		backup: DriveBackupMeta,
		context: Context
	): Promise<CampaignInfo> {
		const data = await GoogleDriveBackupService.downloadBackup(backup.fileId);
		const info = await CampaignUtils.restoreFromExportData(data, context, {
			mode: "copy",
		});
		// Adopt the backup's own timestamp (saveCampaign just stamped it as "now"),
		// so this freshly-downloaded copy isn't seen as newer and re-uploaded.
		markCampaignUpdated(info.Id, backup.lastUpdated);
		return info;
	},

	/** Applies a newer cloud backup over an existing local campaign in place. */
	async restoreNewer(pending: PendingRestore, context: Context): Promise<void> {
		const data = await GoogleDriveBackupService.downloadBackup(
			pending.backup.fileId
		);
		const targetId = pending.local.Id;
		await CampaignUtils.restoreFromExportData(data, context, {
			mode: "replace",
			targetCampaignId: targetId,
		});
		// Adopt the backup's own timestamp (saveCampaign just stamped it as "now"),
		// so the restored copy isn't immediately re-uploaded as if it were newer.
		markCampaignUpdated(targetId, pending.backup.lastUpdated);

		// If we just overwrote the live campaign, re-hydrate it from disk.
		if (context.ActiveCampaign && context.ActiveCampaign.Id === targetId) {
			const reloaded = await CampaignLoadingService.loadCampaign(targetId);
			if (reloaded) {
				contextStore.ActiveCampaign = reloaded;
				forceContextRerender();
			}
		}
	},

	/** Computes the shrink diff (cloud counts are free; local needs a load). */
	async computeShrinkDiff(
		backup: DriveBackupMeta,
		local: CampaignInfo
	): Promise<CampaignCountDiff> {
		const incoming = backup.counts;
		const localCampaign = await CampaignLoadingService.loadCampaign(local.Id);
		const localCounts = localCampaign
			? CampaignUtils.campaignCounts(localCampaign)
			: null;
		if (!incoming || !localCounts) {
			return { changes: [], significantShrink: false };
		}
		return CampaignUtils.diffCounts(localCounts, incoming);
	},

	// -------------------------------------------------------------------------
	// Account profile (identity + preferences)
	// -------------------------------------------------------------------------

	/**
	 * Syncs the "account" profile (User.Name + allowlisted AppSettings) against
	 * the singleton Drive profile.json, last-write-wins by timestamp. Adopting a
	 * newer cloud profile stamps ProfileUpdated with the cloud's own time so the
	 * adoption isn't immediately echoed back as a local change. A pristine device
	 * (ProfileUpdated === 0) never uploads — it only ever adopts. Never reads or
	 * writes the device-local cloudBackup connection blob.
	 */
	async syncProfile(context: Context): Promise<void> {
		const cloudMeta = await GoogleDriveBackupService.getProfileMeta();
		const local = context.ProfileUpdated ?? 0;
		const cloudTime = cloudMeta?.lastUpdated ?? 0;

		if (cloudMeta && cloudTime > local) {
			const payload = (await GoogleDriveBackupService.downloadProfile(
				cloudMeta.fileId
			)) as ProfilePayload;
			applyProfilePayload(payload);
			contextStore.ProfileUpdated = cloudTime;
			forceContextRerender();
			return;
		}

		if (local > 0 && local > cloudTime) {
			const payload = buildProfilePayload(context, local);
			await GoogleDriveBackupService.uploadProfile(JSON.stringify(payload), {
				lastUpdated: local,
				version: payload.version,
			});
		}
	},

	// -------------------------------------------------------------------------
	// On-open sync
	// -------------------------------------------------------------------------

	/**
	 * The whole on-open flow: silently restore absent campaigns, collect
	 * newer-than-local backups for the confirm modal, and back up changed DM
	 * campaigns. Returns null when backup isn't configured/connected; throws are
	 * surfaced by runOnOpen as a failed status.
	 */
	async syncOnOpen(context: Context): Promise<SyncResult> {
		await this.ensureSession();

		// Sync the account profile (identity + preferences) first, so an adopted
		// name/settings are in place for the rest of the open. Isolated in its own
		// try/catch: a profile hiccup must never block campaign backup/restore.
		try {
			await this.syncProfile(context);
		} catch (e) {
			console.error("[CloudBackup] Profile sync failed:", e);
		}

		const backups = await GoogleDriveBackupService.listBackups();
		const localByKey = new Map<string, CampaignInfo>();
		for (const c of this.dmCampaigns(context)) {
			if (c.BackupKey) localByKey.set(c.BackupKey, c);
		}

		// 1) Silently restore backups that have no local counterpart.
		let restoredCount = 0;
		for (const b of backups) {
			if (localByKey.has(b.backupKey)) continue;
			try {
				const info = await this.restoreCopy(b, context);
				localByKey.set(b.backupKey, info);
				restoredCount++;
			} catch (e) {
				console.error(
					`[CloudBackup] Auto-restore failed for ${b.campaignName}:`,
					e
				);
			}
		}

		// 2) Collect backups newer than their local counterpart for the modal.
		const newer: PendingRestore[] = [];
		for (const b of backups) {
			const local = localByKey.get(b.backupKey);
			if (!local) continue;
			const localUpdated = lastUpdatedOf(context, local.Id) || local.CreatedAt;
			if (b.lastUpdated <= localUpdated) continue;
			const diff = await this.computeShrinkDiff(b, local);
			newer.push({ backup: b, local, diff });
		}

		// 3) Back up changed DM campaigns (guarded; won't clobber newer cloud).
		await this.backupAllDmCampaigns(context, backups);

		return { restoredCount, newer };
	},

	/** syncOnOpen wrapper that records success/failure status. */
	async runOnOpen(context: Context): Promise<SyncResult | null> {
		if (!this.isConfigured() || !this.isConnected(context)) return null;
		try {
			const result = await this.syncOnOpen(context);
			AppSettingUtils.setCloudBackupStatus({ ok: true }, contextStore);
			return result;
		} catch (e) {
			console.error("[CloudBackup] Sync on open failed:", e);
			AppSettingUtils.setCloudBackupStatus(
				{ ok: false, error: e instanceof Error ? e.message : String(e) },
				contextStore
			);
			return null;
		}
	},

	/** Homepage "Log in to Google" entry point: connect then run the sync. */
	async connectAndSync(context: Context): Promise<SyncResult | null> {
		await this.connect(true);
		return this.runOnOpen(context);
	},
};
