// services/CloudBackupService.ts
//
// Orchestration for Google Drive campaign backup. Bridges the app/campaign
// domain (CampaignUtils, CampaignLoadingService, Context) and the pure transport
// layer (GoogleDriveBackupService). Owns the "invisible by default" policy:
// silently back up every DM campaign on app open, silently restore campaigns
// that exist in Drive but not locally, and surface only a single confirm modal
// when a Drive backup is genuinely newer than a local copy.

import {
	adoptCloudRevision,
	backedUpRevision,
	campaignRevision,
	contextStore,
	forceContextRerender,
	markCampaignBackedUp,
} from "../domains/Context/contextStore";
import { Context } from "../domains/Context/Context";
import { CampaignInfo } from "../domains/Campaign/CampaignInfo";
import type { Campaign } from "../domains/Campaign/Campaign";
import {
	CampaignUtils,
	hasNoMissingBinaries,
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
import {
	cloudIsAhead,
	hasUnbackedUpChanges,
	type BackupRevisionState,
} from "./cloudBackupFreshness";
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
	/** Binaries pulled back from Drive to replace ones lost to storage eviction. */
	repaired: { images: number; terrains: number };
}

// How many revisions the binary repair will DOWNLOAD before giving up (purged
// revisions that fail to download don't count). Newest-first, so the cap only
// bites when many consecutive readable revisions are all missing the same data.
const MAX_REPAIR_REVISIONS = 15;

// Retention. Every backup uploads the FULL payload, so storage cost is
// campaign size x revision count -- frequent backups only stay affordable
// because Drive purges unpinned revisions (30 days / 100 versions) for free.
// We pin one revision a week as the durable trail and keep the newest ten,
// which is the "last ~10 sessions" a weekly group expects. Count-based rather
// than age-based so a DM who takes three months off still has restore points.
const PIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_PINNED_REVISIONS = 10;

/** Local last-updated time for a campaign (0 if never recorded). Display only —
 *  freshness decisions use revisions, never this. */
function lastUpdatedOf(context: Context, campaignId: string): number {
	return context.LastUpdated?.[campaignId] ?? 0;
}

/** Gathers the three counters the freshness rules compare. */
function revisionState(
	context: Context,
	campaignId: string,
	cloudRevision: number
): BackupRevisionState {
	return {
		local: campaignRevision(context, campaignId),
		backedUp: backedUpRevision(context, campaignId),
		cloud: cloudRevision,
	};
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
	 * uploads it — unless the cloud already holds everything this device has.
	 */
	async backupCampaign(
		info: CampaignInfo,
		context: Context,
		cloudMeta?: DriveBackupMeta,
		binariesChecked?: Set<string>,
		forceNewBackupKey = false
	): Promise<void> {
		// Decide BEFORE loading anything. This gate used to sit after the load, so
		// a routine hourly backup pulled every DM campaign off disk just to
		// discover it had nothing to upload — and each of those loads re-keyed the
		// single global terrain payload buffer to the campaign being examined,
		// blanking the voxels of the campaign the DM was actually playing.
		// A campaign that has never been uploaded (no cloudMeta) always proceeds, as
		// does one being re-keyed onto a file of its own.
		if (
			cloudMeta &&
			!forceNewBackupKey &&
			!hasUnbackedUpChanges(revisionState(context, info.Id, cloudMeta.revision))
		) {
			return;
		}

		const isActive =
			!!context.ActiveCampaign && context.ActiveCampaign.Id === info.Id;
		const campaign = isActive
			? context.ActiveCampaign!
			: await CampaignLoadingService.loadCampaignRaw(info.Id);
		if (!campaign) return;

		// Ensure a stable BackupKey and mirror it onto the in-memory CampaignInfo
		// so future on-open matching is cheap (no payload load required).
		let key = campaign.BackupKey;
		const ci = context.Campaigns.find((c) => c.Id === info.Id);
		if (!key || forceNewBackupKey) {
			key = crypto.randomUUID();
			campaign.BackupKey = key;
			if (ci) ci.BackupKey = key;
			await CampaignLoadingService.saveCampaign(campaign);
		} else if (ci && ci.BackupKey !== key) {
			ci.BackupKey = key;
		}

		// Refuse to upload a campaign whose binaries have gone missing locally.
		// The export silently omits images/terrain it cannot read, so the upload
		// would look healthy by its counts (which come from campaign metadata)
		// while carrying nothing -- overwriting the last backup that still has
		// them.
		//
		// `binariesChecked` carries the campaigns that just went through the
		// repair pass: anything still missing after that is missing from every
		// cloud revision too, so uploading cannot lose it.
		if (!binariesChecked?.has(campaign.Id)) {
			const missing = await CampaignUtils.findMissingBinaries(campaign);
			if (!hasNoMissingBinaries(missing)) {
				console.warn(
					`[CloudBackup] Skipping backup of "${campaign.Name}": ` +
						`${missing.imageIds.length} image(s) and ${missing.terrainIds.length} terrain(s) ` +
						`are missing locally. Not overwriting the cloud copy.`
				);
				return;
			}
		}

		// Re-read after the load: loadCampaignRaw may have run a schema migration
		// and saved, which bumps the counter. Stamping the pre-load value would
		// leave the cloud looking behind and re-upload the same payload next tick.
		const revision = campaignRevision(context, campaign.Id);
		const lastUpdated =
			lastUpdatedOf(context, campaign.Id) || campaign.CreatedAt;

		// Pin at most one revision a week (and always the first upload of a new
		// file). Everything in between rides Drive's free 30-day/100-version
		// window, which is the fine-grained recent history.
		const now = Date.now();
		const lastPinned = cloudMeta?.lastPinned ?? 0;
		const pinRevision = now - lastPinned > PIN_INTERVAL_MS;

		const exportData = await CampaignUtils.buildExportDataForCampaign(campaign);
		const json = JSON.stringify(exportData);
		const meta: BackupFileMeta = {
			backupKey: key,
			campaignName: campaign.Name,
			lastUpdated,
			revision,
			lastPinned: pinRevision ? now : lastPinned,
			version: exportData.version,
			counts: CampaignUtils.campaignCounts(campaign),
		};
		const fileId = await GoogleDriveBackupService.uploadBackup(
			json,
			meta,
			cloudMeta?.fileId,
			pinRevision
		);

		// Only once the upload has actually landed: this is what makes the next
		// run's "is there unbacked-up work?" test true after a failed upload.
		markCampaignBackedUp(campaign.Id, revision);

		// Only after a pin, so this runs about weekly rather than every backup.
		if (pinRevision) await this.prunePinnedRevisions(fileId);
	},

	/**
	 * Keeps the newest MAX_PINNED_REVISIONS pinned revisions and unpins the
	 * rest, handing them back to Drive's garbage collector. Without this the
	 * pinned trail grows forever -- pinned revisions are never auto-deleted and
	 * each one costs a full campaign payload.
	 */
	async prunePinnedRevisions(fileId: string): Promise<void> {
		try {
			const pinned = (
				await GoogleDriveBackupService.listRevisions(fileId)
			).filter((revision) => revision.keepForever);

			// listRevisions returns newest-first, so anything past the cap is old.
			for (const revision of pinned.slice(MAX_PINNED_REVISIONS)) {
				await GoogleDriveBackupService.unpinRevision(
					fileId,
					revision.revisionId
				);
			}
		} catch (e) {
			// Retention is housekeeping -- never fail a successful backup over it.
			console.error("[CloudBackup] Pruning pinned revisions failed:", e);
		}
	},

	/** Backs up every DM campaign whose local state is newer than the cloud. */
	async backupAllDmCampaigns(
		context: Context,
		backups?: DriveBackupMeta[],
		binariesChecked?: Set<string>
	): Promise<void> {
		await this.ensureSession();
		const cloud = backups ?? (await GoogleDriveBackupService.listBackups());
		const cloudByKey = new Map(cloud.map((b) => [b.backupKey, b]));

		// A BackupKey addresses exactly one Drive file. If two local campaigns claim
		// the same one, backing up both uploads two different campaigns over each
		// other -- and because `cloudByKey` is a snapshot taken before this loop,
		// the second would not even see the first's write to compare against.
		// (Reachable without doing anything odd: restoring a copy, or importing the
		// same export file twice, used to carry the archive's key across.)
		//
		// The first claimant keeps the file; every later one is re-keyed onto a file
		// of its own. Re-keying rather than skipping is deliberate: a skipped
		// campaign silently stops being backed up, and "silently stops" is the
		// failure this whole subsystem exists to prevent. Two campaigns genuinely
		// are two campaigns, so two files is the correct end state -- the only cost
		// is one extra file's worth of Drive storage.
		const seenKeys = new Set<string>();
		for (const info of this.dmCampaigns(context)) {
			const duplicate = !!info.BackupKey && seenKeys.has(info.BackupKey);
			if (duplicate) {
				console.warn(
					`[CloudBackup] "${info.Name}" shares a BackupKey with another local ` +
						`campaign; giving it a backup file of its own.`
				);
			}
			if (info.BackupKey && !duplicate) seenKeys.add(info.BackupKey);

			// A re-keyed campaign is starting a new file, so it has no cloud state
			// to compare against -- passing the old key's metadata would make it
			// look already-backed-up and skip the very upload it needs.
			const cloudMeta =
				info.BackupKey && !duplicate ? cloudByKey.get(info.BackupKey) : undefined;
			await this.backupCampaign(
				info,
				context,
				cloudMeta,
				binariesChecked,
				duplicate
			);
			if (duplicate && info.BackupKey) seenKeys.add(info.BackupKey);
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

	/**
	 * Restores a cloud backup with no local counterpart as a brand-new copy. This
	 * is the one copy-restore that keeps the archive's BackupKey: the campaign is
	 * absent locally, so no other local campaign can already be claiming it, and
	 * keeping it is what lets the copy keep tracking the same Drive file.
	 */
	async restoreCopy(
		backup: DriveBackupMeta,
		context: Context
	): Promise<CampaignInfo> {
		const data = await GoogleDriveBackupService.downloadBackup(backup.fileId);
		const info = await CampaignUtils.restoreFromExportData(data, context, {
			mode: "copy",
			keepBackupKey: true,
		});
		// Adopt the backup's identity wholesale (saveCampaign just stamped this as
		// a fresh local change), so a freshly-downloaded copy is neither re-uploaded
		// nor mistaken for something the cloud is ahead of.
		adoptCloudRevision(info.Id, backup.lastUpdated, backup.revision);
		return info;
	},

	/**
	 * Applies a newer cloud backup over an existing local campaign in place — the
	 * only destructive operation in the whole feature.
	 *
	 * Two things guard it. The local campaign is snapshotted first, so the
	 * overwrite is undoable; and the DOWNLOADED payload's real counts are measured
	 * and re-checked against the local ones, because the diff shown in the modal
	 * came from Drive metadata the uploading device wrote about itself. When the
	 * real payload turns out to shrink sharply and the user was not warned of it,
	 * this applies nothing and hands back the corrected diff to be re-confirmed.
	 */
	async restoreNewer(
		pending: PendingRestore,
		context: Context
	): Promise<{ applied: true } | { applied: false; diff: CampaignCountDiff }> {
		const data = await GoogleDriveBackupService.downloadBackup(
			pending.backup.fileId
		);
		const targetId = pending.local.Id;

		// Prefer the live copy: it holds anything the debounced persist has not
		// written yet, and that is precisely what is about to be overwritten. Falls
		// back to a raw read, which does not disturb the terrain payload buffer.
		const localCampaign =
			context.ActiveCampaign && context.ActiveCampaign.Id === targetId
				? context.ActiveCampaign
				: await CampaignLoadingService.loadCampaignRaw(targetId);
		if (localCampaign) {
			const incoming = CampaignUtils.countsFromExportData(data);
			if (incoming) {
				const verified = CampaignUtils.diffCounts(
					CampaignUtils.campaignCounts(localCampaign),
					incoming
				);
				if (verified.significantShrink && !pending.diff.significantShrink) {
					console.warn(
						`[CloudBackup] "${pending.backup.campaignName}" shrinks more than its ` +
							`Drive metadata advertised; re-confirming with measured counts.`
					);
					return { applied: false, diff: verified };
				}
			}
			// Hard requirement, not best-effort: without a way back, a restore that
			// turns out to be wrong is unrecoverable. Let this throw.
			await CampaignUtils.snapshotBeforeRestore(localCampaign);
		}

		await CampaignUtils.restoreFromExportData(data, context, {
			mode: "replace",
			targetCampaignId: targetId,
		});
		adoptCloudRevision(targetId, pending.backup.lastUpdated, pending.backup.revision);

		// If we just overwrote the live campaign, re-hydrate it from disk.
		if (context.ActiveCampaign && context.ActiveCampaign.Id === targetId) {
			const reloaded = await CampaignLoadingService.loadCampaign(targetId);
			if (reloaded) {
				contextStore.ActiveCampaign = reloaded;
				forceContextRerender();
			}
		}
		return { applied: true };
	},

	/**
	 * Fills in binaries (images, terrain voxels) that this device has lost --
	 * typically to browser storage eviction clearing IndexedDB/OPFS while
	 * localStorage kept the campaign itself.
	 *
	 * Walks the backup file's version history newest-first, taking each missing
	 * binary from the most recent revision that still carries it. Never touches
	 * the campaign object, and only ever writes binaries that are absent right
	 * now, so it cannot overwrite good data and needs no confirm. Hollow
	 * revisions cost almost nothing to skip -- being hollow is what makes them
	 * small. Returns what it actually recovered.
	 */
	async repairMissingBinaries(
		campaign: Campaign,
		backup: DriveBackupMeta
	): Promise<{ images: number; terrains: number }> {
		const totals = { images: 0, terrains: 0 };
		let missing = await CampaignUtils.findMissingBinaries(campaign);
		if (hasNoMissingBinaries(missing)) return totals;

		console.warn(
			`[CloudBackup] "${campaign.Name}" is missing ${missing.imageIds.length} image(s) ` +
				`and ${missing.terrainIds.length} terrain(s) locally; searching Drive history.`
		);

		const revisions = await GoogleDriveBackupService.listRevisions(
			backup.fileId
		);

		// The cap counts revisions actually DOWNLOADED, not ones looked at. Drive
		// eventually purges the content of unpinned revisions while still listing
		// them, and those 403 -- they must not eat the budget, or a run of purged
		// entries could stop the walk before it reaches the revision that still
		// has the data.
		let downloaded = 0;
		for (const revision of revisions) {
			if (hasNoMissingBinaries(missing)) break;
			if (downloaded >= MAX_REPAIR_REVISIONS) break;

			let data: unknown;
			try {
				data = await GoogleDriveBackupService.downloadBackup(
					backup.fileId,
					revision.revisionId
				);
				downloaded++;
			} catch (e) {
				// Expected for revisions Drive has already purged; keep walking.
				if (e instanceof Error && e.message.includes("cannotDownloadRevision")) {
					console.info(
						`[CloudBackup] Skipping purged revision from ${revision.modifiedTime}.`
					);
					continue;
				}
				console.error(
					`[CloudBackup] Repair failed against revision ${revision.revisionId}:`,
					e
				);
				continue;
			}

			try {
				const got = await CampaignUtils.repairBinariesFromExportData(
					campaign,
					data,
					missing
				);
				if (got.images || got.terrains) {
					totals.images += got.images;
					totals.terrains += got.terrains;
					missing = await CampaignUtils.findMissingBinaries(campaign);
					console.info(
						`[CloudBackup] Revision from ${revision.modifiedTime} supplied ` +
							`${got.images} image(s) and ${got.terrains} terrain(s).`
					);
				}
			} catch (e) {
				console.error(
					`[CloudBackup] Could not apply revision ${revision.revisionId}:`,
					e
				);
			}
		}

		if (!hasNoMissingBinaries(missing)) {
			console.warn(
				`[CloudBackup] ${missing.imageIds.length} image(s) and ${missing.terrainIds.length} ` +
					`terrain(s) were not in any readable backup revision (created after the last ` +
					`backup that had them, or their revision has been purged by Drive).`
			);
		}
		return totals;
	},

	/**
	 * The PREVIEW diff shown in the confirm modal. Cheap by design: the incoming
	 * counts come from Drive metadata, so no payload is downloaded to build it.
	 *
	 * That also makes it a claim rather than a measurement, and legacy backups
	 * carry no counts at all (empty diff). It is therefore never the last word --
	 * restoreNewer re-measures the real payload before applying anything.
	 */
	async computeShrinkDiff(
		backup: DriveBackupMeta,
		local: CampaignInfo
	): Promise<CampaignCountDiff> {
		const incoming = backup.counts;
		// Raw: this is a read-only preview and must not re-key the terrain buffer.
		const localCampaign = await CampaignLoadingService.loadCampaignRaw(local.Id);
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

		// 1) Silently restore backups that have no local counterpart -- except ones
		// the user deleted here. Drive files are never deleted, so without the
		// tombstone check a delete would silently undo itself on the next open.
		const tombstoned = new Set(context.DeletedBackupKeys ?? []);
		let restoredCount = 0;
		for (const b of backups) {
			if (localByKey.has(b.backupKey)) continue;
			if (tombstoned.has(b.backupKey)) continue;
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

		// 2) Collect backups the cloud is genuinely ahead on, for the confirm modal.
		// Deliberately NOT gated on being out of a campaign: most DMs open the app
		// straight on their campaign URL and never see the homepage, so gating on
		// that would silently retire cross-device restore for nearly everyone. The
		// prompt is a confirm the DM can decline, it names the campaign it would
		// overwrite (including when that is the live one), and the restore itself
		// snapshots the local copy first -- so informed consent is the guard here,
		// not absence.
		const newer: PendingRestore[] = [];
		for (const b of backups) {
			const local = localByKey.get(b.backupKey);
			if (!local) continue;
			if (!cloudIsAhead(revisionState(context, local.Id, b.revision))) continue;
			const diff = await this.computeShrinkDiff(b, local);
			newer.push({ backup: b, local, diff });
		}

		// 3) Self-heal binaries lost to storage eviction. Only the active campaign:
		// it is the one whose object survives an IndexedDB wipe (it rides in
		// localStorage during play), and it is the one the DM is looking at. For
		// any other campaign a wipe takes the campaign payload too, which is a
		// restore problem rather than a repair one.
		// ponytail: single campaign; widen if inactive-campaign loss shows up.
		const repaired = { images: 0, terrains: 0 };
		const binariesChecked = new Set<string>();
		const active = context.ActiveCampaign;
		const activeBackup = active?.BackupKey
			? backups.find((b) => b.backupKey === active.BackupKey)
			: undefined;
		if (active && activeBackup) {
			try {
				const got = await this.repairMissingBinaries(active, activeBackup);
				repaired.images += got.images;
				repaired.terrains += got.terrains;
				// Whether or not anything was recovered, we have now confirmed what
				// Drive still holds -- so step 4 may upload without risk of
				// clobbering binaries the cloud has and we don't.
				binariesChecked.add(active.Id);
				// Terrain voxels live outside the Valtio proxy (OPFS), so repaired
				// terrain needs an explicit nudge for map consumers to re-mesh.
				if (got.terrains > 0) forceContextRerender();
			} catch (e) {
				console.error("[CloudBackup] Binary repair failed:", e);
			}
		}

		// 4) Back up changed DM campaigns (guarded; won't clobber newer cloud).
		await this.backupAllDmCampaigns(context, backups, binariesChecked);

		return { restoredCount, newer, repaired };
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
