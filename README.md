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

Phases 1–4 are implemented: the Electron/Svelte foundation, portable INI configuration, library folder selection, single-instance behavior, a pure scanner, and a SQLite repository with transactional migrations/reconciliation. The scanner and repository are tested independently and are not wired into the app UI yet. Manual scanning/browsing, metadata, and portable distribution remain later milestones.

Use Node.js 22.12 or newer (verified with Node 24.14.1 and npm 11.11.0 on Windows). npm is the package manager; keep `package-lock.json` with dependency changes. Initial setup requires network access to download packages and the Electron runtime.

```powershell
npm ci
npm run dev
```

Close the app window to end development. Renderer edits update through Vite; restart the command after main/preload edits, or use `npm run dev -- --watch`.

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check main/preload/shared TypeScript and Svelte renderer types. |
| `npm test` | Run scanner, SQLite/reconciliation, configuration, path, filesystem-fixture, and IPC validation tests using Node's built-in test runner. |
| `npm run build` | Compile main, preload, and renderer into `out/`; does not package a portable executable. |
| `npm start` | Open the compiled app after a build. |
| `npm run test:smoke` | Build and launch real Electron; verify isolation, folder selection, INI persistence, relocation, unavailable folders, and single-instance behavior. |
| `npm run test:smoke:dev` | Run the same checks against a test-owned loopback Vite server on port 5173; close other dev servers first. |
| `npm run test:database:smoke` | Build and exercise the compiled SQLite repository in Electron with a temporary database. |

The smoke tests use temporary portable folders, supply fake native picker results, close their windows, and save an ignored screenshot at `test-results/portable-config.png`. Close other GameShelf instances before testing. Tests require an interactive Windows desktop, but no separate Playwright browser download. Development uses a loopback-only Vite server; compiled app resources are local. App permissions, new windows, navigation, and nonlocal renderer requests are blocked.

Verified milestone checks and limitations are recorded in [the implementation plan](docs/V1_PLAN.md).

The Phase 3 scanner is in `src/main/library/scanner.ts`. It accepts a root, collection prefix, and a directory-listing function; tests supply in-memory entries. It lists only the root and immediate collection folders, skips links and special entries, and returns either complete discoveries or a failure without partial data. No real filesystem adapter, scan button, persistence, or metadata integration has been added in this phase.

Phase 4 adds `src/main/database`. `openCatalog(portableBase, relativeLibraryRoot)` opens `data/library.db`, migrates it, and returns a repository with list, reconcile, and close methods. Only complete validated scans change presence; failed scans are skipped. Reconciliation preserves IDs, added dates, bindings, metadata, and manual overrides. It never deletes records. The catalog stores a relative library binding and refuses a different root, including an INI change made outside the app. Phase 5 will connect this service to manual scans and browsing after the single-instance lock is acquired.

`better-sqlite3` 13.0.3 is a runtime dependency; its shipped Windows x64 native binary was verified in Node 24.14.1 and Electron 44.3.0. No rebuild command is needed for these tested versions. Keep the lockfile and use `npm ci`; rerun `npm run test:database:smoke` after Electron or SQLite upgrades. Packaging must still include the native dependency, and packaged verification remains Phase 15.

## Library setup

Run `npm run dev`, then select **Choose library folder**. Select a folder on the same drive as this checkout, such as a `Games` subfolder or a sibling folder. Selection checks the folder itself but does not enumerate its contents or scan. Cancel leaves configuration unchanged. Use **Retry** after reconnecting an unavailable drive or correcting configuration.

During development and compiled preview, the checkout is the portable base, regardless of the shell's working directory. `config.ini` is created there only after a valid selection. A packaged build will use electron-builder's `PORTABLE_EXECUTABLE_DIR`; it refuses to guess a base if that value is unavailable. Packaged validation remains Phase 15.

The INI stores the library root relative to the portable base, including `../Games` for a sibling on the same drive. Move the app and library together, preserving their relative layout. Roots containing the app or overlapping `data/` are rejected, including resolved junction targets. A detected existing `data/library.db` blocks switching to another library until the later rebuild flow is implemented.

[config.example.ini](config.example.ini) shows defaults. The small INI format supports named sections, scalar `key=value` entries, blank lines, and full-line `;` or `#` comments. The app writes JSON-quoted string values; forward slashes are easiest for paths. Duplicate sections/keys, malformed lines, unsupported versions, and invalid known settings produce an error without overwriting the original file. Saves preserve unknown scalar settings but normalize formatting and remove comments. Do not edit the file while a folder picker is open.

No providers are implemented or enabled. Future credentials stay in main-process configuration; ordinary renderer queries receive only library status, its resolved path, and a message. Defaults for collection visibility, matching threshold, and sort are stored for later milestones; they do not enable those features yet.

Local version control uses Git. INI settings and their backups, `.env` files, databases, artwork/data, logs, dependencies, and build/test output are ignored. Only sanitized `*.example.ini` templates may be tracked; never put real API keys in those examples. Review `git diff --cached` before committing. Git ignore rules do not protect files that were already tracked or explicitly force-added.

Read [AGENTS.md](AGENTS.md), [the implementation plan](docs/V1_PLAN.md), [architecture](docs/ARCHITECTURE.md), and [decisions](docs/DECISIONS.md) before implementation. Work one milestone at a time.
