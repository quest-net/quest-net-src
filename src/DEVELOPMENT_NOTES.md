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

### Connection recovery: a slow link is not a dead link

The governing rule here, learned the hard way. Detecting a degraded connection
is cheap and safe; automatically tearing one down is neither. Three mechanisms
that force-closed connections were removed because each fired against links that
were still working — on a weak connection everything looks slow, and the teardown
loops made sessions strictly worse the worse the network got.

**Peer liveness is Trystero's job** (`onPeerJoin` / `onPeerLeave` /
`getPeers()`), re-synced by `reconcilePeerConnections` every 2s.

What we still do:

- `useAutoReconnect` recycles the room at **0 peers** only — the one case where
  a leave+rejoin has nothing to lose. Also covers browser sleep/wake.
- Pings are **display-only** (RTT in `PeerStatus`); a missed pong does nothing.
- The half-joined state (peers but no DM) is **surfaced, not acted on**:
  `usePeerTracking` reports `online` / `partial` / `connected`, and green is
  reserved for a reachable DM.

What was removed, and why it must not come back in the same shape:

- **Ping-based eviction.** 3 pings over a 2.5s timeout force-closed the peer.
  But Trystero's `ping` is an ordinary action on the *same single
  reliable-ordered data channel* as multi-MB terrain/image transfers, so any
  large send starved the pings and killed a healthy peer mid-transfer; the
  reconnect re-triggered the same fetch and looped. The tell was live actor
  poses still arriving from peers we'd declared dead. If phantom peers return,
  use a signal bulk traffic can't starve (`RTCPeerConnection.connectionState`,
  or a draining `bufferedAmount`) — never a timeout on the congested channel.
- **`useRelayWatchdog`.** Fired a full room teardown on relay socket `close`.
  But `close` is exactly what Trystero already recovers from (`socket.onclose` →
  backoff reconnect → `onopen` → re-subscribe), while the silently-dead socket
  it was written for stays at `readyState === 1` and never emits `close`. So it
  only ever caught recoverable blips and answered them by dropping every peer.
  If a long-lived DM room goes silently unjoinable to *new* peers, the fix is a
  quorum check plus a real liveness probe, not a close listener.
- **`requireDmConnection`.** Made players recycle when the DM was unreachable.
  `getDmPeerId()` is undefined until the handshake lands, so a slow DM read as
  "no DM" and every player tore down their room every ~20s, starving the very
  link they were waiting for.

### Relay warning suppression

`RoomService` passes `relayConfig.warnOnRelayFailure` (Trystero 0.25.3+), set to
`import.meta.env.DEV`. Public Nostr relays routinely emit NOTICE / non-OK
responses and failed announces, none of it actionable at runtime.

**Debugging note:** a production build therefore logs *no* Trystero relay
warnings. Flip `WARN_ON_RELAY_FAILURE` in `RoomService.ts` or reproduce in dev.

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
