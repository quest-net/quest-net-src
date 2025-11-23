# Quest-Net Architecture Review

## Overview
This document provides a review of the core architecture of Quest-Net, focusing on the Campaign, Context, Room, Action Service, State Syncing, and Logging domains.

## 1. Core Domains (Campaign, Context, Room)

### Context (`src/domains/Context`)
- **Structure:** The `Context` interface acts as the global application state, persisting `User`, `Campaigns`, and `AppSettings` to `localStorage`.
- **Strengths:**
  - Simple and effective global state management.
  - Built-in migration system (`runMigrations`) ensures backward compatibility.
  - robust error handling in `load()` with automatic backup on failure.

### Campaign (`src/domains/Campaign`)
- **Structure:** The `Campaign` object is the monolithic root for a game session. It contains all game data (Roster, Items, GameState, Log).
- **Strengths:**
  - Centralized data model makes serialization/deserialization straightforward.
  - Separation of static templates (`ItemTemplates`) and dynamic state (`GameState`) is a good design choice.
- **Concerns:**
  - **Scalability:** As a single object, it may become a performance bottleneck if it grows too large (e.g., thousands of log entries or complex maps). `fast-json-patch` comparison time increases with object size.
  - **Image Handling:** Images are correctly offloaded to `IndexedDB`, keeping the main JSON payload lighter. This is a critical optimization.

### Room (`src/domains/Room`)
- **Structure:** Wraps `trystero/nostr` for peer-to-peer WebRTC connections.
- **Strengths:**
  - Clean abstraction over the networking library.
  - `RoomActions` provides a simple interface for joining/leaving and querying peers.

## 2. Action Service & State Syncing

### Action Service (`src/services/Actions`)
- **Pattern:** Uses a **Command Pattern** via `ACTION_REGISTRY` and `ActionService`.
- **Flow:**
  - **DM:** Executes locally -> Broadcasts update.
  - **Player:** Sends request -> DM Executes -> DM Broadcasts.
- **Strengths:**
  - **Single Source of Truth:** The DM is the authoritative state holder. This prevents state divergence.
  - **Role Security:** `canPerformAction` and `ACTION_REGISTRY` enforce role-based access control (RBAC).
  - **Extensibility:** Adding new actions is easy via the registry.
- **Concerns:**
  - **Reference Integrity:** `bumpMapRefs` is used to force React updates. This implies the state is being mutated in place. While efficient, it requires careful management to ensure React components re-render correctly.

### State Syncing (`src/services/StateSync.ts`)
- **Mechanism:** Uses `fast-json-patch` for delta updates and falls back to full state broadcasts.
- **Strengths:**
  - **Bandwidth Efficiency:** Delta updates significantly reduce network traffic.
  - **Desync Protection:** Version tracking (`baseVersion`) and automatic full-sync fallback handle network hiccups gracefully.
  - **Security:** `sanitizeForPlayers` correctly hides the DM's secret `Campaign.Id`, preventing players from hijacking the session.
- **Concerns:**
  - **Control Signals:** `triggerFullSyncRequest` uses the log channel (`/REQUEST_FULL_SYNC`). While clever, a dedicated control channel might be more robust and less likely to clutter logs (though visibility filtering handles the clutter).

## 3. Logging Domain (`src/domains/Log`)
- **Structure:** Structured logs with categories, levels, and visibility.
- **Strengths:**
  - **Granular Visibility:** The `Visibility` array (`['dm', 'player']`) allows for private DM logs and public player logs.
  - **Size Management:** `MAX_LOG_SIZE` prevents the log from growing indefinitely.
- **Concerns:**
  - **State Churn:** Since logs are part of the `Campaign` object, every log entry triggers a full state comparison and broadcast. For high-frequency events (e.g., rapid combat rolls), this could cause network congestion.

## Conclusion
The architecture is solid and well-suited for a TTRPG manager. The centralized DM authority combined with delta updates provides a good balance of consistency and performance. The code is clean, modular, and easy to navigate.
