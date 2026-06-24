// components/CloudBackupBanner.tsx
//
// Slim homepage banner — the only proactive cloud-backup surface. Three states:
//   - not connected  -> invite to log in
//   - connected, ok  -> quiet "logged in as <email>"
//   - connected, err -> "last backup didn't succeed" + retry
// Deliberately low on detail so it never makes a DM anxious.

import { useState } from "react";
import { useSnapshot } from "valtio";
import { useQuestContext } from "../domains/Context/ContextProvider";
import { AppSettingUtils } from "../domains/AppSetting/AppSettingUtils";
import { CloudBackupService } from "../services/CloudBackupService";
import { cloudBackupUi, disconnect, loginAndSync } from "./cloudBackupUi";

export function CloudBackupBanner() {
	const context = useQuestContext();
	const ui = useSnapshot(cloudBackupUi);
	const [busy, setBusy] = useState(false);
	const [localError, setLocalError] = useState(false);

	// Hidden entirely when the feature isn't configured for this build.
	if (!CloudBackupService.isConfigured()) return null;

	const state = AppSettingUtils.getCloudBackup(context);
	const connected = state?.connected === true;
	const failed = connected && state?.lastStatus && !state.lastStatus.ok;

	const handleConnect = async () => {
		setBusy(true);
		setLocalError(false);
		try {
			await loginAndSync();
		} catch {
			setLocalError(true);
		} finally {
			setBusy(false);
		}
	};

	// Quiet, connected + healthy: a small muted pill with a logout affordance.
	// The transient "Restored N campaigns" notice (set on the once-per-open sync)
	// rides along here rather than as a separate toast.
	if (connected && !failed) {
		return (
			<div className="fixed top-16 sm:top-3 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1 max-w-[92vw]">
				<div className="flex items-center gap-2 rounded-full bg-base-100/90 border border-base-300 px-3 py-1.5 shadow-sm max-w-full">
					<span className="icon-[mdi--cloud-check] w-4 h-4 text-success shrink-0" />
					<span className="text-sm opacity-80 truncate">
						{state?.email ? `Logged in as ${state.email}` : "Backup on"}
					</span>
					<button
						type="button"
						className="btn btn-ghost btn-xs gap-1 shrink-0"
						onClick={disconnect}
						title="Log out of Google Drive"
					>
						<span className="icon-[mdi--logout] w-3.5 h-3.5" />
						Log out
					</button>
				</div>
				{ui.toast && (
					<div className="badge badge-success gap-1 shadow-sm max-w-full">
						<span className="icon-[mdi--cloud-check] w-3.5 h-3.5 shrink-0" />
						<span className="text-xs truncate">{ui.toast}</span>
					</div>
				)}
			</div>
		);
	}

	return (
		<div className="fixed top-16 md:top-3 left-1/2 -translate-x-1/2 z-40 w-max max-w-[92vw]">
			<div
				className={`alert ${
					failed ? "alert-warning" : ""
				} flex flex-wrap items-center justify-center gap-3 py-2 px-4 shadow-md`}
			>
				<span
					className={`${
						failed ? "icon-[mdi--cloud-alert]" : "icon-[mdi--cloud-outline]"
					} w-5 h-5 shrink-0`}
				/>
				<span className="text-sm">
					{failed
						? "Last backup didn't succeed"
						: "Keep your campaigns saved across devices"}
				</span>
				<button
					type="button"
					className="btn btn-sm btn-primary gap-1"
					disabled={busy}
					onClick={handleConnect}
				>
					{busy ? (
						<span className="loading loading-spinner loading-xs" />
					) : (
						<span className="icon-[mdi--google] w-4 h-4" />
					)}
					{failed ? "Retry" : "Log in to Google"}
				</button>
			</div>
			{localError && (
				<p className="text-error text-xs mt-1 text-center">
					Couldn't connect to Google Drive. Please try again.
				</p>
			)}
		</div>
	);
}
