# Quest-Net

Quest-Net is a real-time collaborative TTRPG (tabletop role-playing game) manager built with React, TypeScript, and Vite. It enables a DM and players to connect peer-to-peer via Trystero (WebRTC/Nostr) and run game sessions with an isometric map, character management, combat, dice rolling, and more.

## Note for Claude

The sandboxed Linux shell sees a stale/truncated view of files in this repo (bash `cat`, `wc -c`, `tsc`, etc. may show files cut off mid-line, even though the actual files on disk are intact and the Read/Write/Edit tools see them correctly). This is purely a workspace-mount issue on Claude's side. Do not try to "fix" truncated files by rewriting them through bash — the source of truth is what the file tools report. Skip running `tsc`/`vite build` from the shell to verify changes; rely on the file-tool view and let the user run the build themselves.

## Tech Stack

- **React 19** with **TypeScript** (strict mode) and **React Router v7** (HashRouter)
- **Vite v7** for build/dev
- **Tailwind CSS v4** + **DaisyUI v5** for styling; configured via the `@tailwindcss/vite` Vite plugin (no PostCSS). Icons via `@iconify/tailwind4` + `@iconify/json`.
- **Three.js** (`three@0.180`) for the voxel-based 3D map (`MapScene.tsx`). Core imports: `import * as THREE from 'three'`. Addon imports (OrbitControls etc.) use `three/examples/jsm/`, **not** `three/addons/` — the `addons/` directory does not physically exist in the installed version even though it appears in the package exports map. Example: `import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'`. Use `MeshStandardMaterial` (not `MeshLambertMaterial`) for voxels — Lambert is legacy and unreliable with InstancedMesh vertex colors in r180. **Do not use Unicode box-drawing characters (e.g. `--`) in comments inside the large Three.js map files (`MapScene.tsx`, etc.)** — they can cause the Write tool to truncate the file silently; use plain ASCII `--` instead.
- **postprocessing** for post-processing effects on the 3D map
- **gsap** and **motion** for animations
- **react-rnd** for resizable/draggable UI panels
- **colorjs.io** for color manipulation
- **Trystero** (`^0.24`) for peer-to-peer networking (Nostr strategy by default, app ID `'quest-net'`)
- **fast-json-patch** for delta state synchronization
- **mathjs** for dice/formula evaluation
- **IndexedDB** for image binary storage and large terrain voxel data; **localStorage** for app state (Context)

## Architecture Overview

### DM-as-Authority Model

The DM holds the canonical game state. Players send action requests over Trystero channels; the DM validates permissions, applies mutations, and broadcasts state updates. Players may apply optimistic updates locally, but the DM's broadcast is authoritative.

### State Management

A single `Context` object lives in React context and is persisted to localStorage. It holds: `User`, `Campaigns: CampaignInfo[]` (lightweight metadata only — full campaign payloads live in IndexedDB), `ActiveCampaign: Campaign | null` (the currently open campaign, unpacked from IndexedDB), `AppSettings: Record<string, string>`, `version`, `IsOptimistic?`, and `SecretModes?`. `triggerContextUpdate()` forces re-renders globally. Images are stored separately in IndexedDB and exchanged over dedicated Trystero channels.

### Action System (Command Pattern)

All state mutations go through `ACTION_REGISTRY` — a map of `"domain:action"` keys to handlers with role-based permissions. `ActionService.execute()` dispatches locally for the DM or sends a request to the DM for players. This pattern enables permission checks, logging, and network serialization in one place.

`ActionService.bumpCampaignRefs()` maintains fresh references for campaign collections that React components memoize against after in-place domain mutations. Whenever you add, rename, remove, or start memoizing against a top-level `Campaign` collection, a `GameState` collection, or nested mutable campaign arrays such as `Settings.SharedInventories`, check whether `bumpCampaignRefs()` must be updated.

### State Sync

`StateSync` broadcasts campaign state to peers using delta patches (fast-json-patch) with compression via `StateUpdateCompression`. A full-state fallback fires periodically or on desync detection. The DM's secret `Campaign.Id` is replaced with the public `RoomCode` before broadcast to players.

### Migration System

Versioned migrations in `src/migrations/` transform saved Context objects across schema changes. On migration failure, backups are written to localStorage.

## Project Structure

```
src/
├── components/         # Reusable UI components
│   ├── Form/           # FormWrapper, FormContext (CRUD forms)
│   ├── IndexView/      # Paginated table/list with search, folders, tags
│   ├── CollectionView/ # Grid/list display for items, skills, etc.
│   ├── Map/            # Three.js 3D voxel map (MapScene, MapModeController, layer subdirs, terrain, first-person)
│   ├── Dice/           # Dice roller UI
│   ├── StatBar/        # Stat bar display
│   ├── ActionBubbles/  # Combat action bubble overlay
│   ├── AttributesSection/ # Actor attributes display
│   └── inputs/         # Domain-specific inputs (ImagePicker, TagEditor, etc.)
├── domains/            # Feature domains (model + actions + UI per domain)
├── services/           # Actions/, StateSync, ImageService, SoundEffectService,
│                       #   TerrainStorageService, ImageGenerationService, etc.
├── hooks/              # usePeerTracking, useAutoReconnect, useRelayWatchdog
├── utils/              # DiceUtils, FolderUtils, terrain/, Audio/, LocalStorageUtilities, etc.
├── migrations/         # Version migration scripts
├── data/               # Static data (defaultVoxelStamps.ts)
└── App.tsx / index.tsx / version.ts
```

## Domains

Each domain typically has a model file (`Domain.ts`), an actions file (`DomainActions.ts`), and optional UI components (Edit, Index, Display, Modal). Key domains include:

- **Campaign** — Root container; holds roster, templates, game state, settings, logs. `Campaign.Id` is the DM's private GUID; `Campaign.RoomCode` is the public join code (max 32 chars).
- **Actor / Character / Entity** — Characters are player-controlled actors; Entities are NPCs/enemies. Both extend the Actor base (stats, actions, attributes, inventory, equipment, skills, statuses, position, color, size). `Character` additionally has `Notes: Note[]` and `CritMessage?`.
- **GameState** — Live session state: active characters/entities, combat state, scene, audio list, volume, calendar day, remaining short rests. Terrain is no longer tracked here — each actor's `Position.terrainId` determines which terrain it occupies (multi-terrain worlds).
- **Item / Skill / Status** — Templates stored on the campaign; instances slotted onto actors.
- **VoxelTerrain** — 3D voxel grid encoded as a **base64-encoded Sparse Voxel Octree (SVO)**; voxel positions are implicit in the octree structure and colors are stored as a parallel byte stream. Supports configurable resolution (1–3 voxels per tactical unit). Has `Lighting` and `Background` properties. Large terrain voxel data is offloaded to IndexedDB via `TerrainStorageService`; the `Voxels` field may be a stub until hydrated. `Campaign.VoxelTerrains[]` holds all terrains; `GameState.VoxelTerrainId` points to the active one.
- **Terrain** — UI wrapper (Edit/Index/Display) for creating and managing VoxelTerrains.
- **Scene** — Environment and focus images for the current encounter.
- **Image** — Metadata in campaign, binary data in IndexedDB via ImageService.
- **Audio** — Background music and sound effects.
- **Log** — Categorized activity journal with visibility levels (dm/player/owner/all).
- **CampaignSetting** — Configurable stat definitions, action definitions, attribute definitions, initiative settings, calendar, rest rules, movement costs, shared inventories, terrain environment presets.
- **Combat** — Turn-based battle management. `CombatState` tracks `currentRound`, `initiativeSide` ("party" | "enemies"), and `RoundCompleted[]`. Supports party mode (sides alternate) and individual mode (every actor in one order), configured via `InitiativeSettings`.
- **Calendar** — In-world date/time tracking.
- **Scenario** — Pre-built encounters.
- **Note** — Character-level private notes (stored on `Character`, not as a standalone collection).
- **Ping** — Ephemeral animated ping markers on the map.
- **Sticker** — Emoji stickers placed on terrain surfaces.
- **SharedInventory** — Shared inventory pools accessible by multiple actors.
- **AppSetting** — User-facing app preferences (stored in `Context.AppSettings`).
- **Room** — Trystero connection wrapper (`Room` type = `ReturnType<typeof joinRoom>`).
- **Context / User** — Global app state and current user session.

## Key Components

### Map (`src/components/Map/`)

3D voxel renderer built on Three.js. `MapScene.tsx` is the root component; it owns ONE persistent scene (via `useMapSceneCore`) shared by both the world view and the first-person view, so toggling between them swaps only the camera/input/mode-specific layers instead of rebuilding the WebGL stack. `MapModeController.ts` hosts both camera systems (the isometric/perspective/freecam `CameraRig` and a first-person `PerspectiveCamera`) and tweens between them; `FirstPerson/FirstPersonView.tsx` holds the capsule-walking sim + HUD. The world view sets up an orthographic camera with isometric framing, OrbitControls (pan/zoom/rotate), PCFSoft shadows, post-processing effects, and custom DDA raycasting (Amanatides & Woo algorithm — no external BVH library). Map state is provided by `MapStateProvider.tsx`. The voxel terrain editor preview also renders `MapScene` (world mode, no actors). Key sub-directories:

- **Actors3D/** (`ThreeDActorLayer.tsx`) — Renders actor standees (cutout images) with selection highlights and height-dragging for Z placement.
- **Movement3D/** (`ThreeDMovementLayer.tsx`) — Movement range highlighting via shader-patched MeshStandardMaterial, Dijkstra pathfinding for movement costs, raycasting for tile selection.
- **Stickers3D/** (`ThreeDStickerLayer.tsx`) — Emoji stickers placed on terrain surfaces.
- **Pings3D/** (`ThreeDPingLayer.tsx`) — Animated ping markers.
- **Terrain/** — Voxel terrain geometry (`VoxelTerrainGeometryUtils.ts`, web worker `voxelGeometryWorker.ts`), named palette materials (one `MeshStandardMaterial` per special palette index: `stoneBricks240`, `water241`, `grass242`, `light243`, `wood244`, `lava245`, `glass246`, `gold247`, `silver248`, `ironBars249`, `flesh250`, plus `defaultMaterial`), and AO shader (`voxelAoShader.ts`).
- **FirstPerson/** — First-person view mode with capsule controller and HUD.

Supporting files: `terrainEnvironment.ts` (apply lighting/background to scene), `shadowCameraBounds.ts`, `mapPostProcessing.ts`, `threeDMapConstants.ts` (camera, lighting, shadow, controls, and material tuning constants).

Supporting utilities in `src/utils/terrain/`:
- `data/` — `VoxelDataUtils` (SVO encode/decode entry points), `voxelCodecWasm` (accessor for the WASM SVO codec; the single source of truth lives in `wasm/voxel-mesher/src/svo.rs` — there is no JS fallback, and `initVoxelCodec()` is awaited at app startup in `index.tsx`), `VoxelTerrainUtils` (surface height, resolution), `VoxelTerrainIndex` (spatial index), `VoxelBitsetUtils`
- `editor/` — `VoxelTerrainEditorUtils`, `VoxelStampUtils`, `VoxelTerrainSelectionUtils`
- `import/` — `VoxImportUtils`
- `movement/` — `VoxelMovementUtilities` (Dijkstra with climbing costs), `VoxelMovementAdjacency`
- `palette/` — `TerrainPaletteUtils` (240-color OKLch palette)
- `raycast/` — `VoxelRaycast` (Amanatides & Woo DDA, reads from occupancy bitset or `VoxelTerrainIndex`)

### FormWrapper (`src/components/Form/`)

Generic CRUD form container. Detects mode (create/edit/view) from route context, provides `FormContext` with readOnly state and dirty tracking, and renders Save/Cancel/Clone/Delete controls based on the user's role permissions.

### IndexView (`src/components/IndexView/`)

Paginated table/list for browsing domain collections. Supports search, folder navigation (via tag-based paths), bulk tag operations, selection actions, and per-item action menus. View mode persists to localStorage.

### CollectionView (`src/components/CollectionView/`)

Grid/list toggle for displaying rich items (with images, badges, descriptions, action menus). Used for inventory, skills, statuses, equipment, and similar slot-based collections.

### Input Components (`src/components/inputs/`)

Specialized editors: `ImagePicker`, `ImageUpload`, `ImageGenerator` (AI image generation), `ActorPicker`, `ObjectPicker`, `ImpersonationPicker`, `TagEditor`, `StatDefinitionEditor`, `StatCostEditor`, `StatOverridesEditor`, `ActionDefinitionEditor`, `ActionCostEditor`, `AttributeDefinitionEditor`, `AttributeEditor`, `InitiativeSettingsEditor`, `CalendarConfigEditor`, `VoxelTerrainEditor`, `MovementSettingsEditor`, `RestoreRuleEditor`, `SharedInventoriesEditor`, `SecretModeToggle`.

`VoxelTerrainEditor` has two modes: **Normal** (tactical-tile paint/raise/lower/set via a 2D orthographic grid view) and **Sculpt** (voxel-level brush with shape, size, and depth range controls); supports 50-step undo history.

## Networking Details

Trystero strategy: **Nostr** (root `trystero` package defaults to Nostr in 0.24+). App ID: `'quest-net'`. Room codes are max 32 characters; anything longer is treated as a DM GUID. Action name limit: **32 bytes** (increased from 12 in pre-0.23).

Trystero channels: `actionReq`, `stateSync`, `actorPose`, `userReq`, `userUpdate`, `terrainDelta` (message actions), plus `imgFetch`, `imgUpload`, `terrainFetch` (`kind: "request"` request/response actions — the player's `request()` targets the DM's peerId, resolved via `ActionService.getDmPeerId()`, and the DM serves the response from its `onRequest` handler). Trystero owns request/response correlation, per-request timeouts, and binary chunking.

`terrainDelta` is the **bandwidth-optimization** counterpart to `terrainFetch`, and both live in the same `TerrainTransferService`: on a terrain voxel edit the DM broadcasts only the changed voxels, and players holding the matching base payload reconstruct the new SVO locally instead of re-pulling the full multi-MB payload. It is purely additive — a missing, inapplicable, or hash-mismatched delta falls through to the always-correct `terrainFetch` full fetch. Both halves install hooks on the networking-free `TerrainStorageService` (`setNetworkProvider` / `setDeltaBroadcaster` / `setDeltaWaiter`); a short grace window (`setDeltaWaiter`) lets an in-flight delta beat the `ContentHash` state-sync patch before a full fetch is issued. Codec: `src/utils/terrain/data/VoxelTerrainDeltaUtils.ts`.

Initial peer identity is exchanged via the `onPeerHandshake` callback (passed to `joinRoom` in `CampaignView`). Runtime user updates flow through `userUpdate`; missing metadata is repaired via `userReq`.

Connection recovery has three layers. **`useAutoReconnect`** recycles the room (leave + rejoin) when *this* peer loses all of its connections (peer loss, browser sleep/wake) — gated on 0 peers. **`useRelayWatchdog`** (DM-only) forces a full leave + rejoin when a Nostr relay socket closes: Trystero 0.25.1 auto-resubscribes on a real reconnect but has no liveness check for silently-dead sockets, and a DM with players never hits 0 peers, so this watchdog is what keeps a long-lived DM room discoverable to new joiners. **Ping-failure eviction** in `ActionService` force-closes a peer's `RTCPeerConnection` after repeated ping timeouts, so Trystero reaps phantom peers (uncleanly-dropped connections that never fired a close event).

See `src/DEVELOPMENT_NOTES.md` for full networking constraints and implementation details.

## Services (`src/services/`)

- **Actions/** — `ActionRegistry.ts`, `ActionService.ts`, `ActionServiceProvider.tsx` — the action dispatch system
- **StateSync.ts** — delta/full-state broadcast to peers
- **ImageService.ts** — IndexedDB image storage and peer transfer
- **ImageGenerationService.ts** + `imageGenerationProviders/` — AI image generation (Google Gemini Flash, OpenAI GPT-Image, Flux2Pro, Kling)
- **TerrainStorageService.ts** — stores large voxel data blobs in IndexedDB separately from the campaign object
- **ActorPoseService.ts** — live actor pose overrides (synced via `actorPose` channel)
- **CampaignLoadingService.ts** — campaign load/save orchestration
- **SoundEffectService.ts** — sound effect playback

## Build & Deploy

```bash
npm run dev       # Local dev server (port 3000)
npm run build     # tsc && vite build -> build/
npm run preview   # Preview the production build locally
npm run deploy    # GitHub Pages (master branch)
npm run deploy:beta
npm run deploy:2.0
```

## Conventions

- Domain files live together: model, actions, and UI components for each domain
- All state mutations flow through the action registry — never mutate campaign state directly in components
- When changing mutable campaign collections or memoized campaign-derived arrays, update `ActionService.bumpCampaignRefs()` if the new/changed reference must invalidate React memo/effect dependencies after an action
- Role permissions are checked via `canPerformAction(user, actionKey)`
- Images are always metadata-in-campaign, binary-in-IndexedDB
- Large terrain voxel data is always stored in IndexedDB via `TerrainStorageService`; never embed large `Voxels` strings directly in the campaign object or localStorage
- Tags double as folder paths for hierarchical organization (via FolderUtils)
- Dice notation follows D&D conventions: `2d6`, `1d20+5`, `2d20kh1` (keep highest), etc.

## File Placement

Keep these rules consistent — splitting a concept across folders is what breeds duplicated/colliding helpers.

**Naming by responsibility** (within a domain folder):
- `XxxActions.ts` — ONLY registered `ACTION_REGISTRY` handlers (what the action system / scripting engine dispatches). No plain helpers live here.
- `XxxUtils.ts` — pure helpers/math used by actions or UI.
- `XxxService.ts` — stateful/side-effecting lifecycle (load/save/connect/join), not registry handlers.

**Utils — decide by dependency direction:**
- Imports a domain model (`Actor`, `Campaign`, `CampaignSetting`, `VoxelTerrain`, …) and is only meaningful for that domain → `src/domains/<Domain>/`.
- Pure/generic with zero domain imports (base64, IndexedDB, localStorage, URL, folders, dice, compression, camera math, color) → `src/utils/`.

**UI:**
- Whole pages/layouts/views for a single domain (`Edit`, `Index`, `Display`, `Collection`, the `Main/*` panels) → `src/domains/<Domain>/`.
- Reusable, presentation-only, or used by 2+ domains (the `ui/` primitives, `inputs/` editors, `IndexView`/`CollectionView` shells) → `src/components/`. Tiebreaker: dispatches actions / bound to one domain → domain page; takes props and renders → reusable component.

Avoid duplicate/colliding filenames across folders (e.g. two `VoxelTerrainUtils.ts`) — they make imports ambiguous and invite copy-paste drift. The wiki (pure documentation) lives at `src/wiki/`, not under `src/domains/`.
