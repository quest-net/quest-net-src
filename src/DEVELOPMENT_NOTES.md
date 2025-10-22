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