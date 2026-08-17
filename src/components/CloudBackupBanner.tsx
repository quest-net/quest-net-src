// components/CloudBackupBanner.tsx
//
// Slim homepage banner. Two states:
//   - not connected  -> invite to log in
//   - connected      -> quiet "logged in as <email>" + log out
// Deliberately low on detail so it never makes a DM anxious.
//
// Failures and recovery notices are NOT shown here: they belong on every route,
// because most DMs open the app straight on their campaign URL and would never
// see a homepage-only warning that their backups had stopped working.
// CloudBackupManager (app root) owns those.

import { useState } from "react";
import { useQuestContext } from "../domains/Context/ContextProvider";
import { AppSettingUtils } from "../domains/AppSetting/AppSettingUtils";
import { CloudBackupService } from "../services/CloudBackupService";
import { disconnect, loginAndSync } from "./cloudBackupUi";

export function CloudBackupBanner() {
	const context = useQuestContext();
	const [busy, setBusy] = useState(false);
	const [localError, setLocalError] = useState(false);

	// Hidden entirely when the feature isn't configured for this build.
	if (!CloudBackupService.isConfigured()) return null;

	const state = AppSettingUtils.getCloudBackup(context);
	const connected = state?.connected === true;

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

	// Quiet, connected: a small muted pill with a logout affordance.
	if (connected) {
		return (
			<div className="fixed top-16 sm:top-3 left-1/2 -translate-x-1/2 z-40 flex flex-col items-center gap-1 max-w-[92vw]">
				<div className="flex items-center gap-2 rounded-full bg-base-100/90 border border-base-300 px-3 py-1.5 shadow-sm max-w-full">
					<span className="icon-[mdi--cloud-check] w-4 h-4 text-success shrink-0" />
					<span className="text-sm opacity-80 truncate" title={state?.email}>
						{context.User.Name
							? `You are logged in as ${context.User.Name}`
							: "Backup on"}
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
			</div>
		);
	}

	return (
		<div className="fixed top-16 md:top-3 left-1/2 -translate-x-1/2 z-40 w-max max-w-[92vw]">
			<div className="alert flex flex-wrap items-center justify-center gap-3 py-2 px-4 shadow-md">
				<span className="icon-[mdi--cloud-outline] w-5 h-5 shrink-0" />
				<span className="text-sm">Keep your campaigns saved across devices</span>
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
					Log in to Google
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
