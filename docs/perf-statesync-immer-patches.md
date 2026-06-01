# StateSync via Immer patches (deferred perf work — "#7")

Status: **proposed / not yet implemented.** This is the design writeup for the
highest-payoff, highest-risk item from the state-sync performance review. Do the
contained wins (debounced persistence, terrain-stub localStorage, presence/persist
decoupling, redundant-clone removal, byte-size compression gate) first — those are
done. This one is a larger refactor of the DM broadcast path and should be taken on
deliberately, behind a flag, with invariant checks.

## The opportunity

Today every authoritative mutation pays an O(campaign-size) tax on the DM, regardless
of how small the change was:

1. `ActionService.mutateCampaign` already runs the handler against an Immer draft and
   calls `finishDraft` to produce the next campaign (structural sharing — good).
2. `StateSync.broadcast` then **re-derives** what changed:
   - `sanitizeForPlayers` does a full `structuredClone(campaign)` (deep-copies the
     entire campaign, including up to ~1000 log entries and the active terrain),
   - `compare(lastBroadcastState, sanitized)` from `fast-json-patch` walks the **whole
     tree** to compute the delta,
   - the sanitized clone is adopted as the next baseline.

So Immer computes the change set during `finishDraft`, we throw that information away,
and then reconstruct an equivalent change set by brute-force diffing two full copies.

Immer can hand us the patches directly via `produceWithPatches`, which would let us
**delete the per-action `structuredClone` + full-tree `compare` entirely**. On a large
campaign this is the dominant remaining per-action CPU cost on the DM.

```ts
import { produceWithPatches } from "immer";
const [next, patches, inversePatches] = produceWithPatches(previous, (draft) => {
  // run domain action against draft …
});
```

## Why it is not a drop-in

The patches Immer produces describe changes to the **DM's private campaign**. Players
must never see two of those values, which is exactly what `sanitizeForPlayers` exists
to fix:

- `Campaign.Id` (the DM's secret GUID) → replaced with the public `RoomCode`.
- each `VoxelTerrain.VoxelStorageKey` → rewritten from `${Id}:${terrainId}` to
  `${RoomCode}:${terrainId}`.

With the current full-clone-then-sanitize approach, sanitization happens once on a
whole object. With patches, sanitization has to be applied **to the patch stream**, and
patch values can be arbitrarily deep (e.g. a single patch that replaces an entire
`VoxelTerrain` object carries a nested `VoxelStorageKey` and the `Voxels` blob).

There are also two format mismatches to resolve:

1. **Patch op format.** Immer patch paths are arrays (`["VoxelTerrains", 3, "Voxels"]`)
   with no leading slash; `fast-json-patch` `applyPatch` expects JSON-Pointer strings
   (`"/VoxelTerrains/3/Voxels"`). The player apply path (`StateSync.handleDeltaUpdate`)
   currently uses `fast-json-patch.applyPatch`. Either convert Immer patches to JSON
   Patch before sending, or switch the player apply to Immer's `applyPatches`.
2. **`remove` semantics on arrays.** Immer and JSON Patch agree closely, but array
   `remove`/index handling has edge cases worth a focused test (e.g. removing a
   character from `GameState.Characters`).

## Proposed design

### DM side

1. In `ActionService.mutateCampaign`, switch from `createDraft`/`finishDraft` to
   `produceWithPatches`, capturing `(next, patches)`. Keep the existing
   commit-to-context behavior.
2. Pass `patches` down to `StateSync` alongside the next campaign, e.g.
   `stateSync.broadcastPatches(next, patches)`.
3. In `StateSync`, replace the `sanitizeForPlayers` + `compare` step with a
   **patch sanitizer**:
   - Drop/short-circuit if `patches.length === 0` (no-op unless `force`).
   - Map each patch:
     - rewrite a patch whose path targets `Id` at the campaign root → value `RoomCode`,
     - rewrite any patch whose value is (or contains) a `VoxelStorageKey` → rebuild it
       from `RoomCode`,
     - recursively sanitize object/array patch **values** (a replaced subtree may carry
       nested secret fields),
     - convert path array → JSON-Pointer string if we keep `fast-json-patch` on the
       receiver.
   - The active terrain `Voxels` blob naturally appears in a patch **only when it
     actually changed** — strictly better than `compare`, which still has to walk the
     blob to confirm it is unchanged.
4. Keep `lastBroadcastState` ONLY if still needed for the periodic/`force` full sync.
   With patches we no longer need it as a diff baseline; the full-sync fallback can
   re-sanitize on demand (rare path), so the steady state holds **no** extra cloned
   baseline.

### Player side

- Keep `currentState` as the authoritative local copy (seeded by the first full sync,
  which is already sanitized → `Id === RoomCode`).
- Apply incoming sanitized patches with either `fast-json-patch.applyPatch` (if we
  converted to JSON Pointer) or Immer's `applyPatches` (if we send Immer-format patches
  and convert the receiver). Prefer whichever keeps one patch format end-to-end.
- The existing `baseVersion` / version-mismatch → `/REQUEST_FULL_SYNC` recovery path is
  unchanged and remains the desync safety net.

### Sanitizer sketch

```ts
// Sanitize a single Immer patch for player consumption.
function sanitizePatch(patch: Patch, roomCode: string): Operation {
  const path = patch.path; // (string | number)[]
  // Root campaign Id → RoomCode
  if (path.length === 1 && path[0] === "Id") {
    return toJsonPatch({ ...patch, value: roomCode });
  }
  // Any value that is/contains a VoxelStorageKey or terrain object → deep sanitize
  const value = sanitizeValueDeep(patch.value, roomCode);
  return toJsonPatch({ ...patch, value });
}
```

The deep value sanitizer reuses the same rules as `sanitizeForPlayers` but applies them
to whatever object a patch happens to carry. Worth extracting those rules into a shared
pure function so the full-sync path and the patch path can't drift.

## Risks / why this is "last"

- **Correctness of the sanitized patch stream is load-bearing.** A missed secret field
  leaks the DM's GUID/terrain keys; a malformed patch desyncs a player. Mitigate with a
  dev-only invariant: after building patches, apply them to a sanitized baseline and
  assert the result deep-equals `sanitizeForPlayers(next)` (i.e. keep `compare` around
  in dev as an oracle, drop it in prod).
- **Array remove/index edge cases** between Immer and JSON Patch.
- **Two patch formats** in the codebase if conversion is partial — pick one and keep it
  end-to-end.
- Touches the authoritative broadcast path that every player depends on, so it wants a
  feature flag and a staged rollout.

## Interactions with shipped work

- The **byte-size compression gate** (`STATE_UPDATE_DELTA_COMPRESSION_BYTE_THRESHOLD`)
  is orthogonal and keeps working — it still measures serialized patch bytes.
- **Terrain-in-localStorage stubbing** is unaffected; this is purely the broadcast path.
- The periodic full-sync fallback (`fullStateInterval`) and peer-join full sync still
  use `sanitizeForPlayers`; only the per-action delta path changes.

## Expected payoff

Removes, per authoritative action on the DM:
- one full `structuredClone` of the campaign (sanitize), and
- one full-tree `fast-json-patch.compare`,
- plus the steady-state baseline clone.

Replaced by: an O(changed-paths) patch sanitize/convert pass. For a large campaign this
is the single biggest remaining per-action CPU win. Player-side apply cost is unchanged
or slightly lower (no JSON-Pointer re-parse if we standardize on one format).

## Rough effort

Medium-large. ~1–2 focused days including the shared sanitizer extraction, the dev
oracle/invariant, format decision, and array-edge-case tests. Do it on its own branch.
