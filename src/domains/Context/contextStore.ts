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
import type { Context } from "./Context";
import type { User } from "../User/User";
import { APP_VERSION } from "../../version";

// Inert placeholder so the proxy has a valid shape from module load. It is never
// observed by components: ContextProvider gates the tree on a `ready` flag and
// only renders children after `hydrateContextStore()` has run.
const PLACEHOLDER_USER: User = {
	Id: "",
	Name: "",
	Role: undefined,
	SelectedCharacters: {},
};

export const contextStore = proxy<Context>({
	User: PLACEHOLDER_USER,
	Campaigns: [],
	ActiveCampaign: null,
	AppSettings: {},
	version: APP_VERSION,
	SecretModes: {},
	ViewedTerrains: {},
	LastUpdated: {},
	ProfileUpdated: 0,
});

/**
 * Copies a freshly loaded Context into the live proxy field-by-field, so the
 * proxy's identity stays stable for the app's lifetime. ActionService and other
 * long-lived holders capture `contextStore` once; we must never replace it
 * wholesale, only mutate its fields.
 */
export function hydrateContextStore(loaded: Context): void {
	contextStore.User = loaded.User;
	contextStore.Campaigns = loaded.Campaigns;
	contextStore.ActiveCampaign = loaded.ActiveCampaign;
	contextStore.AppSettings = loaded.AppSettings;
	contextStore.version = loaded.version;
	contextStore.SecretModes = loaded.SecretModes ?? {};
	contextStore.ViewedTerrains = loaded.ViewedTerrains ?? {};
	contextStore.LastUpdated = loaded.LastUpdated ?? {};
	contextStore.ProfileUpdated = loaded.ProfileUpdated ?? 0;
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
