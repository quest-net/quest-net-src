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

### Player half-joined recovery (`requireDmConnection`)

A player can mesh with the other players while the DM link never forms (or
silently drops). The room looks alive — several peers, pings flowing — but the
DM is the authority for every action, so nothing that player does reaches the
game and their state is frozen at whatever they last received.

This state used to be invisible on both sides:

- **UI**: `usePeerTracking` reported `connected` on any peer, so the badge went
  green and a half-joined player looked fully in the session. The status is now
  three-valued — `online` (no peers) / `partial` (peers, no DM) / `connected` —
  and green is reserved for a reachable DM (`isDmConnected`, trivially true for
  the DM). `PeerStatus` explains the `partial` case rather than just colouring it.
- **Recovery**: `useAutoReconnect` recycled at 0 peers, and this shape never
  hits 0 — so it never fired and the player stayed stuck indefinitely.
  `requireDmConnection` (set for player routes in `CampaignView`) makes "DM
  unreachable" count as unhealthy, so the room recycles here like any other
  disconnect. The DM has no DM to reach and keeps the peer-count signal.

Two deliberate details: the reconnect delay doubles as the handshake grace
window (`getDmPeerId()` is undefined until a peer's `User` payload lands, so an
in-flight handshake must not be read as "no DM"), and the `partial` case uses
the slower cold-start cadence rather than the fast path — the room is alive, and
each recycle also drops our links to the other players.

### DM signaling recovery (`useRelayWatchdog`)

The DM's discoverability depends on its relay subscriptions staying live: new
players announce over the relay, and the DM must be subscribed and announcing
to see them and offer a connection. Existing direct WebRTC channels are
unaffected when relay signaling degrades (they're peer-to-peer after ICE), so
the DM can keep its current players while silently becoming unreachable to new
joiners — **with no error anywhere**.

Trystero 0.25.1 reconnects relay sockets and re-sends `REQ` subscriptions
automatically *when a socket actually closes*, with capped/jittered backoff.
But it has **no liveness check**: `makeSocket` (in `@trystero-p2p/core`) only
reacts to `socket.onclose`, and a silently-dead socket stays `readyState === 1`
so sends are dropped with no error and no reconnect ever triggers. And on a DM
route `useAutoReconnect` only recycles at **0 peers**, which never happens while
the DM still has players. So neither covers a DM whose signaling degrades
mid-session.

`useRelayWatchdog` (DM-only) is the backstop: it listens for relay socket close
events via `getRelaySockets()` and, on one, forces a full `leave()` +
`joinRoom()` recovery — rebuilding every relay client, subscription, and offer
pool. This is the mechanism that keeps a long-lived DM room reliably joinable.
It re-attaches to fresh sockets after each recovery via `actionServiceSwapVersion`.

### Relay redundancy (partial-mesh experiment)

`RoomService` sets `relayConfig.redundancy` (see `RELAY_REDUNDANCY`). Trystero's
default is **5** relays out of a 47-relay pool, picked by a deterministic
shuffle seeded on `appId` — so every quest-net client, in every session, signals
through the *same* 5 relays. All peer discovery and offer/answer exchange rides
those sockets.

The hypothesis is that this is behind the stable partial meshes we see (DM
reachable by one player but not the rest). It matches the scale-dependence
reported upstream — [trystero#189](https://github.com/dmotz/trystero/discussions/189)
("split brain" past ~5 peers) and
[trystero#161](https://github.com/dmotz/trystero/issues/161) (partial meshes at
3+ members, "fixed by all parties refreshing a bunch of times") — better than
the NAT-traversal explanation does, since we already run TURN. More peers means
more announce traffic (~5.3s interval each) converging on the same fixed 5
relays, and public Nostr relays commonly rate-limit.

Raising the count is **strictly additive**: the shuffle is unchanged, so the
original 5 relays are still the first 5: we only ever add paths, never swap one
out. This is an experiment — if partial meshes persist, raise it; if the relay
connections themselves become the problem, lower it.

### Relay warning suppression

`RoomService` passes `relayConfig.warnOnRelayFailure` (Trystero 0.25.3+), set to
`import.meta.env.DEV`. Public Nostr relays routinely emit NOTICE / non-OK
responses and failed announces; none of it is actionable at runtime (our
recovery keys off socket closes and peer health, not these logs) and the volume
buries real errors over a long session.

**Debugging note:** this means a production build logs *no* Trystero relay
warnings. If you're diagnosing relay behaviour against a deployed build, flip
`WARN_ON_RELAY_FAILURE` in `RoomService.ts` or reproduce in dev.

### Phantom peer eviction (ping-failure based)

Trystero only drops a peer from `getPeers()` when its `RTCPeerConnection` fires
a close event. If a peer dies uncleanly (tab killed, laptop sleep, NAT drop) the
connection can silently die with no close event, leaving a **phantom peer** in
`getPeers()` indefinitely. That keeps peer count > 0, which blocks
`useAutoReconnect`'s peerless recovery and leaves stale presence in the UI.

`ActionService`'s per-peer ping loop guards this: each ping is raced against a
timeout (a silently-dead data channel never rejects on its own), and after a few
consecutive failures the peer's `RTCPeerConnection` is force-`close()`d. That
makes Trystero notice the close and reap the peer (firing `onPeerLeave` →
`forgetPeer`), so presence and peer count reflect reality.

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
