# Weblink — Architecture & Directory Guide

Weblink is a SolidJS + TypeScript (strict) WebRTC chat /
file-transfer app. The UI is intentionally kept thin:
components should talk to app state/services via stable
interfaces, while WebRTC/session/transfer details live in
the low-level `core` layer.

## Top-level layout

- `src/`: Frontend application code (SolidJS).
- `public/`: Static assets served as-is.
- `docker/`: Nginx template + entrypoint scripts used by
  the Docker image.
- `test/`: Vitest unit tests.
- `scripts/`: Repo scripts (clean/build helpers).
- `weblink-ws-server/`: Optional Bun WebSocket signaling
  server (separate project).

## `src/` layout

### UI

- `src/app.tsx`: Application shell (providers, global UI,
  dialogs).
- `src/routes/`: Route-level pages (Solid Router).
  - `src/routes/client/[id]/...`: Main client session pages
    (chat/sync, etc).
- `src/components/`: Reusable UI building blocks.
  - `components/app/`: app-scoped components (nav, about,
    wakelock, etc).
  - `components/dialogs/`: dialog primitives (dialog/drawer)
    + app dialogs.
  - `components/ui/`: shared UI primitives (buttons, inputs,
    popovers, etc).

### Application logic

Most non-trivial logic lives in `src/libs/`:

- `src/libs/state/`: App state store and context provider.
  - `app-state.ts`: Shared store shape + setters.
  - `app-state-context.tsx`: The main UI-facing API surface
    (functions that UI calls).
- `src/libs/services/`: App-level orchestration.
  - `session-service.ts`: Creates/destroys `PeerSession`s,
    tracks client view data, wires event listeners.
  - `rtc-protocol.ts`: Higher-level protocol over data
    channels (request/response style).
  - `rtc-service.ts`, `transfer-service.ts`, etc: service
    helpers that bridge UI state ↔ core primitives.
- `src/libs/core/`: Low-level primitives.
  - `session.ts`: `PeerSession` (RTCPeerConnection lifecycle,
    negotiation/reconnect, channels).
  - `message.ts`: Message shapes + message store (chat + file
    transfer message state).
  - `file-sender.ts`, `file-receiver.ts`, `file-transfer-*`:
    Chunked transfer implementation.
  - `core/services/`: Signaling client implementations
    (e.g. Firebase/WebSocket).
- `src/libs/cache/`: IndexedDB/chunk cache utilities.
- `src/libs/hooks/`: Solid hooks used by UI.
- `src/libs/workers/`: Web Workers (e.g. compression).
- `src/libs/utils/`: Generic utilities.

## Data flow (high level)

1. UI components call functions from `AppStateContext`
   (`src/libs/state/app-state-context.tsx`).
2. Those functions delegate to app services
   (`src/libs/services/*`) and update `appState`
   (`src/libs/state/app-state.ts`).
3. Services create/manage core primitives (`src/libs/core/*`),
   attach listeners, and translate low-level events into
   app-level state updates.

## Design conventions

- Keep WebRTC details in `src/libs/core`. Prefer exposing
  app-level methods from `AppStateContext` over constructing
  protocol/message objects inside UI.
- Prefer `AbortController` for listener lifetimes; avoid
  leaked intervals/listeners.
- Prefer explicit types at module boundaries (protocols,
  context APIs, service interfaces).
