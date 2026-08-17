// domains/Context/contextStore.ts
//
// The single source of truth for global app state, backed by a Valtio proxy.
//
// MUTATION RULE: write to `contextStore` (or any object reached through it);
// never write to the readonly value returned by `useSnapshot`/`useQuestContext`.
// Reads in render go through the snapshot; writes go through this proxy.
//
// CLONE BOUNDARIES: the structured clone algorithm (Worker.postMessage,
// structuredClone(), IndexedDB writes) throws DataCloneError on a Proxy. Both
// this store proxy and useQuestContext()'s tracking proxy are Proxies, so run
// campaign/terrain data through `toPlain()` (src/utils/toPlain.ts) before it
// crosses any of those boundaries. JSON paths (Trystero, JSON.stringify) read
// through proxies and need no conversion.

import { proxy } from "valtio";
import { createDefaultContext, withContextDefaults, type Context } from "./Context";
import type { User } from "../User/User";

// Inert placeholder so the proxy has a valid shape from module load. It is never
// observed by components: ContextProvider gates the tree on a `ready` flag and
// only renders children after `hydrateContextStore()` has run.
const PLACEHOLDER_USER: User = {
	Id: "",
	Name: "",
	Role: undefined,
	SelectedCharacters: {},
};

export const contextStore = proxy<Context>(
	createDefaultContext(PLACEHOLDER_USER)
);

/**
 * Copies a freshly loaded Context into the live proxy field-by-field, so the
 * proxy's identity stays stable for the app's lifetime. ActionService and other
 * long-lived holders capture `contextStore` once; we must never replace it
 * wholesale, only mutate its fields.
 */
export function hydrateContextStore(loaded: Context): void {
	const full = withContextDefaults(loaded);
	const target = contextStore as unknown as Record<string, unknown>;
	for (const key of Object.keys(full) as (keyof Context)[]) {
		target[key] = full[key];
	}
	// Runtime-only flag; never restored from a loaded context.
	delete contextStore.IsOptimistic;
}

/**
 * Records that a campaign's local state just changed, for cloud-backup freshness
 * and campaign-list ordering. Local-only (never broadcast); mirrors SecretModes.
 * Pass an explicit timestamp to match an external source (e.g. when restoring a
 * cloud backup, stamp the backup's own time so we don't immediately re-upload);
 * otherwise defaults to now.
 */
export function markCampaignUpdated(
	campaignId: string,
	when: number = Date.now()
): void {
	if (!contextStore.LastUpdated) contextStore.LastUpdated = {};
	contextStore.LastUpdated[campaignId] = when;
	// The timestamp above is for display/ordering only. This counter is what
	// cloud backup actually compares, precisely because it cannot be wrong the
	// way a clock can.
	if (!contextStore.Revisions) contextStore.Revisions = {};
	contextStore.Revisions[campaignId] = (contextStore.Revisions[campaignId] ?? 0) + 1;
}

/** This campaign's local mutation counter (0 when never recorded). */
export function campaignRevision(context: Context, campaignId: string): number {
	return context.Revisions?.[campaignId] ?? 0;
}

/**
 * The revision this device last successfully uploaded for a campaign, or
 * undefined when it has never uploaded it. Undefined is meaningful: revision
 * counters from two devices that have never exchanged a backup are not
 * comparable, so callers must not offer a restore until this is set.
 */
export function backedUpRevision(
	context: Context,
	campaignId: string
): number | undefined {
	return context.BackedUpRevisions?.[campaignId];
}

/** Records that `revision` of this campaign is now safely in the cloud. */
export function markCampaignBackedUp(campaignId: string, revision: number): void {
	if (!contextStore.BackedUpRevisions) contextStore.BackedUpRevisions = {};
	contextStore.BackedUpRevisions[campaignId] = revision;
}

/**
 * Adopts a cloud backup's identity after restoring it: the campaign is now
 * byte-for-byte what the cloud holds, so both counters match the backup's own
 * revision and nothing is re-uploaded or re-offered.
 */
export function adoptCloudRevision(
	campaignId: string,
	when: number,
	revision: number
): void {
	if (!contextStore.LastUpdated) contextStore.LastUpdated = {};
	contextStore.LastUpdated[campaignId] = when;
	if (!contextStore.Revisions) contextStore.Revisions = {};
	contextStore.Revisions[campaignId] = revision;
	markCampaignBackedUp(campaignId, revision);
}

/** Forgets every backup-tracking record for a campaign (used on delete). */
export function clearCampaignBackupState(campaignId: string): void {
	delete contextStore.LastUpdated?.[campaignId];
	delete contextStore.Revisions?.[campaignId];
	delete contextStore.BackedUpRevisions?.[campaignId];
}

/**
 * Tombstones a deleted campaign's BackupKey so the on-open sync stops treating
 * its (never-deleted) Drive file as a campaign this device is missing. Restoring
 * the campaign on purpose clears the tombstone again.
 */
export function tombstoneBackupKey(backupKey: string): void {
	if (!contextStore.DeletedBackupKeys) contextStore.DeletedBackupKeys = [];
	if (!contextStore.DeletedBackupKeys.includes(backupKey)) {
		contextStore.DeletedBackupKeys.push(backupKey);
	}
}

export function clearBackupKeyTombstone(backupKey: string): void {
	const keys = contextStore.DeletedBackupKeys;
	if (!keys) return;
	const index = keys.indexOf(backupKey);
	if (index !== -1) keys.splice(index, 1);
}

/**
 * Records that the synced account profile (User.Name + allowlisted AppSettings)
 * just changed locally, for the cloud profile.json last-write-wins comparison.
 * Local-only. Pass an explicit timestamp to match an external source (e.g. when
 * adopting a cloud profile, stamp the cloud's own time so we don't immediately
 * re-upload); otherwise defaults to now.
 */
export function markProfileUpdated(when: number = Date.now()): void {
	contextStore.ProfileUpdated = when;
}

// ---------------------------------------------------------------------------
// Presence store
//
// Peer presence (connected ids, peer Users, pings) is owned by the live
// ActionService instance, not by Context -- it is transient and must never be
// persisted. It lives in its own proxy so presence churn (a ping every few
// seconds) re-renders only the components that watch it, and never touches the
// persisted context store. ActionService bumps `version` on any presence change;
// `usePeerTracking` subscribes to it and reads the actual data off ActionService.
// ---------------------------------------------------------------------------

export const presenceStore = proxy<{ version: number }>({ version: 0 });

/** Signals that peer presence/ping data changed so watchers re-render. */
export function bumpPresence(): void {
	presenceStore.version++;
}

// ---------------------------------------------------------------------------
// Side-channel render signal
//
// Some state the UI renders does NOT live in the context proxy and therefore
// can't drive Valtio on its own — notably terrain voxel payloads, which live in
// TerrainPayloadStore / IndexedDB (only a stub sits on the campaign). When such
// a payload changes (terrain hydrated on load, or a delta applied), bumping this
// re-renders every `useQuestContext` consumer so the map re-meshes. It is the
// honest, narrow replacement for the old global triggerContextUpdate(); these
// events are rare, so a broad re-render is acceptable.
// ---------------------------------------------------------------------------

export const renderTick = proxy<{ tick: number }>({ tick: 0 });

/** Forces a re-render of all context consumers for out-of-proxy data changes. */
export function forceContextRerender(): void {
	renderTick.tick++;
}
