// utils/toPlain.ts
//
// Converts a value that may be backed by a Valtio proxy into a plain,
// structured-clone-safe equivalent.
//
// WHY: the HTML structured clone algorithm — used by Worker.postMessage(),
// structuredClone(), and IndexedDB writes — throws DataCloneError on ANY Proxy.
// Both the Valtio store proxy (contextStore) and the useSnapshot() tracking
// proxy returned by useQuestContext() are Proxies, so campaign/terrain data read
// from app state cannot be posted to a worker or written to IndexedDB directly.
// (JSON-based paths — Trystero transport, JSON.parse(JSON.stringify(...)) — read
// THROUGH proxies and are unaffected; this helper is only for clone boundaries.)
//
// Pass the PROXY VALUE itself through toPlain (not a plain wrapper that merely
// contains it) so it hits a fast path:
//   - useSnapshot tracking proxy -> getUntracked() -> underlying plain snapshot
//   - Valtio store proxy         -> snapshot()      -> plain snapshot
// Both are cheap (structural sharing). The deep-rebuild fallback only runs for
// the unusual case of a plain object that itself nests proxies.
//
// The result may be FROZEN (Valtio snapshots are). It is safe to read, post to a
// worker, structuredClone, or persist. If you need a MUTABLE deep copy
// (clone-then-mutate), wrap it: `structuredClone(toPlain(x))`.

import { snapshot, getVersion } from "valtio";
import { getUntracked } from "proxy-compare";

export function toPlain<T>(value: T): T {
	return convert(value) as T;
}

function convert(value: unknown): unknown {
	if (value === null || typeof value !== "object") return value;

	// useSnapshot() tracking proxy -> its underlying (deeply plain) snapshot,
	// read without recording access (so it never widens a component's tracked
	// re-render set).
	const untracked = getUntracked(value as object);
	if (untracked) return untracked;

	// Binary stays by reference: already structured-clone-safe / transferable,
	// and we don't want to duplicate large buffers.
	if (
		value instanceof ArrayBuffer ||
		ArrayBuffer.isView(value) ||
		(typeof Blob !== "undefined" && value instanceof Blob)
	) {
		return value;
	}

	// Valtio store proxy -> deeply plain snapshot in one shot. Detect proxy-ness
	// with getVersion (returns undefined for a non-proxy WITHOUT warning) rather
	// than catching snapshot()'s throw: snapshot() console.warns "Please use
	// proxy object" before throwing in dev, and convert() recurses, so the old
	// try/catch spammed one warning per plain node on every toPlain of a plain
	// tree (e.g. normalizeActionParams on action params).
	if (getVersion(value) !== undefined) {
		return snapshot(value as object);
	}

	// Plain object/array that may still nest proxies deeper -> rebuild.
	if (Array.isArray(value)) return value.map(convert);
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>)) {
		out[key] = convert((value as Record<string, unknown>)[key]);
	}
	return out;
}
