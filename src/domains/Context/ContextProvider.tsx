// domains/Context/ContextProvider.tsx
//
// Hosts the Valtio-backed global state (see contextStore.ts). The provider's job
// is now purely lifecycle:
//   1. load the persisted Context once and hydrate the proxy,
//   2. gate the tree until that load completes,
//   3. persist (debounced) + apply the theme whenever the proxy changes.
//
// State itself is a module singleton (`contextStore`), so reads/writes don't go
// through React context. Components READ via `useQuestContext()` (a Valtio
// snapshot, which gives per-field re-render granularity) and WRITE by mutating
// `contextStore` directly.

import { useEffect, useState, type ReactNode } from "react";
import { subscribe, useSnapshot } from "valtio";
import { Context } from "./Context";
import { ContextService } from "./ContextService";
import { contextStore, hydrateContextStore, renderTick } from "./contextStore";
import { AppSettingUtils } from "../AppSetting/AppSettingUtils";

// Trailing-debounce window for persisting the context to localStorage. Re-renders
// are immediate (Valtio); only the (potentially expensive) serialize + write is
// deferred so a burst of mutations collapses into a single write.
const PERSIST_DEBOUNCE_MS = 400;

function applyTheme(): void {
	document.documentElement.setAttribute(
		"data-theme",
		AppSettingUtils.getTheme(contextStore)
	);
}

export function ContextProvider({ children }: { children: ReactNode }) {
	const [ready, setReady] = useState(false);

	// Load the persisted context once and hydrate the proxy.
	useEffect(() => {
		let cancelled = false;

		(async () => {
			const loaded =
				(await ContextService.load()) ?? ContextService.create();
			if (cancelled) return;
			hydrateContextStore(loaded);
			applyTheme();
			setReady(true);
		})().catch((error) => {
			console.error("[Context] Failed to load context:", error);
			if (cancelled) return;
			hydrateContextStore(ContextService.create());
			applyTheme();
			setReady(true);
		});

		return () => {
			cancelled = true;
		};
	}, []);

	// Persist (debounced) and re-apply the theme on any proxy change. Module-level
	// `subscribe` does NOT re-render this provider, so children keep their
	// per-field Valtio granularity. Presence changes never reach here — they live
	// in a separate, non-persisted store.
	useEffect(() => {
		if (!ready) return;

		let persistTimer: ReturnType<typeof setTimeout> | null = null;

		const flushNow = () => {
			if (persistTimer) {
				clearTimeout(persistTimer);
				persistTimer = null;
			}
			// Synchronous full save (voxels inline) so a crash/close can never drop
			// the active terrain — the next load migrates it back into IndexedDB.
			ContextService.save(contextStore);
		};

		const unsubscribe = subscribe(contextStore, () => {
			applyTheme();
			if (persistTimer) clearTimeout(persistTimer);
			persistTimer = setTimeout(() => {
				persistTimer = null;
				void ContextService.flush(contextStore).catch((e) =>
					console.error("[Context] Failed to flush context:", e)
				);
			}, PERSIST_DEBOUNCE_MS);
		});

		window.addEventListener("beforeunload", flushNow);

		return () => {
			unsubscribe();
			window.removeEventListener("beforeunload", flushNow);
			flushNow();
		};
	}, [ready]);

	if (!ready) {
		return <div>Loading...</div>;
	}

	return <>{children}</>;
}

/**
 * Reactive read of the global context. Returns a Valtio snapshot: reading a
 * field here subscribes the calling component to that field, so it re-renders
 * only when something it actually read changes.
 *
 * The snapshot is deeply READONLY at runtime (frozen). To change state, mutate
 * `contextStore` (imported from ./contextStore), never the value returned here.
 * The cast preserves the historical `Context` call-site ergonomics across the
 * ~70 read-only consumers.
 */
export function useQuestContext(): Context {
	// Subscribe to the side-channel render signal (terrain voxel payloads and
	// other out-of-proxy data). Normal state changes re-render via the snapshot's
	// per-field tracking below; this covers the rare changes Valtio can't see.
	void useSnapshot(renderTick).tick;
	return useSnapshot(contextStore) as unknown as Context;
}
