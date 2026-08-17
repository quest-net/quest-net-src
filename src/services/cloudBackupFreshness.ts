// services/cloudBackupFreshness.ts
//
// The rules that decide whether a campaign gets uploaded, and whether a Drive
// backup may be offered as a replacement for the local copy. Deliberately pure
// and import-free: this is the one place in the backup system where a wrong
// answer silently destroys work, so it stays small enough to reason about and
// runnable on its own (see scripts/check-cloud-backup-freshness.mjs).
//
// Everything here is expressed in REVISIONS -- monotonic per-campaign mutation
// counters recorded locally -- and never in wall-clock time. Freshness used to
// be a timestamp comparison, which meant a single device with a skewed clock
// could stamp a future time onto a Drive file and thereby (a) stop every device,
// itself included, from ever uploading that campaign again, and (b) present its
// stale copy to other devices as "more recent" and invite them to restore it
// over good work.

export interface BackupRevisionState {
	/** This device's mutation counter for the campaign. */
	local: number;
	/**
	 * The counter value at this device's last successful upload of the campaign,
	 * or undefined if it has never uploaded it.
	 */
	backedUp: number | undefined;
	/** The counter stamped on the Drive file; 0 means "never stamped". */
	cloud: number;
}

/**
 * Whether this device is holding work the cloud does not have.
 *
 * Both operands are written by this device, so the test is exact regardless of
 * what any clock anywhere says. `backedUp === undefined` (never uploaded) is
 * correctly unequal to any local counter, so a fresh campaign always uploads.
 */
export function hasUnbackedUpChanges(state: BackupRevisionState): boolean {
	return state.local !== state.backedUp;
}

/**
 * Whether the Drive backup is genuinely ahead of the local copy — the sole
 * condition under which the destructive update-in-place restore may be offered.
 *
 * Two devices' counters are independent counts, so equal numbers do NOT imply
 * equal content and a bare `cloud > local` would be meaningless. The comparison
 * is only made against this device's own last upload, which is the one value
 * both sides provably agreed on:
 *
 *  - never uploaded from here -> no shared reference point -> never offer;
 *  - unpushed local work -> never offer, or we would propose discarding it;
 *  - otherwise the cloud is ahead exactly when it has moved since that upload.
 */
export function cloudIsAhead(state: BackupRevisionState): boolean {
	if (state.backedUp === undefined) return false;
	if (state.local !== state.backedUp) return false;
	return state.cloud !== state.backedUp;
}
