// components/CloudBackupManager.tsx
//
// Mounted once at the app root (App.tsx), mirroring StorageQuotaErrorOverlay.
// On mount it runs the on-open cloud sync (silent restore + auto-backup) for a
// returning, already-connected user, then renders the "Restore from Google
// Drive backup?" confirm modal for backups that are newer than the local copy.
//
// It also owns the two notices that must reach a DM WHEREVER they are: "your
// last backup failed" and "we recovered things from your backup". Those used to
// live only in CloudBackupBanner, which renders on the homepage -- but most DMs
// open the app straight on their campaign URL and never see it, so a broken
// backup could go unnoticed indefinitely. The banner keeps the homepage-only
// concerns (the invitation to log in, and the healthy logged-in pill).

import { useEffect, useState } from "react";
import { useSnapshot } from "valtio";
import { Modal } from "./ui/Modal";
import { useQuestContext } from "../domains/Context/ContextProvider";
import { AppSettingUtils } from "../domains/AppSetting/AppSettingUtils";
import {
	CloudBackupService,
	type PendingRestore,
} from "../services/CloudBackupService";
import {
	cloudBackupUi,
	confirmFirstRestore,
	dismissToast,
	loginAndSync,
	runCloudSyncOnce,
	runPeriodicBackup,
	skipFirstRestore,
} from "./cloudBackupUi";

// How often to back up while the app stays open. The sync on mount only ever
// captured the state the PREVIOUS session left behind, so a DM who keeps the
// tab open for days was never backed up mid-work.
const BACKUP_INTERVAL_MS = 60 * 60 * 1000;

function RestoreBody({
	pending,
	error,
	isLive,
}: {
	pending: PendingRestore;
	error: string | null;
	isLive: boolean;
}) {
	const { backup, diff } = pending;
	const shrinks = diff.changes.filter((c) => c.after < c.before);

	return (
		<div className="space-y-3 text-sm">
			<p>
				A more recent backup of <strong>{backup.campaignName}</strong> was found
				in your Google Drive.
			</p>
			{isLive && (
				<p className="flex items-start gap-2 text-warning">
					<span className="icon-[mdi--account-group] w-5 h-5 shrink-0" />
					This is the campaign you have open. Restoring replaces it now, and any
					connected players will be re-synced to the restored state.
				</p>
			)}
			{diff.significantShrink && (
				<>
					<p className="flex items-center gap-2 text-warning">
						<span className="icon-[mdi--alert] w-5 h-5 shrink-0" />
						This backup has noticeably less than your current copy:
					</p>
					<ul className="font-mono text-xs bg-base-200 rounded p-2 space-y-1">
						{shrinks.map((c) => (
							<li key={c.label}>
								{c.label}: {c.before} → {c.after}
							</li>
						))}
					</ul>
					<p>Continue to restore backup?</p>
				</>
			)}
			<p className="opacity-70">
				Your current copy is saved first, so this can be undone.
			</p>
			{error && (
				<p className="flex items-start gap-2 text-error">
					<span className="icon-[mdi--alert-circle] w-5 h-5 shrink-0" />
					{error}
				</p>
			)}
		</div>
	);
}

/**
 * "Your last backup didn't succeed", visible on every route. Deliberately a
 * small pill rather than an alert: it should be impossible to miss and still not
 * alarming, matching the banner's tone.
 */
function BackupFailedPill() {
	const context = useQuestContext();
	const [busy, setBusy] = useState(false);

	const state = AppSettingUtils.getCloudBackup(context);
	if (state?.connected !== true) return null;
	if (!state.lastStatus || state.lastStatus.ok) return null;

	const retry = async () => {
		setBusy(true);
		try {
			await loginAndSync();
		} catch {
			// Failure just leaves the pill up; lastStatus already carries the reason.
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 max-w-[92vw]">
			<div className="flex items-center gap-2 rounded-full bg-warning/90 text-warning-content px-3 py-1.5 shadow-md">
				<span className="icon-[mdi--cloud-alert] w-4 h-4 shrink-0" />
				<span className="text-sm">Last backup didn't succeed</span>
				<button
					type="button"
					className="btn btn-ghost btn-xs shrink-0"
					disabled={busy}
					onClick={() => void retry()}
				>
					{busy ? (
						<span className="loading loading-spinner loading-xs" />
					) : (
						"Retry"
					)}
				</button>
			</div>
		</div>
	);
}

/** Transient "restored / recovered N things" notice, visible on every route. */
function BackupToast({ message }: { message: string }) {
	return (
		<div className="fixed bottom-3 left-1/2 -translate-x-1/2 z-40 max-w-[92vw]">
			<div className="badge badge-success gap-1 shadow-md max-w-full">
				<span className="icon-[mdi--cloud-check] w-3.5 h-3.5 shrink-0" />
				<span className="text-xs truncate">{message}</span>
			</div>
		</div>
	);
}

export function CloudBackupManager() {
	const ui = useSnapshot(cloudBackupUi);
	const context = useQuestContext();

	// Run the once-per-session sync for returning, already-connected users.
	useEffect(() => {
		void runCloudSyncOnce();
	}, []);

	// Keep backing up while the tab stays open.
	useEffect(() => {
		const timer = setInterval(() => void runPeriodicBackup(), BACKUP_INTERVAL_MS);
		return () => clearInterval(timer);
	}, []);

	// ...and once more on the way out, so work done since the last tick isn't
	// stranded when the DM closes the laptop. Fire-and-forget: unload can't be
	// blocked, but "hidden" fires well before the tab actually goes away.
	useEffect(() => {
		const onHide = () => {
			if (document.visibilityState === "hidden") void runPeriodicBackup();
		};
		document.addEventListener("visibilitychange", onHide);
		return () => document.removeEventListener("visibilitychange", onHide);
	}, []);

	// Auto-dismiss the restore/recovery notice.
	useEffect(() => {
		if (!ui.toast) return;
		const t = setTimeout(dismissToast, 5000);
		return () => clearTimeout(t);
	}, [ui.toast]);

	// Hidden entirely when the feature isn't configured for this build.
	if (!CloudBackupService.isConfigured()) return null;

	const pending = ui.queue[0] as PendingRestore | undefined;
	// When the incoming backup is sharply smaller, the safe choice becomes the
	// emphasized one. Restoring is the irreversible direction; it should not be
	// the button the eye lands on and the enter key hits.
	const risky = pending?.diff.significantShrink === true;
	// The prompt is no longer withheld while a campaign is open (most DMs never
	// leave one), so it has to say plainly when the campaign it would overwrite is
	// the one on screen.
	const isLive =
		!!pending && context.ActiveCampaign?.Id === pending.local.Id;

	return (
		<>
			{pending && (
				<Modal
					title={
						<span className="flex items-center gap-2">
							<span className="icon-[mdi--cloud-download] w-6 h-6 shrink-0" />
							Restore from Google Drive backup?
						</span>
					}
					actions={
						<>
							<button
								type="button"
								className={risky ? "btn btn-primary" : "btn btn-ghost"}
								disabled={ui.busy}
								onClick={skipFirstRestore}
							>
								{risky ? "Keep my copy" : "Not now"}
							</button>
							<button
								type="button"
								className={risky ? "btn btn-ghost text-warning" : "btn btn-primary"}
								disabled={ui.busy}
								onClick={() => void confirmFirstRestore()}
							>
								{ui.busy ? (
									<span className="loading loading-spinner loading-sm" />
								) : risky ? (
									"Restore anyway"
								) : (
									"Restore"
								)}
							</button>
						</>
					}
				>
					<RestoreBody pending={pending} error={ui.error} isLive={isLive} />
				</Modal>
			)}
			{ui.toast ? <BackupToast message={ui.toast} /> : <BackupFailedPill />}
		</>
	);
}
