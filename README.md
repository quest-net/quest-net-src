# Quest-Net

Quest-Net is a real-time collaborative tabletop RPG manager for DMs and players. It brings campaign prep, live play, peer-to-peer sessions, 3D voxel maps, character sheets, combat tools, dice, images, scenes, audio, and world rules into one browser app.

<p align="center">
  <img src="docs/screenshots/01-main-world-view.png" alt="Quest-Net DM world view with a voxel terrain and session controls" width="900">
</p>

## Highlights

- **DM-as-authority multiplayer:** players join by room code while the DM owns the canonical campaign state.
- **3D voxel tabletop:** run encounters in an isometric world view, switch into first-person mode, highlight movement, place actors, and manage terrain-specific scenes.
- **Built-in campaign database:** manage characters, entities, items, skills, statuses, images, audio, scenarios, terrains, logs, and campaign settings.
- **Terrain creation tools:** paint voxel maps, import `.vox` models, use material palettes, add terrain links, and preview maps with actors.
- **Session tools:** roll dice formulas, track stats and action economy, run rests, manage calendar time, show scene art, and prep privately with secret mode.
- **Local-first asset storage:** image binaries and large terrain payloads are stored outside the main campaign state for practical browser persistence.

## Screenshots

### Play

| DM world view | Movement highlighting |
| --- | --- |
| <img src="docs/screenshots/01-main-world-view.png" alt="DM world view with terrain tab and actor controls" width="430"> | <img src="docs/screenshots/10-movement-highlight.png" alt="Movement highlight shown on a 3D terrain" width="430"> |

| First-person mode | Scene display |
| --- | --- |
| <img src="docs/screenshots/03-first-person-view.png" alt="First-person character point of view on terrain" width="430"> | <img src="docs/screenshots/08-scene-display.png" alt="Scene artwork displayed over the active map" width="430"> |

| Dice roller | Campaign setup |
| --- | --- |
| <img src="docs/screenshots/02-dice-roller-formula.png" alt="Dice roller with several dice and formula results" width="430"> | <img src="docs/screenshots/11-campaigns-list.png" alt="Campaign creation form and campaign list" width="430"> |

### Build

| Terrain editor | Campaign settings |
| --- | --- |
| <img src="docs/screenshots/04-terrain-editor.png" alt="Voxel terrain editor with cathedral terrain and palette" width="430"> | <img src="docs/screenshots/06-campaign-settings-stats-actions.png" alt="Campaign settings for stats, actions, and attributes" width="430"> |

| Items | Entities |
| --- | --- |
| <img src="docs/screenshots/05-items-tab.png" alt="Item templates grid with images and spawn actions" width="430"> | <img src="docs/screenshots/09-entities-tab.png" alt="Entity templates grid with illustrated entities" width="430"> |

| Image library | Home |
| --- | --- |
| <img src="docs/screenshots/07-images-tab.png" alt="Campaign image library with upload drop zone and thumbnails" width="430"> | <img src="docs/screenshots/12-homepage.png" alt="Quest-Net homepage with animated title" width="430"> |

## Tech Stack

- React 19, TypeScript, React Router, and Vite
- Tailwind CSS 4 and DaisyUI 5
- Three.js for voxel terrain, world view, and first-person rendering
- Trystero for peer-to-peer networking
- IndexedDB and OPFS-backed storage for images and terrain payloads
- fast-json-patch for state deltas
- mathjs for dice and formula evaluation

## Quick Start

```bash
npm install
npm run dev
```

The dev server runs at `http://localhost:3000/`.

## Useful Scripts

```bash
npm run dev       # Start the local Vite dev server
npm run build     # Type-check and build for production
npm run preview   # Preview the production build locally
```

## Project Layout

```text
src/
  components/     Reusable UI, map, dice, form, and input components
  domains/        Campaign, character, entity, terrain, combat, item, audio, and other feature domains
  services/       Action dispatch, sync, storage, image, terrain, audio, and scripting services
  hooks/          Peer tracking, reconnect, relay watchdog, and UI hooks
  utils/          Dice, terrain, storage, migration, folder, math, and parsing utilities
  migrations/     Versioned context and campaign migrations
  wiki/           In-app documentation pages
```

## Documentation

Quest-Net includes an in-app wiki covering campaign setup, networking, combat, terrains, scripting, data structures, and DM/player workflows. Development-specific notes live in `src/DEVELOPMENT_NOTES.md`.
