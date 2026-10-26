# Test kit

A ready-made campaign plus a harness that runs one DM and N players, each in its
own isolated browser context, so multiplayer behaviour can be exercised from a
script.

```
node test-kit/run.mjs test-kit/scenarios/smoke.mjs   # run a scenario, exit 0/1 (~10s)
node test-kit/run.mjs --serve --players 3            # keep a live session up
node test-kit/send.mjs "return kit.dm.state(c => c.Name)"   # drive the live session
node test-kit/run.mjs --seed                         # rebuild kitchen-sink.json
```

Scenarios live in `test-kit/scenarios/`; `new-campaign-terrains.mjs` (run with
`--players 0`) guards new and restored campaigns keeping their terrain voxels,
`owned-actors.mjs` covers owned actors, `script-scope.mjs` (`--players 0`)
covers script `Scope` and the 3.2.0 migration, `inspect-tab.mjs` clicks the real
Party/Overview panels to guard the first inspect landing on the Inspector tab,
`spawn-displacement.mjs` (`--players 0`) guards an actor bumped by a spawn
landing beside it rather than at the map center,
`qvx-import.mjs` (`--players 0`) checks the `.qvx` reader and imports one
through the terrain editor's Import button,
`late-join.mjs` (~2 min) guards players reaching a DM who has sat alone in
the room for over a minute, and `pose-room.mjs` checks live poses reach every
peer.
A scenario can `export const options`
for `startKit`, e.g. `{ characters: ["Beast Tamer", null] }` to choose which
character each player claims (`null` leaves that player on character select).
Add `--headed` to watch the browsers and `--verbose` to print every console line.
Screenshots land in `test-kit/out/` (gitignored).

## How it works

- **Isolation.** All app state is per browser origin (localStorage
  `quest-net-context`, IndexedDB `quest-net-db`, OPFS terrains), so two tabs
  are the *same* person. Each peer gets its own Playwright `BrowserContext`.
- **Browser.** Uses the installed Chrome (`channel: "chrome"`), so no Playwright
  browser download is needed.
- **Server.** Its own Vite dev server on port 3100, so it never collides with
  `npm run dev`.
- **Signaling.** `relay.mjs` is a tiny in-memory Nostr relay on `ws://localhost:7777`.
  The app picks it up via `VITE_RELAY_URLS` (see `RoomService.ts`); unset, the
  app uses Trystero's public relays as normal. `node test-kit/relay.mjs --self-test`
  checks it.
- **Fixture.** `kitchen-sink.json` is a normal campaign export
  (`CampaignExportData`). It is restored in `replace` mode under a fixed Id, so
  the URLs never change:
  - DM: `#/00000000-0000-4000-8000-00000000c0de`
  - players: `#/testkit`

  Player *i* claims `GameState.Characters[i]` before joining. Old fixture files
  keep loading because restore runs the campaign migrations.
- **Dev hook.** In dev builds `window.__qnActionService` is the mounted
  `ActionService`. Everything else is reached by importing the app's own modules
  (`/src/...`), which Vite serves as the same instances the app uses.

## Fixture contents

| Area | What the seed creates |
|---|---|
| Party | Aria (Wizard), Borin (Fighter), Cyra (Rogue), spawned on Forest Clearing. Dorn is benched in the roster. |
| Entities | 2 goblins and a dire wolf in the forest; a **hidden** goblin in the cellar; a potion dropped on the ground. |
| Terrains | Forest Clearing (24×24: hill, pond, stone wall, crates, lava) and Old Cellar (12×12). A terrain link connects them. Also the default terrain and default stamps. |
| Templates | Items: potion (uses + dice), longsword (equipped by Borin), torch, cursed ring (script). Skills: Fireball, Second Wind. Statuses: Poisoned (script, 3 turns), Blessed. |
| Owned actors | Beast Tamer owns the Wolf template (one Wolf spawned, carrying a potion). Puppet Master owns the Puppet, an owned character. The Necromancer's "Raise Dead" skill script spawns a generic Skeleton owned by the caster. |
| Other | 14 images (tokens + scenes), 2 YouTube audio tracks, environment and focus scene images, attribute definitions, a shared inventory, calendar day 3, a note, a sticker, a dice roll, log history, and the "Opening positions" scenario. |

Combat is **off** in the fixture, so scenarios can start it.

## Writing a scenario

A scenario is `export default async (kit) => { ... }`. `kit.dm` and
`kit.players[i]` are `Peer`s:

| Call | What it does |
|---|---|
| `peer.act(key, params)` | Dispatch an `ACTION_REGISTRY` action as that person. Players go through the DM, like the real UI. |
| `peer.state(c => ...)` | Plain copy of that person's view of the active campaign. |
| `peer.waitFor(c => bool, { message })` | Poll that person's campaign until the predicate holds (20s default). |
| `peer.eval((qn, arg) => ..., arg)` | Run arbitrary code in the page. `qn` has `import`, `ctx` (contextStore), `campaign`, `actions` and `plain`. |
| `peer.shot(label)` | Screenshot to `test-kit/out/<label>-<peer>.png`. |
| `peer.page` | The raw Playwright page, for clicking real UI. |
| `peer.logs` | Console lines captured from that page. |

Functions passed to `state`, `waitFor` and `eval` are serialized into the
page, so they cannot close over Node variables. Pass data through `arg`
instead.

Notes:

- Hidden actors *are* synced to players by design. The UI hides or redacts them.
- Headless WebGL is software-rendered: fine for layout and visibility checks,
  not for judging visual quality or performance.
