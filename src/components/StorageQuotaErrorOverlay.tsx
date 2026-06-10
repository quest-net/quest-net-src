// components/StorageQuotaErrorOverlay.tsx

import { useEffect, useState } from "react";
import { onStorageQuotaExceeded } from "../utils/LocalStorageUtilities";
import { Modal } from "./ui/Modal";

const DEVELOPER_EMAIL = "samy.guimez@gmail.com";

/**
 * Listens for localStorage-quota-exceeded events and shows a blocking, friendly
 * error dialog instead of letting the failed write crash the page.
 *
 * Browser localStorage caps out around 5 MB. Voxel terrains are SVO-encoded and
 * offloaded to IndexedDB, so reaching the cap is extremely unlikely, but enough
 * templates/items/terrains could theoretically push the Context over it. When
 * that happens we can no longer persist changes, so we tell the user plainly and
 * point them at the developer rather than silently losing data or white-screening.
 *
 * Mounted once at the app root (App.tsx). The dialog dedupes itself: once shown,
 * further quota events are ignored until the user dismisses it.
 */
export function StorageQuotaErrorOverlay() {
	const [visible, setVisible] = useState(false);

	useEffect(() => {
		// A wedged-full store fires on every subsequent save attempt; setting
		// the flag true when it's already true is a no-op, so this naturally
		// dedupes without restacking dialogs.
		return onStorageQuotaExceeded(() => setVisible(true));
	}, []);

	if (!visible) return null;

	// No onClose: the dialog must be dismissed through the explicit button so
	// the user actually reads it.
	return (
		<Modal
			title={
				<span className="flex items-center gap-2 text-error">
					<span className="icon-[mdi--database-alert] w-6 h-6 shrink-0" />
					Storage limit reached
				</span>
			}
			actions={
				<button
					type="button"
					onClick={() => setVisible(false)}
					className="btn btn-primary"
				>
					Dismiss
				</button>
			}
		>
			<div className="space-y-3 text-sm">
					<p>
						This campaign has grown too large to be saved in your browser's
						local storage. Your most recent changes could not be saved.
					</p>
					<p>
						This is rare and unexpected. To avoid losing work,{" "}
						<strong>
							please avoid creating more content and reach out to the
							developer
						</strong>{" "}
						so the problem can be investigated:
					</p>
					<div className="alert">
						<span className="icon-[mdi--email-outline] w-5 h-5 shrink-0" />
						<a
							href={`mailto:${DEVELOPER_EMAIL}?subject=Quest-Net%20storage%20limit%20reached`}
							className="link link-primary font-mono"
						>
							{DEVELOPER_EMAIL}
						</a>
					</div>
			</div>
		</Modal>
	);
}
