# GameShelf

GameShelf is a Windows-only portable catalog for game installer folders and supported archives on an external drive. Browse a local library, optionally enrich it with metadata and artwork, and use **Open Install Location** in Windows Explorer.

## Scope

- One user-selected library root. Ask for a root when none is configured or the configured location is unavailable; never assume a directory.
- Immediate folders are games, except folders beginning with `_`, which are excluded. Immediate folders prefixed `[C]` are collections; their immediate child folders and supported archive files (`.zip`, `.rar`, `.iso`) are games. Supported archive files directly under the root are also games. Do not scan deeper or inspect game-folder contents.
- Manual scans reconcile discoveries, add new entries, and mark absent entries missing. Never automatically delete catalog entries or modify game folders.
- Metadata is optional. Selected providers are IGDB, then TheGamesDB, then SteamGridDB (supplemental artwork only); other providers are deferred. Enabled providers run in configurable priority order within their capabilities; only high-confidence matches are accepted automatically. Other entries support manual matching.
- Manual metadata and artwork overrides survive scans and normal refreshes. Only an explicit replace-all rescrape may replace them.
- Cache covers and backgrounds locally; support custom artwork pasted from the clipboard. Browsing works offline, including without any configured provider.

## Experience

Use Playnite as visual direction for a windowed, mouse-and-keyboard interface:

- **Home:** collections, games discovered after the initial scan, and a locally selectable grouping by release decade or genre. The initial scan and a rebuild intentionally have no recently added games.
- **All Games:** search by title, filter by release year or collection, sort alphabetically or by release date.
- **Collections:** collection cards and individual collection pages. A setting controls whether collection games appear in the main library; they remain searchable regardless.
- **Game details:** cover, background, and available metadata such as description, release date, developer, publisher, genres, ratings, and reviews. Omit unavailable fields and sections.
- **Needs Matching:** unresolved games, candidate selection, and manual search.
- **Settings:** durable configuration and maintenance actions.

The sole game filesystem action is **Open Install Location**. It opens folders and ISO parent folders in Explorer, while ZIP/RAR archives are opened directly. Catalog editing and maintenance do not operate on installer files.

## Stack and distribution

Electron, Svelte 5, TypeScript, Vite, embedded SQLite, and INI configuration. `better-sqlite3` is the preferred driver, subject to packaged Electron compatibility checks. Target Windows x64 with a portable build; electron-builder is the planned packaging tool.

No installer, administrator requirement, database server, or background service. Run one app instance. Updates are manual. All durable configuration, database, artwork, and any logs stay with the portable library; temporary Electron/Chromium files on the host are acceptable. Persist relative paths so changing drive letters does not break the catalog.

No telemetry, analytics, automatic updates, or network traffic except requests needed by explicitly enabled metadata/artwork providers. No launching or installing games, installer inspection, extraction, ISO mounting, game downloads, installed-state tracking, playtime, save management, emulators, cloud sync, remote access, or multi-user features.

## Project status and development

Phases 1–14 are implemented. Select a library, scan manually, browse games and collections, filter/sort locally, match metadata, and use **Open Install Location**. Artwork and manual work remain local and offline; settings persist durable catalog preferences and redacted provider status. Portable distribution remains a later milestone.

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
| `npm run test:smoke:dev` | Run the same checks against a test-owned loopback Vite server on an available port. |
| `npm run test:database:smoke` | Build and exercise the compiled SQLite repository in Electron with a temporary database. |
| `npm run test:igdb:live -- --run` | Optional IGDB authentication/search/detail check using local INI credentials; no catalog writes. Without `--run`, skips without networking. |
| `npm run test:thegamesdb:live -- --run` | Optional TheGamesDB key/search/detail check, including company/genre name lookups; no catalog writes. Without `--run`, skips without networking. |

The smoke tests use temporary portable folders and an isolated Chromium profile, supply fake picker and IGDB HTTP responses, capture Explorer target paths without opening Explorer, and close their windows. Ignored screenshots are saved at `test-results/catalog.png` and `test-results/matching.png`. Checks cover matching, provider failure, scanning, browsing, missing/reappearing folders, restart, relocation, and unavailable roots. Tests require an interactive Windows desktop, but no separate Playwright browser download. Development uses a loopback-only Vite server; compiled app resources are local. App permissions, new windows, navigation, and nonlocal renderer requests are blocked.

Verified milestone checks and limitations are recorded in [the implementation plan](docs/V1_PLAN.md).

The Phase 3 scanner is in `src/main/library/scanner.ts`. It accepts a root, collection prefix, and a directory-listing function. It lists only the root and immediate collection folders, skips links and special entries, and returns either complete discoveries or a failure without partial data. Phase 5 connects a real shallow filesystem adapter and manual UI action through a main-process library service.

Phase 4 adds `src/main/database`. `openCatalog(portableBase, relativeLibraryRoot)` opens `data/library.db`, migrates it, and returns a repository with list, reconcile, and close methods. Only complete validated scans change presence; failed scans are skipped. Reconciliation preserves IDs, added dates, bindings, metadata, and manual overrides. It never deletes records. The catalog stores a relative library binding and refuses a different root, including an INI change made outside the app. Phase 5 opens existing catalogs after the single-instance lock and creates a new catalog only after a successful manual scan.

`better-sqlite3` 13.0.3 is a runtime dependency; its shipped Windows x64 native binary was verified in Node 24.14.1 and Electron 44.3.0. No rebuild command is needed for these tested versions. Keep the lockfile and use `npm ci`; rerun `npm run test:database:smoke` after Electron or SQLite upgrades. Packaging must still include the native dependency, and packaged verification remains Phase 15.

## Library setup

Run `npm run dev`, then select **Choose library folder**. Select a folder on the same drive as this checkout, such as a `Games` subfolder or a sibling folder. Selection checks the folder itself but does not enumerate its contents or scan. Cancel leaves configuration unchanged. Use **Retry** after reconnecting an unavailable drive or correcting configuration.

Select **Scan library** to update the catalog, then select a collection or game to view its details. **Open Install Location** resolves the stored game ID in main. It opens game folders and ISO parent folders in Explorer; ZIP/RAR archives are opened directly. Missing, inaccessible, or linked game paths return an error. Missing records remain visible; an unavailable library does not prevent browsing an existing catalog. Startup, Retry, and root selection never scan automatically.

During development and compiled preview, the checkout is the portable base, regardless of the shell's working directory. `config.ini` is created there only after a valid selection. A packaged build will use electron-builder's `PORTABLE_EXECUTABLE_DIR`; it refuses to guess a base if that value is unavailable. Packaged validation remains Phase 15.

The INI stores the library root relative to the portable base, including `../Games` for a sibling on the same drive. Move the app and library together, preserving their relative layout. Roots containing the app or overlapping `data/` are rejected, including resolved junction targets. A detected existing `data/library.db` blocks switching to another library until the later rebuild flow is implemented.

[config.example.ini](config.example.ini) shows defaults. The small INI format supports named sections, scalar `key=value` entries, blank lines, and full-line `;` or `#` comments. The app writes JSON-quoted string values; forward slashes are easiest for paths. Duplicate sections/keys, malformed lines, unsupported versions, and invalid known settings produce an error without overwriting the original file. Saves preserve unknown scalar settings but normalize formatting and remove comments. Do not edit the file while a folder picker is open.

`src/main/metadata` defines normalized provider contracts, a resolver, and the IGDB adapter. Phase 8 connects their results to SQLite and the matching interface. Credentials stay in main-process configuration; ordinary renderer queries never receive them. Collection visibility and expanded sorting remain later work.

## Matching metadata (Phase 8)

With metadata providers configured, **Scan library** saves discoveries first, then attempts automatic matching for every unresolved game. The sidebar reports scanning/matching progress, including the current folder, attempts, and matches. Enabled/configured providers are tried in INI order until one supplies a confident, unique match. Empty, ambiguous, low-confidence, and failed attempts allow fallback. If no provider succeeds, the game remains in **Needs Matching** for the next manual scan. Existing matches are never implicitly rematched by scanning. An unresolved provider failure leaves the local scan intact and stops further automatic requests for that scan.

For games already in your catalog, open **Needs Matching**, select a game, and choose **Match automatically**. If needed, edit **Search title**, select one enabled metadata provider, choose **Search candidates**, then **Use this match** beside the candidate's title, release year, provider, record ID, and any artwork availability reported by that provider. Searching alone changes nothing. The selected record's details are fetched before its provider/record ID and metadata are saved. A matched game's **Change match** dialog identifies its current provider, record ID, binding type, and catalog folder; an explicit selection replaces that binding while a failed request keeps the old match.

Titles, descriptions, release years, companies, genres, and ratings appear when available and remain readable offline. Manual bindings and overrides survive scans and restarts. Artwork is not downloaded or displayed yet. Provider work runs sequentially; wait for the current operation before scanning or matching again. Startup and Retry never trigger metadata requests.

## IGDB setup (Phase 7)

Close GameShelf before editing the local `config.ini` beside the app (in development, the repository root). In the existing `[metadata]` section, set `providerOrder="igdb"`. Add the section below, using your Twitch application's Client ID and Client Secret. Do not duplicate existing sections or put credentials in the tracked `config.example.ini`.

```ini
[provider.igdb]
enabled="true"
clientId="YOUR_CLIENT_ID"
clientSecret="YOUR_CLIENT_SECRET"
```

IGDB uses Twitch client credentials; the adapter requests an app access token and keeps it in memory only. You do not need to copy an access token into INI. See [IGDB authentication](https://api-docs.igdb.com/#authentication) and [Twitch client credentials](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-grant-flow).

Run `npm run test:igdb:live -- --run` when ready. It searches for Portal, fetches its details, and prints a safe pass/fail message. It does not scan your library, write matches, or download artwork. Missing/disabled configuration skips the check. Automated tests always use fake responses. IGDB is disabled unless explicitly enabled and listed in providerOrder.

The adapter allows one operation at a time, spaces request starts by at least 300 ms, and applies a 10-second timeout and 2 MiB response limit. It retries an unauthorized API request once with a new token, honors rate-limit cooldowns, and reports other errors for an explicit retry. Searches that fill the 50-result limit are treated as too broad rather than trusting an incomplete candidate set. Release year is normalized; a precise release day is omitted until date precision is established.

## Artwork and SteamGridDB (Phase 10)

Artwork is fetched only while an explicit matching operation succeeds; it never runs at startup or from the renderer. Covers/backgrounds are stored under `data/artwork` with opaque relative names and rendered through a local application URL. Existing cached files remain usable offline; unavailable artwork uses an in-app placeholder. Downloads are bounded, image-signature checked, and atomically replaced. Failed downloads leave usable cache entries intact.

To enable supplemental SteamGridDB artwork, add it to the existing order and configure its ignored section:

```ini
[metadata]
providerOrder="igdb,thegamesdb,steamgriddb"

[provider.steamgriddb]
enabled="true"
apiKey="YOUR_STEAMGRIDDB_API_KEY"
```

SteamGridDB never supplies or replaces descriptive metadata bindings. After a game has a metadata match, use **Edit > Fetch artwork** to stage cover/background art from the matched provider and SteamGridDB. Entering a SteamGridDB game ID is optional and avoids title-search ambiguity; leaving it blank uses title lookup. GameShelf shows the current and proposed local artwork, then replaces only the confirmed items. Artwork is classified as manual only when it was pasted through **Edit metadata & artwork**; provider/API artwork is always provider artwork. Changing a metadata match refreshes provider-cached artwork while leaving pasted artwork intact.

## TheGamesDB and provider priority (Phase 9)

Close GameShelf, then edit your ignored local `config.ini`. Set `providerOrder="igdb,thegamesdb"` in the existing `[metadata]` section and add:

```ini
[provider.thegamesdb]
enabled="true"
apiKey="YOUR_THEGAMESDB_API_KEY"
```

Use your TheGamesDB API key, never the Twitch secret. Run `npm run test:thegamesdb:live -- --run` for the optional live check. It performs search/details and any required company/genre lookups using the [official API](https://api.thegamesdb.net/); no catalog or artwork is written. Its key is required in API query parameters, so request URLs are never logged or returned to the UI.

The default order for new configurations is IGDB then TheGamesDB, with both disabled until explicitly enabled. Existing INI order, including an empty order, is preserved. Reverse the list to prefer TheGamesDB, or omit/disable a provider to exclude it. Unknown IDs are ignored and duplicates run only once. An invalid enabled flag disables that provider; missing credentials skip it. Manual search starts with the configured default metadata provider and can target another enabled provider explicitly. Priority changes never rematch existing records or override manual selections.

TheGamesDB requests use a fixed API origin, no redirects, one active operation, 300 ms spacing, 10-second deadlines, and a 2 MiB response limit. Pagination is refused as too broad rather than following URLs containing keys or accepting incomplete matches. Company/genre IDs resolve through bounded lookups with names cached in memory. HTTP 403 may indicate a bad key or exhausted allowance; 429 and reported quota exhaustion impose a cooldown. Age classifications are not converted into review scores. Artwork remains Phase 10.

Local version control uses Git. INI settings and their backups, `.env` files, databases, artwork/data, logs, dependencies, and build/test output are ignored. Only sanitized `*.example.ini` templates may be tracked; never put real API keys in those examples. Review `git diff --cached` before committing. Git ignore rules do not protect files that were already tracked or explicitly force-added.

Read [AGENTS.md](AGENTS.md), [the implementation plan](docs/V1_PLAN.md), [architecture](docs/ARCHITECTURE.md), and [decisions](docs/DECISIONS.md) before implementation. Work one milestone at a time.
