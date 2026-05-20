# Quest-Net Performance Roadmap

Working notes from architecture review, May 2026.

---

## Phase 1 — VoxelTerrainEditor rewrite (immediate)

The editor is the primary offender. Every single-voxel edit currently triggers a full O(n log n) pipeline on the main thread. The rewrite targets five root causes independently.

### 1. Replace base64 as the edit-time data structure

**What:** On editor mount, decode the terrain's `Voxels` string once into a flat `Uint8Array` of size `voxelW × voxelH × voxelL`. Index as `x + z * voxelW + y * voxelW * voxelL`. Value `0` = empty; `1–255` = color palette index. All reads and writes during a session are O(1) array lookups.

**What goes away:** `inflightOverlayRef`, `VoxelOverlay` type, `commitOverlayToTerrain`, `peekHasVoxel`, `peekVoxelColor`, `schedulePendingTerrainChange`, `flushPendingTerrainChange`. The overlay pattern is the consequence of writes being expensive — with O(1) writes it is unnecessary.

**When to re-encode:** Only at stroke end (`finishStroke`), not per flush. `encodeVoxels` runs once per brush stroke.

### 2. Replace BVH raycasting with DDA grid traversal

**What:** Implement `raycastVoxelGrid(ray, editGrid, index): PickInfo | null` using the Amanatides & Woo "Fast Voxel Traversal Algorithm" (1987). The ray is unprojected from the orthographic camera into voxel grid space. The traversal steps one voxel at a time along the ray, checking the flat array for occupancy. Returns hit voxel coordinate, face normal, and intersection point — the same shape as the current `PickInfo`. For a 40×40×16 grid the ray visits at most ~70 voxels.

**What goes away in the editor:** `resources.raycaster`, `acceleratedRaycast` import, `new MeshBVH(geometry)` call in `buildEditorTerrainGeometry`, the `boundsTree` assignment. The editor terrain mesh no longer needs a BVH at all — it exists only for display, not for picking.

**Reference:** http://www.cse.yorku.ca/~amana/research/grid.pdf

### 3. Dirty chunk system for geometry updates

**What:** Divide the voxel grid into chunks (e.g. 8×8×8 voxels). Each chunk owns a `THREE.Mesh` in the editor scene. When a voxel write touches a chunk, mark it dirty (and any adjacent chunk whose exposed faces could change at the boundary). The rAF loop rebuilds geometry only for dirty chunks, swaps the mesh, clears the dirty flag.

**Scale:** A resolution-2, 20×20×8-tile map = 40×40×16 voxels ≈ 80 chunks of ≤512 voxels. A single-voxel edit touches 1–2 chunks. Chunk rebuild visits ~512 voxels instead of ~8,000 — before even accounting for the BVH removal.

**AO across boundaries:** When building a dirty chunk's geometry, neighbor-voxel queries for face culling and AO sample the shared flat array (which covers the entire terrain). No chunk-border seam artifacts as long as this is done correctly.

**Grid lines:** Per-chunk `LineSegments` geometry, rebuilt only for dirty chunks.

**What stays the same:** `3DMap.tsx` (gameplay) continues using a single full-terrain mesh built by the existing worker. The chunk system is internal to the editor only.

### 4. Decouple Three.js scene updates from React

**What:** Remove `bumpEditGen()` from the edit hot path entirely. Three.js scene updates (dirty chunk swaps) happen imperatively inside the rAF loop via `resourcesRef`. React state (`editGen`) only increments when something React-visible changes: stroke end (sidebar voxel count, undo stack), undo/redo, external prop change. The per-voxel edit loop — pointer event → DDA pick → flat array write → mark chunk dirty → rAF rebuild — never touches React.

### 5. Throttle `onChange` to stroke boundaries

**What:** Move the `onChange(nextTerrain)` call from `flushPendingTerrainChange` (which fires per rAF during drag) to `finishStroke` (pointer up). During a drag, the parent is never re-rendered. After each stroke ends, `encodeVoxels` runs once and `onChange` fires once.

**Preview tab fix:** The preview `<ThreeDMap terrain={...} />` currently reads the terrain *prop*, so it would show stale terrain if `onChange` is deferred. Fix: pass `terrainRef.current` to the preview ThreeDMap instead of the prop. The ref always reflects the latest committed state.

---

## Phase 2 — Retire BVH from the gameplay map (later)

**Current situation:** `three-mesh-bvh` remains in use in `3DMap.tsx`, `FirstPerson/terrain.ts`, `ThreeDMovementLayer`, `ThreeDActorLayer`, and `ThreeDPingLayer`. All of these use `intersectFirstTerrainHit` → `raycaster.intersectObjects` with `firstHitOnly = true` (a BVH-specific optimization) to pick terrain tiles during movement, actor occlusion checks, ping placement, and first-person collision.

**The case for DDA here too:** The gameplay terrain is also a regular voxel grid. DDA traversal would be equally correct for tile picking, and does not require a mesh object in the scene for raycasting at all. The `VoxelTerrainIndex` (already cached in memory) provides all occupancy data needed.

**Why it's not urgent:** In the gameplay map, the BVH is built off-thread by the existing worker and deserialized on the main thread (essentially free). It does not cause main-thread stalls during gameplay. The improvement would be cleaner code and removal of the `three-mesh-bvh` dependency, not a perceptible frame-rate gain.

**What would need to change:**
- Remove `acceleratedRaycast` from terrain mesh setup in `3DMap.tsx` and `FirstPerson/terrain.ts`
- Replace `intersectFirstTerrainHit` in `movement3DHelpers.ts` with a DDA-based equivalent that accepts a `VoxelTerrainIndex` and a `THREE.Ray`
- Update `ThreeDMovementLayer`, `ThreeDActorLayer`, `ThreeDPingLayer` call sites
- Remove BVH construction from `voxelGeometryWorker.ts` and `useVoxelTerrainGeometryWorker.ts`
- Uninstall `three-mesh-bvh`

Actor mesh picking (`raycaster.intersectObjects(actorPickTargets)`) does not use BVH and is unaffected.

---

## Phase 3 — Other performance considerations

### Tab-switch lag (Main.tsx)
The ~500ms stall when switching to the main campaign tab is a separate issue from the editor. Likely causes: a large React re-render tree on mount, expensive `useEffect`s firing synchronously, or heavy `localStorage` reads during context hydration. Profile with React DevTools Profiler to identify the specific component subtree causing the stall. Candidates: `VoxelTerrainIndex` cache warming, `StateSync` initialization, or image loading via `ImageService`.

### `getVoxelTerrainIndex` call frequency in editor
During hover, `getPickInfo` and `updateHoverIndicator` both call `getVoxelTerrainIndex(terrainRef.current)` on every pointer move event. After Phase 1, `terrainRef.current` only changes at stroke end, so the index cache hit rate becomes very high. No change needed, but worth noting that the LRU cache (size 4) in `VoxelTerrainIndex.ts` is doing real work here.

### Grid line geometry
The current grid is rebuilt fully (`rebuildGrid`) on every `editGen` tick, including after undo/redo. After Phase 1 the dirty chunk system handles this per-chunk. Longer-term: the tactical grid lines could be a fullscreen shader overlay (sampling terrain height from a texture) instead of LineSegments geometry, eliminating the rebuild entirely for grid-only changes.

### `onChange` propagation cost
Even at stroke-end cadence, `onChange` triggers a parent form re-render which eventually propagates terrain down through `fast-json-patch` delta sync if a network session is active. Consider whether the editor should be disconnected from `StateSync` during active editing — only syncing on explicit save, not on every stroke.

### Worker reuse
Currently `useVoxelTerrainGeometryWorker` spawns a new `Worker` instance per terrain revision and terminates it after the first message. For the gameplay map (infrequent terrain changes) this is fine. If the editor ever uses the worker for initial terrain load, consider keeping a persistent worker instance across the session.

---

## Dependency audit after Phase 1 + 2

| Package | After Phase 1 | After Phase 2 |
|---|---|---|
| `three-mesh-bvh` | Still needed (gameplay map) | Can uninstall |
| `fast-json-patch` | Unchanged | Unchanged |
| `mathjs` | Unchanged | Unchanged |
