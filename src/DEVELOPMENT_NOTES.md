# Development Notes - Quest Net

## Trystero / Multiplayer

### Key Constraints
- **Action name limit**: 32 bytes max for `makeAction()` names (was 12 bytes pre-0.23)

- **Single callback per event**: Trystero only allows ONE callback per event type
  - Calling `onPeerJoin()` multiple times overwrites previous handlers
  - In 0.23+ a freshly-registered `onPeerJoin` callback immediately replays
    already-active peers, so subscription order is less fragile than it used
    to be — but the "last call wins" rule still holds for action receivers.
  - Solution: keep room-level events centralized in `ActionService`.

### Current Implementation

- **Strategy**: Nostr (root `trystero` package, defaults to Nostr in 0.24+)
- **App ID**: Hardcoded as `'quest-net'`
- **Room code**: Max 32 characters (anything longer is treated as GUID for DM)

### Architecture

- **DM = Authority**: Processes all actions and broadcasts state
- **Players = Requesters**: Send action requests to DM via `actionReq` channel
- **Initial peer state**: `User` payloads are exchanged via `onPeerHandshake`
  (passed to `joinRoom` callbacks in `CampaignView`). Peers are NOT visible
  to `getPeers()`, `onPeerJoin`, or any action receiver until their handshake
  succeeds. Runtime presence is therefore tracked from Trystero's active peer
  map (`ActionService.connectedPeerIds`), while `ActionService.peerUsers`
  remains optional display metadata.
- **Runtime user updates**: After handshake, character selection changes
  flow through the small `userUpdate` action (`ActionService.broadcastSelf`).
  Missing metadata is repaired with the `userReq` action.
- **Initial campaign state**: DM auto-broadcasts the full campaign on
  `onPeerJoin` so newly admitted players catch up immediately.

### Connection error surface

- `onJoinError` is wired in `CampaignView`. While the player is in the
  `waiting-for-dm` state (no campaign yet), a join failure is converted into
  a hard error with the underlying message. After `ready`, peer-level join
  failures are treated as transient and `useAutoReconnect` handles them.

### Known Trystero bug: REQ subscriptions lost on relay WebSocket reconnect

**Symptom**: The DM can maintain existing player connections indefinitely but
new players cannot join after some indeterminate time. DM page refresh fixes
it. Players already in the room are completely unaffected.

**Root cause** (traced to `@trystero-p2p/nostr`): Trystero's Nostr strategy
sends `REQ` subscription messages to each relay WebSocket exactly once, at
`joinRoom()` time (`strategy.subscribe()` call). When a relay WebSocket closes
and reconnects (via Trystero's own `socket.onclose → init()` handler), a fresh
`WebSocket` is assigned to `client.socket` but the REQ messages are **never
re-sent**. The relay gets a live connection with zero active subscriptions and
delivers no signaling to the DM. Because existing `RTCPeerConnection` objects
are fully peer-to-peer after ICE negotiation and never touch the relay again,
all current players remain connected and functional.

Trystero also has no WebSocket heartbeat or keepalive: it only attempts
reconnect after `onclose` fires. If a NAT or firewall silently kills the idle
TCP connection, `readyState` stays `1` (OPEN) but all sends are dropped
silently. However, the subscription-loss-on-reconnect case above is the more
common failure mode in practice.

**Workaround** (`useRelayWatchdog`): Trystero exports `getRelaySockets()`,
which returns the current `client.socket` for each relay URL at call time.
`useRelayWatchdog` (DM-only) attaches `close` event listeners to these
sockets. When a socket closes unexpectedly, a `leave()` + `joinRoom()` recovery
is triggered after a short debounce (2 s). This re-establishes all relay
clients and re-sends the REQ subscriptions. Existing players reconnect
automatically via their own `useAutoReconnect` within ~10–20 s; the DM
broadcasts full state on each `onPeerJoin` so they catch up immediately.

A 15-second cooldown on recovery prevents the deliberate `leave()` call's own
socket close events from triggering a second cycle.

**Proper fix**: A Trystero PR that re-sends REQ subscriptions inside
`makeSocket`'s `onclose → init()` handler would eliminate the need for this
workaround entirely.

## Image Handling

### Architecture

Images use a **DM-as-central-authority** model for consistency with the app's overall design.

- **Storage**: All image binary data stored in IndexedDB (never in Campaign object)
- **References**: Campaign.Images[] contains only metadata (Id, Name, FileSize, MimeType, Width, Height)
- **Distribution**: DM serves as the image library; players request images on-demand

### Image Constraints

- **Max file size**: 1 MB (hard limit, enforced after compression)
- **Max dimensions**: 2048px (width or height)
- **Formats**: 
  - JPEGs and other static formats → converted to JPEG at 0.85 quality
  - GIFs → preserved with animation, but must meet size/dimension limits
- **Compression**: Automatic on upload, client-side using Canvas API
