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
`qvx-import.mjs` (`--players 0`) checks the `.qvx` reader and round-trips one
through the terrain editor's Import and Export buttons,
`ux-fixes.mjs` (`--players 0`) clicks the DM Overview (single click selects,
double click inspects) and gives an item and a skill from two Give-dialog tabs
at once, `late-join.mjs` (~2 min) guards players reaching a DM who has sat alone in
the room for over a minute, `pose-room.mjs` checks live poses reach every
peer, `walk-trial.mjs` walks in first person and follow with real input,
`stress.mjs` is the movement stress test (see below), `move-revert.mjs`
guards a DM broadcast that predates a player's move not
bouncing that move back, `state-order.mjs --race` guards state updates
being applied in the order the DM sent them, and `pose-stall.mjs` guards a
walker whose poses stall mid-walk holding on other screens instead of sliding
back. `fire-look.mjs` (`--players 0`) paints fire into Forest Clearing and
screenshots it by day and night, close up and from low cameras, with tokens
in front of and behind the flames (look check only, no asserts).
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

## Stress testing movement

`scenarios/stress.mjs` has every player move at once and records visible
jumps on every peer. See the header of that file for its flags.

```
node test-kit/run.mjs test-kit/scenarios/stress.mjs --players 6 --chaos --net bad --split
node test-kit/run.mjs test-kit/scenarios/stress.mjs --players 4 --seconds 20 --self-check
```

The tools live in `stress.mjs`:

- **Walkers** (first person, follow) hold the right button and W. They turn
  25-75° at a time, spread over frames like a real mouse, and pause now and
  then so the body settles and commits. Real controls only work while the
  pointer is locked, so `kit.mjs` fakes the Pointer Lock API in every peer.
- **Click movers** (ortho, perspective) dispatch the same `actor:move` a map
  click does, 1-3 tiles every 2-3.5s.
- **Chaos** (DM): spawn/despawn goblins on both terrains, move NPCs (sometimes
  to the other terrain), statuses, combat rounds (fires the Poisoned and Cursed
  Ring scripts), Raise Dead, dice rolls.
- **Network impairment** delays a peer's poses, state sync and action
  requests, in order, with jitter and occasional stalls. Trystero channels are
  reliable, so a stall holds traffic back instead of dropping it.
- **Recorder** reads where tokens, the camera and the walker's own body are
  drawn each frame, through dev-only hooks (`window.__qnActorLayer`,
  `window.__qnMapController`). It flags `snap` (more than 0.75 tile in one
  frame), `backtrack` (out and back more than 0.75 tile within 1s, returning
  faster than walking speed), `bodySnap`/`bodyBacktrack` for the walker's own
  capsule, and `cameraSnap`. Each jump comes with the events before it: poses,
  state updates, commits, sends, live-pose start/end, long frames.

`node test-kit/matrix.mjs` runs 12 configurations (calm/chaos × clean/mild/bad
network × one terrain/split, 6 players), then `node test-kit/analyze.mjs`
sorts every flag into a likely cause: revert, pose expiry, walker body, DM move,
other.

Reports land in `test-kit/out/stress-<label>.json`. `--self-check` proves that
the recorder catches a real reset and an injected jump. A DM move of a
character that is *still walking* doesn't count as a check: the walker's next
commit overrides it.

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
