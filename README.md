# GameShelf

GameShelf is a Windows-only portable catalog for game installer folders on an external drive. Browse a local library, optionally enrich it with metadata and artwork, and use **Open Install Folder** to open a game's directory in Windows Explorer.

## Scope

- One user-selected library root. Ask for a root when none is configured or the configured location is unavailable; never assume a directory.
- Immediate folders are games. Immediate folders prefixed `Collection_` are collections; their immediate child folders are games. Do not scan deeper or inspect game-folder contents.
- Manual scans reconcile discoveries, add new entries, and mark absent entries missing. Never automatically delete catalog entries or modify game folders.
- Metadata is optional. Enabled providers run in configurable priority order; only high-confidence matches are accepted automatically. Other entries support manual matching.
- Manual metadata and artwork overrides survive scans and normal refreshes. Only an explicit replace-all rescrape may replace them.
- Cache covers and backgrounds locally; support custom artwork pasted from the clipboard. Browsing works offline, including without any configured provider.

## Experience

Use Playnite as visual direction for a windowed, mouse-and-keyboard interface:

- **Home:** recently added games, collections, and all games.
- **All Games:** search by title, filter by release year or collection, sort alphabetically or by release date.
- **Collections:** collection cards and individual collection pages. A setting controls whether collection games appear in the main library; they remain searchable regardless.
- **Game details:** cover, background, and available metadata such as description, release date, developer, publisher, genres, ratings, and reviews. Omit unavailable fields and sections.
- **Needs Matching:** unresolved games, candidate selection, and manual search.
- **Settings:** durable configuration and maintenance actions.

The sole game filesystem action is **Open Install Folder**. Catalog editing and maintenance do not operate on installer files.

## Stack and distribution

Electron, Svelte 5, TypeScript, Vite, embedded SQLite, and INI configuration. `better-sqlite3` is the preferred driver, subject to packaged Electron compatibility checks. Target Windows x64 with a portable build; electron-builder is the planned packaging tool.

No installer, administrator requirement, database server, or background service. Run one app instance. Updates are manual. All durable configuration, database, artwork, and any logs stay with the portable library; temporary Electron/Chromium files on the host are acceptable. Persist relative paths so changing drive letters does not break the catalog.

No telemetry, analytics, automatic updates, or network traffic except requests needed by explicitly enabled metadata/artwork providers. No launching or installing games, installer inspection, extraction, ISO mounting, game downloads, installed-state tracking, playtime, save management, emulators, cloud sync, remote access, or multi-user features.

## Project status and development

Phase 1 (Foundation) is implemented: a minimal Svelte window, sandboxed Electron renderer, and a narrow typed app-info bridge. Library configuration, scanning, persistence, metadata, and portable distribution are later milestones.

Use Node.js 22.12 or newer (verified with Node 24.14.1 and npm 11.11.0 on Windows). npm is the package manager; keep `package-lock.json` with dependency changes. Initial setup requires network access to download packages and the Electron runtime.

```powershell
npm ci
npm run dev
```

Close the app window to end development. Renderer edits update through Vite; restart the command after main/preload edits, or use `npm run dev -- --watch`.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check main/preload/shared TypeScript and Svelte renderer types. |
| `npm test` | Run IPC validation tests using Node's built-in test runner. |
| `npm run build` | Compile main, preload, and renderer into `out/`; does not package a portable executable. |
| `npm start` | Open the compiled app after a build. |
| `npm run test:smoke` | Build and launch real Electron; verify rendering, the bridge, and renderer isolation. |
| `npm run test:smoke:dev` | Run the same checks against a test-owned loopback Vite server on port 5173; close other dev servers first. |

The smoke tests close their window and save an ignored screenshot at `test-results/foundation.png`. They require an interactive Windows desktop, but no separate Playwright browser download. Development uses a loopback-only Vite server; compiled app resources are local. App permissions, new windows, navigation, and nonlocal renderer requests are blocked. There is no durable application state yet; portable storage and single-instance handling begin in Phase 2.

Verified Phase 1 checks and limitations are recorded in [the implementation plan](docs/V1_PLAN.md).

Local version control uses Git. INI settings and their backups, `.env` files, databases, artwork/data, logs, dependencies, and build/test output are ignored. Only sanitized `*.example.ini` templates may be tracked; never put real API keys in those examples. Review `git diff --cached` before committing. Git ignore rules do not protect files that were already tracked or explicitly force-added.

Read [AGENTS.md](AGENTS.md), [the implementation plan](docs/V1_PLAN.md), [architecture](docs/ARCHITECTURE.md), and [decisions](docs/DECISIONS.md) before implementation. Work one milestone at a time.
