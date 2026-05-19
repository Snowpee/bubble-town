# Bubble Town

[Chinese README](./README.zh-CN.md)

Bubble Town is a desktop and web client project for Hermes, organized as a monorepo and built on `Electron + React + Vite + Fastify + TypeScript`.

Instead of rebuilding a separate chat backend, Bubble Town focuses on providing an extensible Hermes client experience through a local Companion service and a desktop shell.

## Overview

- `apps/web`: React + Vite frontend
- `apps/companion`: local Fastify Companion service that bridges the UI and Hermes capabilities
- `apps/desktop`: Electron shell that loads the web app and bundles local resources
- `packages/shared`: shared types and contracts used across apps

## Tech Stack

- Frontend: React 18, React Router, TanStack Query, Zustand, Tailwind CSS v4
- Backend: Fastify
- Desktop: Electron, electron-builder
- Tooling: TypeScript, Vitest, ESLint, npm workspaces

## Repository Layout

```text
bubble-town/
├─ apps/
│  ├─ web/          # Frontend app
│  ├─ companion/    # Local Companion service
│  └─ desktop/      # Electron main process and preload
├─ packages/
│  └─ shared/       # Shared types
├─ README.md
└─ README.zh-CN.md
```

## Quick Start

### Requirements

- Node.js 22.12+
- npm 10+

### Install

```bash
npm install
```

### Start Development

```bash
npm run dev
```

This starts:

- the web frontend
- the local Companion service

To run the desktop shell together with them:

```bash
npm run dev:all
```

### Start Development on LAN

To make the web app available to other devices on the same network:

```bash
npm run dev:lan
```

This starts the web frontend on `0.0.0.0` and the Companion service on `0.0.0.0:3030`.
Open the Vite network URL printed in the terminal, for example:

```text
http://192.168.1.23:5173/
```

When the app is opened through a LAN address, the frontend automatically calls the Companion service on the same host at port `3030`.

## Common Commands

| Command | Description |
| --- | --- |
| `npm run dev` | Start the `web + companion` development environment |
| `npm run dev:lan` | Start `web + companion` for LAN access |
| `npm run dev:web` | Start only the web frontend |
| `npm run dev:web:lan` | Start only the web frontend for LAN access |
| `npm run dev:backend` | Start only the local Companion service |
| `npm run dev:backend:lan` | Start only the Companion service for LAN access |
| `npm run dev:companion` | Alias of `dev:backend` |
| `npm run dev:desktop` | Start only the Electron desktop shell |
| `npm run dev:all` | Start `web + companion + desktop` together |
| `npm run check` | Run TypeScript checks across workspaces |
| `npm run test` | Run workspace tests |
| `npm run build` | Build all workspaces |
| `npm run package:desktop` | Build and package the desktop app |
| `npm run package:dir -w @bubble-town/desktop` | Package a local macOS `.app` directory with ad-hoc signing |
| `npm run package:zip -w @bubble-town/desktop` | Package a macOS arm64 `.zip` with ad-hoc signing |
| `npm run package:dmg -w @bubble-town/desktop` | Package a macOS arm64 `.dmg` with ad-hoc signing |
| `npm run release:desktop:dry-run` | Preview the macOS desktop GitHub Release command |
| `npm run release:desktop` | Build and publish macOS arm64 + x64 desktop Releases via GitHub CLI |

## Development Notes

### Web

`apps/web` is built with Vite and is intended for fast iteration on the chat UI, session list, settings pages, and shared UI components.

### Companion

`apps/companion` is a local Fastify service that centralizes configuration, sessions, and Hermes integration logic so the frontend can rely on a stable local API layer.

### Desktop

`apps/desktop` contains the Electron main process and preload layer. Desktop packaging includes the following resources:

- `apps/web/dist`
- `apps/companion/dist`
- `apps/companion/package.json`

## Packaging

```bash
npm run package:desktop
```

The packaged output is written to `apps/desktop/release` by default.
For faster local checks, use `npm run package:dir -w @bubble-town/desktop`.

## Publishing the macOS Desktop App

Local publishing uses GitHub CLI. Log in once before publishing:

```bash
gh auth login
```

Preview the release first:

```bash
npm run release:desktop:dry-run -- --version 1.0.3 --skip-build
```

Before publishing, commit the version changes and push the release tag:

```bash
git tag v1.0.3
git push origin main v1.0.3
```

Publish the release:

```bash
npm run release:desktop -- --version 1.0.3
```

The script cleans `apps/desktop/release`, builds separate macOS `arm64` and `x64` packages, selects matching `.dmg`, `.zip`, and update helper files, then publishes them to `v1.0.3`. If the release already exists, it uploads the assets and overwrites matching filenames.

To build only one architecture:

```bash
npm run release:desktop -- --version 1.0.3 --arch arm64
npm run release:desktop -- --version 1.0.3 --arch x64
```

If both architecture builds already exist, skip packaging and only upload:

```bash
npm run release:desktop -- --version 1.0.3 --skip-build
```

## Current Status

The repository already includes:

- a web frontend foundation
- a local Companion service
- an Electron desktop shell
- shared type definitions
- basic tests and type-check scripts

It is suitable as a foundation for continued Hermes client development.

## License

Add a dedicated license file before publishing this repository as open source.
