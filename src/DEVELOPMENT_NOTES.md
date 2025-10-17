# Development Notes - Quest Net

## Trystero / Multiplayer

### Key Constraints
- **Action name limit**: 12 bytes max for `makeAction()` names
  - "actionRequest" fails → use "actionReq" (9 bytes)
  - Keep all action names short

- **Single callback per event**: Trystero only allows ONE callback per event type
  - Calling `onPeerJoin()` multiple times overwrites previous handlers
  - Solution: Centralize event handling in ActionService, expose methods for external callbacks
  - Example: `setOnPeerJoin()` allows App.tsx to register while ActionService maintains control

### Current Implementation

- **Strategy**: MQTT (imported from `trystero/mqtt`)
- **App ID**: Hardcoded as `'quest-net'`
- **Room code**: Max 32 characters (anything longer is treated as GUID for DM)

### Architecture

- **DM = Authority**: Processes all actions and broadcasts state
- **Players = Requesters**: Send action requests to DM via `actionReq` channel
- **Initial state**: DM auto-sends campaign on `onPeerJoin`

## TODO / Future
