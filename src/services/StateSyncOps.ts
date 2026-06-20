// services/StateSyncOps.ts
//
// Operation-based delta translation: turn Valtio's proxy mutation ops into
// JSON-Patch operations the receiver applies to its campaign baseline. This is
// the heart of Plane A -- it replaces the whole-campaign `compare()` two-tree
// walk with a translation of the ops Valtio already recorded for the mutation.
//
// Why this is correct without a retained baseline:
//
//  * Final values are read from the post-action campaign snapshot passed in.
//    That snapshot is a plain, frozen Valtio snapshot, so no live proxy can
//    leak onto the wire. From the ops we use only paths, op kind, and (for
//    array index sets) whether the index is brand new -- never the op value.
//
//  * Object members -> `add` (RFC 6902 add replaces an existing member or adds
//    a new one) or `remove` when the value is gone (deleted, or set to
//    undefined, which JSON transport drops anyway).
//
//  * Arrays are the subtle part, because Valtio's array ops don't map 1:1 to
//    JSON-Patch. Observed Valtio behavior (valtio 2.3.x):
//      push      -> set <newIndex>                  (NO length op)
//      unshift   -> set <newIndex>, set <oldIndex>  (shift; NO length op)
//      pop       -> delete <last>, set length
//      splice    -> set/delete shifted indices, set length
//      arr[i]=x  -> set <i>
//    So `length` ops mark only SHRINKS. Growth is detected via the op's
//    prevValue: a brand-new index has prevValue === undefined.
//
//    Per directly-touched array we classify:
//      - PURE TAIL APPEND: every direct op is a `set` at a brand-new index
//        (prevValue undefined), the new indices are exactly the contiguous tail
//        of the current array, and there are no deletes/length ops. Emit one
//        `add /arr/-` per appended element (efficient -- e.g. the Log, appended
//        every action, stays O(1) per entry instead of resending the array).
//      - ANYTHING ELSE that directly touches the array (existing-index set,
//        delete, length op, non-tail insert) -> REPLACE THE ARRAY WHOLESALE
//        from the snapshot. Campaign arrays are metadata-sized (heavy terrain
//        voxels live outside the proxy), so wholesale replacement is cheap and
//        sidesteps JSON-Patch insert/shift semantics entirely.
//
//    Editing a field *inside* an array element (e.g. Roster/0/Stats/HP) is a
//    plain object-member op -- the array index is just navigation, so it stays
//    fine-grained and the array is not touched directly.
//
// The receiver's version-mismatch -> full-sync path remains the universal
// backstop if anything here ever produces a wrong patch.

import type { Operation } from "fast-json-patch";
import { isSecretDeltaPath } from "./StateSyncSanitize";

/**
 * Structural shape of a Valtio subscribe op. Matches valtio's internal `Op`
 * type without coupling to its export path:
 *   ['set', path, value, prevValue] | ['delete', path, prevValue]
 */
export type ValtioOp =
	| ["set", (string | symbol)[], unknown, unknown]
	| ["delete", (string | symbol)[], unknown];

// Ops on the store root are prefixed with this key; everything else is ignored.
const ACTIVE_CAMPAIGN_KEY = "ActiveCampaign";

// Map/Set keys for paths use JSON encoding rather than a join char so they
// round-trip losslessly for ANY segment content. Campaign objects can hold
// arbitrary string keys (e.g. user-named ScriptVars / Record entries) that may
// contain whatever a join separator would be, so a naive join/split would
// corrupt the path -> a bogus patch -> silent desync.
const pathKey = (path: string[]): string => JSON.stringify(path);
const fromPathKey = (key: string): string[] => JSON.parse(key) as string[];

interface ParsedOp {
	type: "set" | "delete";
	path: string[];
	/** For a `set` at an array index: was the index brand new (prevValue undefined)? */
	prevUndefined: boolean;
}

interface ArrayRecord {
	hasDelete: boolean;
	hasLengthOp: boolean;
	/** A `set` onto an index that already existed (prevValue defined). */
	hasExistingSet: boolean;
	/** Brand-new indices set during this batch. */
	newIndices: Set<number>;
}

/**
 * Translates a buffer of Valtio ops (recorded against the context store root)
 * into JSON-Patch operations relative to the campaign object.
 *
 * @param ops      Buffered ops since the last broadcast.
 * @param campaign The post-action campaign snapshot (plain, frozen).
 * @returns The patch list, `[]` if nothing campaign-relevant changed, or `null`
 *          if the campaign root itself was replaced wholesale (caller must fall
 *          back to a full send -- a delta can't express "replace everything"
 *          without leaking the secret Id).
 */
export function translateOpsToPatches(
	ops: ValtioOp[],
	campaign: unknown
): Operation[] | null {
	// 1. Keep only campaign-relative ops with string-only paths.
	const parsed: ParsedOp[] = [];
	for (const op of ops) {
		const rawPath = op[1];
		if (rawPath.length === 0 || rawPath[0] !== ACTIVE_CAMPAIGN_KEY) continue;
		const rel: string[] = [];
		let stringOnly = true;
		for (let i = 1; i < rawPath.length; i++) {
			const seg = rawPath[i];
			if (typeof seg !== "string") {
				stringOnly = false;
				break;
			}
			rel.push(seg);
		}
		if (!stringOnly) continue;
		// A bare ActiveCampaign reassignment replaces the whole campaign; a delta
		// cannot carry that safely (and would leak Id), so force a full send.
		if (rel.length === 0) return null;
		// prevValue lives at op[3] for `set`, op[2] for `delete`. Undefined means
		// the key/index did not exist before this op.
		const prevUndefined = op[0] === "set" ? op[3] === undefined : op[2] === undefined;
		parsed.push({ type: op[0], path: rel, prevUndefined });
	}
	if (parsed.length === 0) return [];

	// 2. Split into ops that DIRECTLY modify an array element/length vs. plain
	//    object-member ops. "Direct" = the op's parent (in the snapshot) is an
	//    array.
	const arrayRecords = new Map<string, ArrayRecord>();
	// Member path key -> whether the FIRST op this flush created it (prevValue
	// undefined). A path created and then deleted within one flush never existed
	// in the receiver's baseline, so its `remove` must be suppressed.
	const memberPaths = new Map<string, boolean>();
	for (const op of parsed) {
		const container = op.path.slice(0, -1);
		const last = op.path[op.path.length - 1];
		const parent =
			container.length === 0 ? campaign : getAtPath(campaign, container);
		if (Array.isArray(parent)) {
			const key = pathKey(container);
			const rec =
				arrayRecords.get(key) ??
				{
					hasDelete: false,
					hasLengthOp: false,
					hasExistingSet: false,
					newIndices: new Set<number>(),
				};
			if (last === "length") {
				rec.hasLengthOp = true;
			} else if (op.type === "delete") {
				rec.hasDelete = true;
			} else if (op.prevUndefined) {
				rec.newIndices.add(Number(last));
			} else {
				rec.hasExistingSet = true;
			}
			arrayRecords.set(key, rec);
		} else {
			const key = pathKey(op.path);
			// Record creation status from the first op only.
			if (!memberPaths.has(key)) memberPaths.set(key, op.prevUndefined);
		}
	}

	// 3. Per touched array, decide wholesale replace vs. tail-append.
	const wholeArrays = new Set<string>();
	const appends: { path: string[]; indices: number[] }[] = [];
	for (const [key, rec] of arrayRecords) {
		const path = fromPathKey(key);
		const arr = getAtPath(campaign, path);
		const len = Array.isArray(arr) ? arr.length : 0;
		const isPureNewIndexSet =
			!rec.hasDelete &&
			!rec.hasLengthOp &&
			!rec.hasExistingSet &&
			rec.newIndices.size > 0;
		if (!isPureNewIndexSet) {
			wholeArrays.add(key);
			continue;
		}
		const indices = [...rec.newIndices].sort((a, b) => a - b);
		// Contiguous tail? indices must be exactly { len-k, ..., len-1 }.
		const k = indices.length;
		const isTailAppend = indices.every((v, i) => v === len - k + i);
		if (isTailAppend) {
			appends.push({ path, indices });
		} else {
			wholeArrays.add(key);
		}
	}

	// 4. Emit patches, skipping any target already covered by a wholesale array
	//    replace or by a freshly appended element (whose snapshot value is
	//    complete on its own).
	const appendedPositions = new Set<string>();
	for (const a of appends) {
		for (const idx of a.indices) appendedPositions.add(pathKey([...a.path, String(idx)]));
	}
	const wholeKeys = [...wholeArrays].map(fromPathKey);
	const appendedKeys = [...appendedPositions].map(fromPathKey);
	const isCovered = (segs: string[]): boolean =>
		wholeKeys.some((w) => isStrictPrefix(w, segs)) ||
		appendedKeys.some((a) => isStrictPrefix(a, segs));

	const patches: Operation[] = [];

	// 4a. Wholesale array replacements.
	for (const segs of wholeKeys) {
		if (isCovered(segs) || isSecretDeltaPath(segs)) continue;
		emitMemberOrElement(patches, campaign, segs);
	}
	// 4b. Tail appends.
	for (const a of appends) {
		if (isCovered(a.path) || isSecretDeltaPath(a.path)) continue;
		const pointer = toJsonPointer([...a.path, "-"]);
		for (const idx of a.indices) {
			const value = getAtPath(campaign, [...a.path, String(idx)]);
			patches.push({ op: "add", path: pointer, value });
		}
	}
	// 4c. Object members.
	for (const [key, createdThisFlush] of memberPaths) {
		const segs = fromPathKey(key);
		if (isCovered(segs) || isSecretDeltaPath(segs)) continue;
		// A key born and removed within this flush never reached the baseline.
		if (createdThisFlush && getAtPath(campaign, segs) === undefined) continue;
		emitMemberOrElement(patches, campaign, segs);
	}

	return patches;
}

/**
 * Emits a `remove` (value gone), `replace` (array element overwrite), or `add`
 * (object member add-or-replace) for the value currently at `path`.
 */
function emitMemberOrElement(
	patches: Operation[],
	campaign: unknown,
	path: string[]
): void {
	const value = getAtPath(campaign, path);
	const pointer = toJsonPointer(path);
	const parent =
		path.length === 1 ? campaign : getAtPath(campaign, path.slice(0, -1));
	if (value === undefined) {
		// Only remove when the parent container still exists. If the parent is
		// gone, an ancestor patch already removed this whole subtree; if it never
		// existed (key created and deleted within the same flush), there is
		// nothing to remove. Either way an unconditional `remove` here would be an
		// invalid patch the receiver rejects.
		if (parent != null) {
			patches.push({ op: "remove", path: pointer });
		}
		return;
	}
	if (Array.isArray(parent)) {
		patches.push({ op: "replace", path: pointer, value });
	} else {
		patches.push({ op: "add", path: pointer, value });
	}
}

/** True when `prefix` is a strict ancestor path of `segs`. */
function isStrictPrefix(prefix: string[], segs: string[]): boolean {
	return (
		prefix.length < segs.length && prefix.every((seg, i) => seg === segs[i])
	);
}

/** Walks `path` from `root`, returning the value or undefined if any hop is nullish. */
function getAtPath(root: unknown, path: string[]): unknown {
	let cur: unknown = root;
	for (const seg of path) {
		if (cur == null || typeof cur !== "object") return undefined;
		cur = (cur as Record<string, unknown>)[seg];
	}
	return cur;
}

/** Builds an RFC 6901 JSON Pointer from campaign-relative path segments. */
function toJsonPointer(path: string[]): string {
	return (
		"/" + path.map((seg) => seg.replace(/~/g, "~0").replace(/\//g, "~1")).join("/")
	);
}
