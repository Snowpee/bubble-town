# Bubble Town

[中文 README](./README.zh-CN.md)

Bubble Town is a local-first Hermes client built as an npm workspace monorepo. It combines a React web UI, a Fastify Companion service, an Electron desktop shell, and a small shared contract package.

The project does not implement an independent model backend. Instead, it provides a stable desktop/web client layer around Hermes by managing a local Hermes gateway, normalizing profile and session data, and exposing a browser-friendly API for chat, streaming, settings, health checks, and profile management.

## Architecture Overview

```text
┌──────────────────────────────────────────────────────────────────┐
│ apps/desktop                                                     │
│ Electron main process + preload                                  │
│ - loads Vite dev server or packaged web dist                     │
│ - starts/reuses the local Companion service                      │
│ - exposes desktop metadata and theme IPC through preload         │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                │ http://127.0.0.1:3030
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ apps/web                                                         │
│ React + Vite client                                              │
│ - chat UI, session list, profile management, settings            │
│ - TanStack Query for server data                                 │
│ - Zustand for persisted workspace UI state                       │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                │ /api/*
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ apps/companion                                                   │
│ Local Fastify service                                            │
│ - owns the frontend-facing API                                   │
│ - manages Hermes profile switching and gateway lifecycle         │
│ - reads Hermes state.db, response_store.db, and session JSON      │
│ - proxies non-streaming and SSE streaming chat requests          │
└───────────────────────────────┬──────────────────────────────────┘
                                │
                                │ Hermes API Server / gateway
                                ▼
┌──────────────────────────────────────────────────────────────────┐
│ Hermes runtime under ~/.hermes or HERMES_HOME                    │
│ - profiles, config.yaml, sessions, state.db, response_store.db   │
└──────────────────────────────────────────────────────────────────┘
```

## Workspaces

| Workspace | Purpose | Important files |
| --- | --- | --- |
| `apps/web` | Browser-rendered client for chat, sessions, profiles, and settings | `src/App.tsx`, `src/routes/*`, `src/lib/api/*`, `src/lib/state/workspace-store.ts` |
| `apps/companion` | Local API service and Hermes integration layer | `src/server.ts`, `src/routes/*`, `src/services/*` |
| `apps/desktop` | Electron shell and macOS packaging target | `electron/main.ts`, `electron/preload.ts`, `package.json` build config |
| `packages/shared` | Shared TypeScript contracts used by Web and Companion | `src/chat.ts`, `src/session.ts`, `src/profile.ts`, `src/health.ts` |

## Tech Stack

- Runtime and workspace management: Node.js 22.12+, npm workspaces.
- Language: TypeScript 5.8 with strict compiler settings from `tsconfig.base.json`.
- Frontend: React 18, React Router 7, Vite 6, Tailwind CSS 4, Radix UI primitives, lucide-react, react-markdown.
- Frontend data/state: TanStack Query 5 for Companion API data, Zustand 5 with `localStorage` persistence for workspace UI state.
- Companion service: Fastify 5, `@fastify/cors`, Node built-in `fetch`, `child_process`, `node:sqlite`, and `yaml`.
- Desktop: Electron 42, Electron Builder 26.
- Tests: Vitest for the web workspace and Node's `tsx --test` runner for the Companion workspace.
- Build tooling: Vite for the web app, `tsc` + esbuild for Companion, `tsc` + electron-builder for Desktop.

## Runtime Model

Bubble Town has three supported runtime shapes:

1. Web + Companion development mode:
   - `npm run dev` starts `apps/web` on Vite and `apps/companion` on Fastify.
   - The browser calls the Companion service at `http://127.0.0.1:3030` by default.

2. LAN development mode:
   - `npm run dev:lan` starts both web and Companion on `0.0.0.0`.
   - When opened through a LAN hostname, the web client derives the Companion URL from the same host on port `3030`.

3. Desktop mode:
   - `npm run dev:all` starts web, Companion, and Electron together.
   - A packaged Electron app loads `apps/web/dist/index.html` and starts the bundled Companion CJS entry through Electron with `ELECTRON_RUN_AS_NODE=1`.

## Frontend Architecture

`apps/web` is a Vite SPA. `App.tsx` chooses `BrowserRouter` for HTTP URLs and `HashRouter` for packaged `file:` URLs, which lets the same route tree work in both browser and Electron builds.

Main routes:

| Route | Component | Responsibility |
| --- | --- | --- |
| `/chat` | `ChatRoute` | New chat flow, streaming responses, image attachments, chat mode selection, and cached session updates |
| `/chat/:sessionId` | `ChatRoute` | Existing session view and continuation |
| `/sessions` | `SessionsRoute` | Search, filter, inspect, bulk select, and delete sessions |
| `/profiles` | `ProfilesRoute` | Create, rename, delete, and switch Hermes profiles |
| `/settings` | `SettingsRoute` | Health checks, active profile selection, and chat protocol mode |

Client API helpers live in `apps/web/src/lib/api`:

- `client.ts` resolves `COMPANION_URL` in this order:
  1. `window.bubbleTownDesktop.companionUrl` from Electron preload.
  2. `VITE_COMPANION_URL`.
  3. the current browser hostname with port `3030`.
  4. `http://127.0.0.1:3030`.
- `hermes.ts` wraps health, sessions, deletion, non-streaming chat, and SSE streaming chat.
- `profiles.ts` wraps profile CRUD and profile switching.
- `profile-cache.ts` keeps TanStack Query profile cache entries coherent after switching profiles.

Persistent UI state is kept in `workspace-store.ts`:

- active profile id
- chat protocol mode: `responses` or `chat-completions`
- assistant message view mode: `bubble` or `document`
- sidebar collapsed state and width

The store intentionally does not persist transient mobile sidebar state.

## Companion Architecture

`apps/companion/src/server.ts` creates the Fastify app, registers CORS, mounts API route modules, acquires a single-instance Companion lock, starts the Hermes gateway for the active profile, and shuts managed resources down on Fastify close.

Default network settings:

| Variable | Default | Meaning |
| --- | --- | --- |
| `COMPANION_HOST` | `127.0.0.1` | Host for the Fastify Companion service |
| `COMPANION_PORT` | `3030` | Port for the Fastify Companion service |
| `HERMES_HOME` | `~/.hermes` | Hermes root directory |
| `HERMES_API_BASE_URL` | `http://127.0.0.1:8642/v1` | External Hermes API fallback when not using the managed gateway |
| `BUBBLE_TOWN_HERMES_HOST` | `127.0.0.1` | Managed Hermes gateway host |
| `BUBBLE_TOWN_HERMES_PORT` | `8643` | Preferred managed Hermes gateway port |
| `BUBBLE_TOWN_HERMES_API_KEY` | generated per process | Bearer key for managed gateway requests |
| `HERMES_BINARY` | auto-detected `hermes` | Optional explicit Hermes binary path |

### API Surface

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/ping` | Lightweight Companion readiness probe |
| `GET` | `/api/health` | Health status for gateway, Hermes root, and planned local-state checks |
| `GET` | `/api/config` | Runtime config, lock snapshot, and managed gateway snapshot |
| `GET` | `/api/profiles` | List Hermes profiles and active profile |
| `POST` | `/api/profiles` | Create a profile through `hermes profile create --clone --no-alias` |
| `PATCH` | `/api/profiles/:id` | Rename a profile through `hermes profile rename` |
| `DELETE` | `/api/profiles/:id` | Delete a profile through `hermes profile delete --yes` |
| `POST` | `/api/profiles/switch` | Ensure target gateway, switch active profile, return target sessions |
| `GET` | `/api/sessions?profileId=...` | List session summaries for a profile |
| `GET` | `/api/sessions/:id/summary?profileId=...` | Read one session summary |
| `GET` | `/api/sessions/:id?profileId=...` | Read normalized session detail |
| `DELETE` | `/api/sessions/:id?profileId=...` | Delete a session where supported |
| `POST` | `/api/chat/respond` | Non-streaming chat proxy |
| `POST` | `/api/chat/respond-stream` | SSE chat proxy with `message-start`, `message-delta`, `tool-progress`, `message-complete`, and `message-error` events |

### Hermes Gateway Management

`services/hermes-gateway.ts` owns the managed Hermes gateway lifecycle.

- It resolves the Hermes binary from `HERMES_BINARY`, `~/.local/bin/hermes`, Homebrew paths, or `hermes` on `PATH`.
- It starts Hermes with `hermes gateway run --replace --accept-hooks`.
- It injects `HERMES_HOME`, `API_SERVER_ENABLED=true`, `API_SERVER_HOST`, `API_SERVER_PORT`, and `API_SERVER_KEY`.
- It reserves the preferred port and falls back to an OS-assigned port when needed.
- It waits for `/health` before returning a gateway snapshot.
- It serializes gateway transitions so rapid profile switches cannot race each other.
- It keeps bounded stdout/stderr logs in memory for diagnostics.
- It stops all managed gateway processes when Companion shuts down.

`services/companion-lock.ts` writes `bubble-town-companion.lock.json` under the Hermes root. The lock prevents two Companion processes from binding the same local client role at once.

### Hermes Data Access

Hermes paths are centralized in `services/hermes-paths.ts`.

For the default profile, the profile home is `HERMES_HOME`. Named profiles live under `HERMES_HOME/profiles/<profileId>`.

Important files:

- `active_profile`: active Hermes profile id.
- `config.yaml`: runtime model and optional `agent.system_prompt`.
- `sessions/session_<sessionId>.json`: transcript JSON used by Bubble Town and Hermes-compatible flows.
- `state.db`: SQLite state database queried for sessions and messages.
- `response_store.db`: SQLite response store used to recover `responseId` and session identity.

`services/session-store.ts` normalizes data from SQLite rows, response store rows, and session JSON files into the shared `SessionSummary` and `SessionDetail` contracts. It also supports compatibility aliases such as `conversation` and `id` while treating `sessionId` as canonical.

### Chat Protocol Handling

`services/hermes-api.ts` supports two Hermes-facing modes:

- `responses`: sends requests to `/responses`, uses `previous_response_id` when available, stores responses, and supports image attachments as `input_image`.
- `chat-completions`: sends requests to `/chat/completions`, builds message history from the transcript or detail view, uses `X-Hermes-Session-Id` for continuation, and supports image attachments as `image_url`.

The Companion chooses `responses` by default, but it falls back to `chat-completions` when continuing older CLI-originated sessions that do not have a response chain.

For streaming, Companion consumes upstream SSE, normalizes upstream event variants, forwards user-facing events to the browser, collects deltas, tracks tool progress, and persists the completed turn when applicable.

## Desktop Architecture

`apps/desktop/electron/main.ts` is responsible for:

- writing diagnostic logs to Electron's logs path, with a Hermes-root fallback;
- reusing an already reachable Companion service when available;
- clearing stale Companion locks that point at the expected host and port;
- spawning the bundled Companion entry with Electron as Node in packaged mode;
- waiting for `/api/ping` before creating the window;
- loading the Vite dev server in development or packaged `web-dist/index.html` in production;
- creating a transparent/vibrant macOS window with hidden title bar controls;
- exposing a small native menu;
- stopping the child Companion process before quit.

`electron/preload.ts` exposes a constrained `window.bubbleTownDesktop` object:

- platform and Electron/Chromium/Node versions
- Companion URL
- titlebar layout reservations
- `setNativeThemeSource(theme)` IPC bridge

The renderer never gets Node integration. Electron is configured with `contextIsolation: true` and `nodeIntegration: false`.

## Shared Contracts

`packages/shared` exports all cross-workspace TypeScript contracts:

- `ChatRequest`, `ChatResponse`, streaming events, and image attachment types.
- `SessionSummary`, `SessionDetail`, `ChatMessage`, and tool progress events.
- `ProfileSummary`, `ProfilesResponse`, and profile mutation request types.
- `HealthResponse` and health item status types.

These contracts are consumed directly through the workspace dependency `@bubble-town/shared`.

## Repository Layout

```text
bubble-town/
├─ apps/
│  ├─ web/
│  │  ├─ src/routes/          # SPA route surfaces
│  │  ├─ src/components/      # layout, Hermes-specific, loading, and UI components
│  │  ├─ src/lib/api/         # Companion API client helpers
│  │  ├─ src/lib/state/       # persisted workspace state
│  │  └─ vite.config.ts
│  ├─ companion/
│  │  ├─ src/routes/          # Fastify route modules
│  │  ├─ src/services/        # Hermes integration, sessions, profiles, locking
│  │  ├─ src/server.ts
│  │  └─ src/standalone.ts
│  └─ desktop/
│     ├─ electron/main.ts
│     ├─ electron/preload.ts
│     └─ package.json         # electron-builder configuration
├─ packages/
│  └─ shared/src/             # shared TypeScript API contracts
├─ scripts/
│  └─ release-desktop.mjs
├─ package.json
├─ tsconfig.base.json
└─ pnpm-workspace.yaml
```

## Development

### Requirements

- Node.js 22.12+
- npm 10+
- Hermes CLI available on `PATH`, or set `HERMES_BINARY`.
- A usable Hermes home directory at `~/.hermes`, or set `HERMES_HOME`.

### Install

```bash
npm install
```

### Start Web + Companion

```bash
npm run dev
```

This starts:

- Vite web app on port `5173`
- Companion service on `127.0.0.1:3030`

### Start Web + Companion + Desktop

```bash
npm run dev:all
```

### Start LAN Mode

```bash
npm run dev:lan
```

This starts the web app and Companion on `0.0.0.0`. Open the Vite network URL printed in the terminal, for example:

```text
http://192.168.1.23:5173/
```

The frontend will call `http://192.168.1.23:3030` automatically.

## Common Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start `web + companion` |
| `npm run dev:lan` | Start `web + companion` for LAN access |
| `npm run dev:web` | Start only the web app |
| `npm run dev:web:lan` | Start only the web app for LAN access |
| `npm run dev:backend` | Start only the Companion service |
| `npm run dev:backend:lan` | Start only Companion for LAN access |
| `npm run dev:companion` | Alias for `dev:backend` |
| `npm run dev:desktop` | Start only the Electron shell |
| `npm run dev:all` | Start `web + companion + desktop` |
| `npm run check` | Run TypeScript checks across workspaces |
| `npm run test` | Run workspace tests |
| `npm run build` | Build all workspaces |
| `npm run package:desktop` | Build and package the desktop app |
| `npm run package:dir -w @bubble-town/desktop` | Build a local macOS `.app` directory with ad-hoc signing |
| `npm run package:zip -w @bubble-town/desktop` | Build a macOS arm64 `.zip` with ad-hoc signing |
| `npm run package:dmg -w @bubble-town/desktop` | Build a macOS arm64 `.dmg` with ad-hoc signing |
| `npm run release:desktop:dry-run` | Preview the desktop release command |
| `npm run release:desktop` | Build and publish macOS arm64 + x64 releases through GitHub CLI |

## Build And Packaging

```bash
npm run build
npm run package:desktop
```

Build behavior:

- `@bubble-town/web`: `tsc --noEmit && vite build`
- `@bubble-town/companion`: `tsc` plus esbuild bundle to `dist/server.cjs`
- `@bubble-town/desktop`: `tsc` for Electron sources, then electron-builder packaging
- `@bubble-town/shared`: `tsc` type/build check

Electron Builder includes:

- `apps/web/dist` as `web-dist`
- `apps/companion/dist` as `companion/dist`
- `apps/companion/package.json` as `companion/package.json`
- Electron `dist/**/*`, `electron/*.cjs`, and desktop `package.json`

Packaged output is written to `apps/desktop/release`.

## Release Flow

Publishing requires GitHub CLI:

```bash
gh auth login
```

Preview:

```bash
npm run release:desktop:dry-run -- --version 1.0.5 --skip-build
```

Tag and push:

```bash
git tag v1.0.5
git push origin main v1.0.5
```

Publish:

```bash
npm run release:desktop -- --version 1.0.5
```

The release script cleans `apps/desktop/release`, builds separate macOS `arm64` and `x64` packages, selects matching `.dmg`, `.zip`, and update helper files, then uploads them to the GitHub Release. If the release already exists, matching assets are overwritten.

Useful variants:

```bash
npm run release:desktop -- --version 1.0.5 --arch arm64
npm run release:desktop -- --version 1.0.5 --arch x64
npm run release:desktop -- --version 1.0.5 --skip-build
```

## Testing Strategy

The repository currently has focused unit coverage around the highest-risk integration seams:

- Companion Hermes API request/stream handling.
- Companion gateway lifecycle behavior.
- Companion profile operations.
- Companion session-store normalization.
- Web API helpers.
- Web profile cache updates.
- Web chat cache behavior.

Run all tests:

```bash
npm run test
```

Run type checks:

```bash
npm run check
```

## Current Status

Bubble Town already includes:

- a working React/Vite client shell;
- session, profile, settings, and streaming chat surfaces;
- a local Fastify Companion API;
- managed Hermes gateway startup and profile-specific gateway switching;
- Hermes session normalization from JSON and SQLite stores;
- Electron desktop integration and macOS packaging;
- shared TypeScript contracts and focused tests.

Known incomplete areas are reflected by health checks: deeper `state.db`, sessions directory, and auth diagnostics are still marked as future work in `/api/health`.

## License

Add a dedicated license file before publishing this repository as open source.
