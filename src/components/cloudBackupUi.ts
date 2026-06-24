// components/cloudBackupUi.ts
//
// Small shared store + thin actions that connect the cloud-backup UI (homepage
// banner + global manager) to CloudBackupService. Both the returning-user path
// (manager runs once on mount) and the interactive path (banner "Log in") funnel
// their sync results here, so the toast + restore modal render from one place.

import { proxy } from "valtio";
import { contextStore } from "../domains/Context/contextStore";
import {
	CloudBackupService,
	type PendingRestore,
	type SyncResult,
} from "../services/CloudBackupService";

export const cloudBackupUi = proxy<{
	toast: string | null;
	/** Newer-than-local backups awaiting a confirm, shown one at a time. */
	queue: PendingRestore[];
	busy: boolean;
}>({ toast: null, queue: [], busy: false });

// Once-per-app-open guard. Survives StrictMode remounts (module scope) but is
// reset when the user disconnects so a later reconnect re-syncs.
let didSync = false;

function applyResult(result: SyncResult | null): void {
	if (!result) return;
	if (result.restoredCount > 0) {
		cloudBackupUi.toast = `Restored ${result.restoredCount} campaign${
			result.restoredCount > 1 ? "s" : ""
		} from Google Drive`;
	}
	if (result.newer.length > 0) {
		cloudBackupUi.queue.push(...result.newer);
	}
}

/** Returning-user path: sync once per session if already connected. */
export async function runCloudSyncOnce(): Promise<void> {
	if (didSync) return;
	if (
		!CloudBackupService.isConfigured() ||
		!CloudBackupService.isConnected(contextStore)
	) {
		return;
	}
	didSync = true;
	applyResult(await CloudBackupService.runOnOpen(contextStore));
}

/** Interactive "Log in to Google" / "Retry" path: connect, then sync. */
export async function loginAndSync(): Promise<void> {
	// Connect first; if the user cancels the popup this throws and `didSync`
	// stays unlatched so a later attempt still runs.
	const result = await CloudBackupService.connectAndSync(contextStore);
	didSync = true;
	applyResult(result);
}

export function disconnect(): void {
	CloudBackupService.disconnect();
	didSync = false;
	cloudBackupUi.queue = [];
	cloudBackupUi.toast = null;
}

export function dismissToast(): void {
	cloudBackupUi.toast = null;
}

/** Applies the first queued restore (update-in-place) and dequeues it. */
export async function confirmFirstRestore(): Promise<void> {
	const pending = cloudBackupUi.queue[0];
	if (!pending) return;
	cloudBackupUi.busy = true;
	try {
		await CloudBackupService.restoreNewer(pending, contextStore);
	} catch (e) {
		console.error("[CloudBackup] Restore failed:", e);
	} finally {
		cloudBackupUi.busy = false;
		cloudBackupUi.queue.shift();
	}
}

export function skipFirstRestore(): void {
	cloudBackupUi.queue.shift();
}
