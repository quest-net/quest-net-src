# Quest-Net

Quest-Net is a real-time collaborative TTRPG (tabletop role-playing game) manager built with React, TypeScript, and Vite. It enables a DM and players to connect peer-to-peer via Trystero (WebRTC/MQTT) and run game sessions with an isometric map, character management, combat, dice rolling, and more.

## Tech Stack

- **React 19** with **TypeScript** (strict mode) and **React Router** (HashRouter)
- **Vite** for build/dev
- **Tailwind CSS** + **DaisyUI** for styling
- **Pixi.js** (`@pixi/react`) for the isometric WebGL map (legacy — being replaced by 3DMap)
- **Three.js** (`three@0.180`) for the new voxel-based 3D map (`3DMap.tsx`). Core imports: `import * as THREE from 'three'`. Addon imports (OrbitControls etc.) use `three/examples/jsm/`, **not** `three/addons/` — the `addons/` directory does not physically exist in the installed version even though it appears in the package exports map. Example: `import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'`. Use `MeshStandardMaterial` (not `MeshLambertMaterial`) for voxels — Lambert is legacy and unreliable with InstancedMesh vertex colors in r180. **Do not use Unicode box-drawing characters (e.g. `──`) in comments inside `3DMap.tsx`** — they cause the Write tool to truncate the file silently; use plain ASCII `--` instead.
- **Trystero** for peer-to-peer networking (MQTT strategy, app ID `'quest-net'`)
- **fast-json-patch** for delta state synchronization
- **mathjs** for dice/formula evaluation
- **IndexedDB** for image binary storage; **localStorage** for app state

## Architecture Overview

### DM-as-Authority Model

The DM holds the canonical game state. Players send action requests over Trystero channels; the DM validates permissions, applies mutations, and broadcasts state updates. Players may apply optimistic updates locally, but the DM's broadcast is authoritative.

### State Management

A single `Context` object (User, Campaigns[], AppSettings) lives in React context and is persisted to localStorage. `triggerContextUpdate()` forces re-renders globally. Images are stored separately in IndexedDB and exchanged over dedicated Trystero channels.

### Action System (Command Pattern)

All state mutations go through `ACTION_REGISTRY` — a map of `"domain:action"` keys to handlers with role-based permissions. `ActionService.execute()` dispatches locally for the DM or sends a request to the DM for players. This pattern enables permission checks, logging, and network serialization in one place.

### State Sync

`StateSync` broadcasts campaign state to peers using delta patches (fast-json-patch). A full-state fallback fires periodically or on desync detection. The DM's secret `Campaign.Id` is replaced with the public `RoomCode` before broadcast to players.

### Migration System

Versioned migrations in `src/updates/` transform saved Context objects across schema changes. On migration failure, backups are written to localStorage. Legacy v1 save imports are also supported.

## Project Structure

```
src/
├── components/         # Reusable UI components
│   ├── Form/           # FormWrapper, FormContext (CRUD forms)
│   ├── IndexView/      # Paginated table/list with search, folders, tags
│   ├── CollectionView/ # Grid/list display for items, skills, etc.
│   ├── Map/            # Isometric Pixi.js map (tokens, terrain, stickers)
│   └── inputs/         # Domain-specific inputs (ImagePicker, TagEditor, etc.)
├── domains/            # Feature domains (model + actions + UI per domain)
├── services/           # ActionService, StateSync, ImageService, SoundEffectService
├── hooks/              # usePeerTracking, useAutoReconnect, etc.
├── utils/              # DiceUtils, FolderUtils, TerrainUtils, LocalStorageUtilities, etc.
├── updates/            # Version migration scripts
└── legacy/             # V1 import support
```

## Domains

Each domain typically has a model file (`Domain.ts`), an actions file (`DomainActions.ts`), and optional UI components (Edit, Index, Display, Modal). Key domains include:

- **Campaign** — Root container; holds roster, templates, game state, settings, logs
- **Actor / Character / Entity** — Characters are player-controlled actors; Entities are NPCs/enemies. Both share the Actor base (stats, actions, inventory, equipment, skills, statuses, position)
- **GameState** — Live session state: active characters/entities, combat state, scene, terrain, audio, calendar
- **Item / Skill / Status** — Templates stored on the campaign; instances slotted onto actors
- **Terrain** — Isometric heightmap/colormap grid for the map
- **Scene** — Environment and focus images for the current encounter
- **Image** — Metadata in campaign, binary data in IndexedDB via ImageService
- **Audio** — Background music and sound effects
- **Log** — Categorized activity journal with visibility levels (dm/player/owner/all)
- **CampaignSetting** — Configurable stat definitions, action definitions, calendar, rest rules, movement costs, shared inventories
- **Combat** — Turn-based battle management (initiative, turn order)
- **Calendar** — In-world date/time tracking
- **Scenario** — Pre-built encounters
- **Note** — Character-level private notes
- **Room** — Trystero connection wrapper
- **Context / User** — Global app state and current user session

## Key Components

### Map (`src/components/Map/`)

Isometric WebGL renderer built on Pixi.js. Renders terrain tiles from a HeightMap/ColorMap grid, places actor tokens with animations, and supports pan/zoom/rotation. Key sub-pieces: `MapWorldLayer` (terrain rendering), `Token` (actor sprites), `Ladder` (height adjustment), `TerrainEditor` (tile painting). Hooks: `useMapState`, `useMapRotation`, `useMapPanZoom`, `useMapInteraction`, `useActorAnimations`, `useActiveStickers`.

### FormWrapper (`src/components/Form/`)

Generic CRUD form container. Detects mode (create/edit/view) from route context, provides `FormContext` with readOnly state and dirty tracking, and renders Save/Cancel/Clone/Delete controls based on the user's role permissions.

### IndexView (`src/components/IndexView/`)

Paginated table/list for browsing domain collections. Supports search, folder navigation (via tag-based paths), bulk tag operations, selection actions, and per-item action menus. View mode persists to localStorage.

### CollectionView (`src/components/CollectionView/`)

Grid/list toggle for displaying rich items (with images, badges, descriptions, action menus). Used for inventory, skills, statuses, equipment, and similar slot-based collections.

### Input Components (`src/components/inputs/`)

Specialized editors: `ImagePicker`, `ActorPicker`, `TagEditor`, `StatDefinitionEditor`, `ActionDefinitionEditor`, `TerrainEditor`, `CalendarConfigEditor`, `RestoreRuleEditor`, `MovementSettingsEditor`, and others.

## Networking Details

Trystero channels (max 12-byte names): `actionReq`, `stateSync`, `imgReq`, `imgData`, `imgUpload`, `imgCreated`. Room codes are max 32 characters; anything longer is treated as a DM GUID. See `README_trystero.md` and `src/DEVELOPMENT_NOTES.md` for constraints and implementation details.

## Build & Deploy

```bash
npm run dev       # Local dev server (port 3000)
npm run build     # tsc && vite build → build/
npm run deploy    # GitHub Pages (master branch)
npm run deploy:beta
npm run deploy:2.0
```

## Conventions

- Domain files live together: model, actions, and UI components for each domain
- All state mutations flow through the action registry — never mutate campaign state directly in components
- Role permissions are checked via `canPerformAction(user, actionKey)`
- Images are always metadata-in-campaign, binary-in-IndexedDB
- Tags double as folder paths for hierarchical organization (via FolderUtils)
- Dice notation follows D&D conventions: `2d6`, `1d20+5`, `2d20kh1` (keep highest), etc.
