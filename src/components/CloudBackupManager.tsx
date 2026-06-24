// components/CloudBackupManager.tsx
//
// Mounted once at the app root (App.tsx), mirroring StorageQuotaErrorOverlay.
// On mount it runs the on-open cloud sync (silent restore + auto-backup) for a
// returning, already-connected user, then renders the "Restore from Google
// Drive backup?" confirm modal for backups that are newer than the local copy.
// The "restored N campaigns" notice is surfaced by CloudBackupBanner (so it sits
// with the logged-in status); this component only times it out.

import { useEffect } from "react";
import { useSnapshot } from "valtio";
import { Modal } from "./ui/Modal";
import type { PendingRestore } from "../services/CloudBackupService";
import {
	cloudBackupUi,
	confirmFirstRestore,
	dismissToast,
	runCloudSyncOnce,
	skipFirstRestore,
} from "./cloudBackupUi";

function RestoreBody({ pending }: { pending: PendingRestore }) {
	const { backup, diff } = pending;
	const shrinks = diff.changes.filter((c) => c.after < c.before);

	return (
		<div className="space-y-3 text-sm">
			<p>
				A more recent backup of <strong>{backup.campaignName}</strong> was found
				in your Google Drive.
			</p>
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
		</div>
	);
}

export function CloudBackupManager() {
	const ui = useSnapshot(cloudBackupUi);

	// Run the once-per-session sync for returning, already-connected users.
	useEffect(() => {
		void runCloudSyncOnce();
	}, []);

	// Auto-dismiss the restore notice (rendered by CloudBackupBanner).
	useEffect(() => {
		if (!ui.toast) return;
		const t = setTimeout(dismissToast, 5000);
		return () => clearTimeout(t);
	}, [ui.toast]);

	const pending = ui.queue[0] as PendingRestore | undefined;

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
								className="btn btn-ghost"
								disabled={ui.busy}
								onClick={skipFirstRestore}
							>
								Not now
							</button>
							<button
								type="button"
								className="btn btn-primary"
								disabled={ui.busy}
								onClick={() => void confirmFirstRestore()}
							>
								{ui.busy ? (
									<span className="loading loading-spinner loading-sm" />
								) : (
									"Restore"
								)}
							</button>
						</>
					}
				>
					<RestoreBody pending={pending} />
				</Modal>
			)}
		</>
	);
}
