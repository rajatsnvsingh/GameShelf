# GameShelf architecture

For diagrams, see the [README](../README.md#software-architecture). For everyday setup and use, see the [user guide](USER_GUIDE.md); commands and current limitations are in [development](DEVELOPMENT.md).

The contracts below describe the current design. Paragraphs explicitly labeled with a phase retain implementation history from that milestone; their references to later work are historical, not the current MVP status. Milestones 1–14 are implemented; packaging and final hardening remain pending.

## Process and module boundaries

`Svelte renderer -> typed preload/contextBridge -> validated IPC -> main/core services`

- **Renderer:** views, components, transient search/filter/navigation state. No direct Node, filesystem, SQLite, provider, or Explorer access.
- **Preload:** narrow typed methods and DTOs. Never expose raw IPC or arbitrary filesystem/shell operations.
- **Main/core:** configuration, scanner adapter, reconciliation, repository/migrations, provider resolver, artwork/clipboard processing, and Explorer integration.
- **Shared:** domain types and IPC contracts without privileged runtime dependencies.

Use context isolation and disable renderer Node integration. Validate IPC inputs in main. Pass a game ID to the Explorer service; resolve its stored path and verify an existing directory within the current root before opening it. Treat provider content as untrusted data; render metadata safely and use local artwork resources.

Suggested source areas: `src/main/{config,library,database,metadata,artwork,system,ipc}`, `src/preload`, `src/renderer`, and `src/shared`. Keep domain logic independently testable; do not build a web server or browser deployment mode.

Phase 1 implements only `src/main`, `src/preload`, `src/renderer`, and `src/shared`. The `window.gameShelf.getAppInfo()` bridge returns name/version through `app:get-info`; main accepts only the owning window's main frame at the expected document URL and rejects payload arguments. The preload is bundled as CommonJS for Electron's sandbox. electron-vite builds the three entry points; its loopback development server is tooling, not a product server. A local-resource request policy and CSP restrict renderer traffic; future enabled providers belong in main-process adapters.

Phase 2 adds `src/main/config` and two no-argument bridge methods: `getLibraryState()` and `chooseLibraryRoot()`. Both use the same caller validation; main opens the native dialog and accepts its result, never a renderer-supplied path. Library responses contain status/path/message only, not the INI or credentials.

## Portable storage and path bases

Example layout, not an assumed root:

```text
GameShelf/
  GameShelf.exe
  config.ini
  data/
    library.db
    artwork/
  Games/
    Game A/
    [C] Example/
      Game B/
```

The **portable base** is the persistent distribution directory on the external drive, never the current working directory or a portable executable's temporary extraction directory. Resolve it explicitly for the packaging target. Configuration, SQLite, artwork, and optional logs remain there. Temporary Electron/Chromium host files are acceptable; authoritative state must not depend on them.

Implemented resolution: unpackaged development/preview uses `app.getAppPath()`; packaged mode requires the local absolute `PORTABLE_EXECUTABLE_DIR` supplied by the [electron-builder portable launcher](https://www.electron.build/nsis/). There is no extraction-directory fallback. Actual packaged verification remains Phase 15. Same-drive sibling roots may contain `..` relative to the portable base; library roots cannot contain the app or overlap its data directory. Unpackaged development additionally accepts an absolute local cross-drive root, which is deliberately non-portable. This exception does not permit traversal in future game/artwork paths. Root checks use both lexical paths and resolved filesystem paths to catch junction overlap; they do not enumerate the selected folder.

- INI library root: relative to the portable base (for example `Games`). Ask the user to select a root if missing/unavailable. The supported portable layout keeps the app, data, and library on the same drive. Only unpackaged development may persist a local drive-qualified root; packaged builds reject it so it cannot be mistaken for a relocatable portable layout.
- Game and collection paths: relative to the selected library root. For Game B above, store `[C] Example/Game B`, not just `Game B`.
- Artwork paths: relative to the artwork directory. Use app-controlled filenames, not remote names or absolute URLs as local identities.
- Normalize separators and Windows path identity consistently; preserve the literal folder name for display. Resolve absolute paths only at runtime and reject traversal outside each permitted base.

Keep app data outside the scanned tree; validate root selection accordingly. Do not add scanner exceptions for app data. Root selection must not trigger a scan or silently reconcile a different library against the existing catalog. A changed root is saved without modifying the old catalog; the user must explicitly rebuild before scanning or browsing the new library. **Wipe library** is a separately confirmed destructive action that deletes catalog, cache, and logs while preserving configuration and credentials; it never touches the selected game folders or archives. Relocating the same library preserves records.

## Configuration

Use a single versioned `config.ini` for durable settings: relative root, collection prefix (default `[C]`), collection-game visibility, provider enabled flags/order/API credentials, matching threshold, and default sort. Provider sections use stable provider IDs. Providers are disabled until configured and enabled by the user.

The default `0.75` threshold permits clear approximate title matches while retaining ambiguity protection. Normalized exact-title candidates instead use provider ranking, including when duplicate records exist. This is not proof of correctness and should be validated against ambiguous-title fixtures. Selected providers are IGDB, TheGamesDB, and SteamGridDB only, in that default priority order. IGDB and TheGamesDB provide metadata; SteamGridDB provides supplemental artwork. Apply priority within supported capabilities, without replacing a metadata binding just to obtain artwork. Other providers are deferred. Concrete credential fields are defined during provider milestones, not imposed by sample configuration.

Plaintext API keys in INI are accepted. Main owns credential storage/use; settings may submit replacements through dedicated IPC, while ordinary responses return redacted status. Do not log secrets. Validate configuration and write updates atomically. Do not persist current search, selection, page, or scroll position; explicit durable defaults are distinct from transient UI state.

Phase 2 uses a strict scalar INI reader/writer without an added dependency. Missing files use defaults in memory; the first successful root selection writes version 1 and defaults. Invalid files are preserved for correction and block selection. Each save writes a unique sibling temporary file, flushes and closes it, then renames it over `config.ini`; failed replacements clean up the temporary file. Unknown scalar entries are retained, while formatting/comments are normalized. Provider sections and their validation will be introduced with the provider milestones. The default matching threshold is `0.75`, collection games are visible by default, default sort is `title`, and provider order is empty.

## Scanner contract

Input: root plus collection prefix and an injected directory-listing adapter. Output: discovered games/collections with literal folder names, relative paths, collection membership, and success/error status. The pure classification logic has no persistence, metadata, or UI side effects.

1. List immediate root entries. Recognize supported `.zip`, `.rar`, `.iso`, and `.exe` files by name only; ignore other files and directories beginning with `_`.
2. A remaining directory without the collection prefix is a game. Never enumerate its contents.
3. A prefixed root directory is a collection, named for display by removing the prefix. List its immediate child directories and supported files as games, excluding `_`-prefixed directories.
4. Stop. Even a prefixed child inside a collection is a game, not a nested collection.

Recognize supported file extensions without inspecting contents. Do not infer DLC, editions, or installed state. Empty game folders count; empty collections remain collections. Use game folder names literally as initial titles/search terms; elaborate cleanup and rename detection are out of scope. Do not traverse directory links outside the root or allow them to increase scan depth. Keep unusual-folder policy simple rather than inferring content semantics.

`scanLibrary({ root, collectionPrefix }, listDirectory)` in `src/main/library/scanner.ts` receives the absolute root separately from a relative directory (`''` for root, otherwise a single collection folder name). It returns immediate game folders and immediate `.zip`, `.rar`, `.iso`, or `.exe` files at either scanned level; it excludes directories beginning with `_`, never visits game folders, and does not inspect archive contents. The adapter must return a complete immediate listing or throw, distinguish directories/files/links/other entries without following links, and preserve literal entry names. `directory-reader.ts` validates listing depth, rejects linked listing directories, and checks observed directory identity/modification times and the resolved root before reconciliation. Detected changes discard the scan.

The scanner skips links (including junctions) and special entries at both levels. Prefix matching is exact and case-sensitive. A prefix-only collection keeps an empty display name after prefix removal. Output uses forward-slash relative paths and nullable collection paths for game membership. Root entries and final results use ordinal string ordering, independent of locale or adapter order; listing arrays are not mutated. Unsafe entry names or duplicate case-insensitive sibling names fail the scan rather than producing ambiguous paths.

`ScanResult` is a discriminated union: `complete` contains games/collections; `failed` contains only an error code and the relative directory where it occurred. The scanner stops on the first failure and discards all partial discoveries. Raw adapter exceptions are not exposed. Reconciliation accepts only complete results; a failed result cannot be interpreted as an empty library.

## Persistence and reconciliation

Use SQLite with ordered, transactional migrations recorded in `schema_migrations`. `better-sqlite3` is preferred pending packaged native-module validation. Keep the schema small for approximately 50–100 games:

| Entity | Core data |
| --- | --- |
| Game | Stable ID, unique normalized relative path, literal folder name, optional collection ID, added/last-seen timestamps, missing flag, match status, provider/record binding and confidence, provider metadata, manual overrides |
| Collection | Stable ID, unique normalized relative path, folder/display names, presence state |
| Artwork | Game ID, cover/background kind, provider/manual source, relative local path, optional remote provenance |
| Migration | Applied schema version/history |

Use columns for title, release date/year, collection, and added date as needed for queries; retain optional/provider-specific metadata in JSON. Keep manual overrides separate from provider values and apply them consistently to display, search, filtering, and sorting. Missing metadata is null/absent, not fabricated. A deliberate manual clearing must be distinguishable from no override.

On a **successful complete manual scan**, reconcile transactionally: insert new paths, mark observed entries present, update last-seen values, and mark unobserved records missing. Preserve stable IDs, added dates, bindings, metadata, and overrides for existing paths. Reappearance clears missing. Rename/move may yield an old missing record plus a new record; do not guess identity.

If the root is unavailable or any required listing fails, report the failure and do not apply presence reconciliation. Never interpret an unplugged drive or unreadable collection as an empty library. Scanning and optional enrichment are separate stages; metadata failures cannot undo a valid catalog scan. A normal scan attempts enrichment for every unresolved, unbound entry using enabled providers, including entries from earlier scans. It never refreshes or rematches existing bindings implicitly.

Phase 4 implements the repository in `src/main/database` with `better-sqlite3` 13.0.3. Version 1 creates `catalog`, `collections`, and `games`; migration history is recorded in `schema_migrations`. `catalog` binds the database to the normalized root relative to the portable base, so relocation retains the binding and another relative library root is refused. Development-only cross-drive roots bind to their normalized absolute local path and are not relocatable. Connections enable foreign keys and use DELETE journaling with FULL synchronization. This keeps the durable database and its transient rollback journal beside each other in `data/`. Storage links/junctions are rejected. Opening a catalog does not enumerate a library, and an absent root does not prevent reading existing records.

Migration versions must be consecutive and recorded names must match. All pending migrations and initial root binding run transactionally; failure rolls back and closes the connection. Corrupt databases and unknown migration histories fail without an automatic rebuild. Existing migration SQL must remain unchanged; later schema changes append migrations. Actual interruption/power-loss recovery still requires Phase 16 verification.

Game and collection identity uses forward-slash relative paths with a separate lowercase key. Literal spelling is retained for display. Traversal, absolute paths, empty components, and Windows trailing-dot/space aliases are rejected. Complete snapshots are validated for duplicates, depth, and collection membership before any writes. Reconciliation marks presence and upserts discovered paths within one transaction, updating folder spelling, membership, and last-seen timestamps only for existing records; absent records retain their last-seen values. A repeat scan at the same timestamp has the same catalog result; later scans advance last-seen timestamps without changing identity or added dates.

Provider metadata and manual overrides are separate JSON objects, so an explicit JSON `null` override survives scans distinctly from an absent property. Version 1 includes binding fields solely for persistence and preservation; no matching/editing API is implemented. Artwork tables and effective title/date query columns will be added when their feature milestones need them. `out/main/catalog.js` remains a separately compiled main-process entry for native repository smoke checks.

## Phase 5 application integration

`LibraryService` owns the catalog connection, manual scan orchestration, and folder-open operation. Existing catalogs open on demand for browsing; selecting a root or reading an empty catalog does not create a database. Only a complete manual scan creates a new catalog and reconciles it. Concurrent operations are refused, configuration is checked before reconciliation, and shutdown closes the connection and prevents late writes. Invalid or corrupt catalogs report errors without an automatic replacement.

The narrow preload API adds `getCatalog`, `scanLibrary`, and `openInstallFolder(gameId)`. IPC validates the owning main frame and exact payload shape; opening accepts only a positive safe integer ID. Main loads the stored relative path, validates each component against the current root without listing contents, rejects links/traversal, and invokes Electron `shell.openPath`: game folders and ISO parent folders open in Explorer, while ZIP/RAR files open directly. Raw filesystem/OS errors and provider fields are not sent to the renderer.

The minimal renderer presents collections, game lists, local details, presence, and manual actions. Selection and navigation remain transient. Browsing an existing catalog works when the root is unavailable; failed scans leave presence unchanged. Search, metadata/artwork, and the full Home/Settings experience remain later milestones.

## Metadata and matching

Providers expose stable identity/capabilities, `search(query)`, `getGame(providerId)`, and artwork references through normalized contracts. Provider-specific authentication and response mapping stay in adapters. Use bounded concurrency, timeouts, and rate-limit handling; no provider is required for catalog operation.

The resolver tries enabled/configured providers in INI order. A normalized exact-title candidate selects the provider’s first such result. Approximate candidates must meet the configured threshold and have a sufficient lead over the runner-up; otherwise continue to the next provider, then leave the game in Needs Matching. The persisted opt-in `greedyMatch` setting instead accepts the first valid candidate in provider order, deliberately bypassing confidence and ambiguity checks. A failure remains distinguishable from no match, and the user can retry manually.

Manual selection stores an exact provider + record ID and overrides priority. Scans and priority changes preserve existing bindings. Normal explicit refresh uses the stored binding and updates provider data underneath manual overrides. Explicit rematching can change a binding while preserving manual fields/artwork. Only an explicit **replace-all rescrape** may clear those overrides; state its scope before execution and retain prior data if retrieval fails.

## Phase 6 provider contracts and resolver

`src/main/metadata/provider.ts` defines main-only provider identity, artwork capabilities, `search(query)`, and `getGame(recordId)`. Search records contain opaque string IDs, titles, and optional release years. Details add optional normalized metadata and cover/background URL references. Unknown fields are omitted; ratings use 0–100 and precise release dates use YYYY-MM-DD. Artwork references are future cache inputs, never renderer image sources. Adapters own credentials, transport, and validation/normalization of external responses.

`resolveMetadata` accepts a literal folder-name query, provider entries in configured priority order, and an optional threshold/binding. It returns a matched proposal, an unchanged existing binding, or unresolved attempts with safe outcome codes. It has no filesystem, SQLite, Electron, configuration, or network dependency. The caller will supply INI settings during integration; no second configuration store is introduced.

The heuristic normalizes Unicode composition, case, and whitespace only. Exact titles score 1 and select the first provider-ranked exact candidate; other titles use shared-word Dice similarity capped at 0.89. The default threshold is 0.75, permitting clear approximate matches. No punctuation, edition, or sequel stripping occurs. Scores are heuristics, not match probabilities. An approximate positive score must meet the threshold and exceed the runner-up by at least 0.10. Release year is retained for future candidate display, not guessed from folder names. Lower thresholds permit more approximate matches and require later tuning against real-provider fixtures.

Disabled/unconfigured providers are skipped, duplicate provider IDs are visited once, and exact-title ties preserve provider order. Duplicate records are deduplicated; conflicting duplicates or invalid IDs/titles fail that attempt. Low confidence, ambiguity among approximate results, empty results, missing details, and provider errors permit fallback. Details must agree with the chosen record ID/title. Errors remain distinguishable from no results and omit raw exceptions. The first accepted proposal stops resolution.

Any existing manual or automatic binding bypasses all provider calls, preserving it even when priority, availability, or the folder name changes. The resolver never receives or edits manual overrides. Explicit refresh/rematching and persistence are separate later integration work. Real-provider request timeouts/rate limits, credentials, UI, artwork downloads, and automatic enrichment are not implemented in Phase 6.

## Phase 7 IGDB adapter

`IgdbProvider` implements search/detail contracts with injected fetch/time dependencies for fixtures. It uses fixed Twitch token and IGDB games endpoints with redirects disabled. Twitch credentials are form-encoded in the POST body; API requests use Client-ID and Bearer headers. Tokens stay in memory, expire with a safety margin, and are replaced once after an API 401. See the official [authentication and request contract](https://api-docs.igdb.com/#authentication) and [Twitch form POST example](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#client-credentials-flow-example).

One provider instance handles one operation at a time and rejects overlap without queuing. All request starts are spaced by 300 ms. Fetch and body consumption share a 10-second abort deadline; streamed responses are limited to 2 MiB. HTTP 429 sets a Retry-After cooldown (minimum one second), without automatic retry loops or long sleeps. Errors expose only fixed codes, never response bodies or transport exceptions.

Search strings are length-limited and escaped; detail IDs must be positive safe integers. Search fetches at most 50 records and refuses a full page as incomplete. Normalization validates IDs/titles, omits unavailable optional fields, uses the first release timestamp only for a year, and maps summary, companies, genres, and total rating. Artwork references use validated image IDs and the fixed IGDB image origin; nothing is downloaded or rendered. Requests follow the documented [IGDB fields and image format](https://api-docs.igdb.com/#images).

`ConfigService.getMetadataSettings` reads `[provider.igdb]` enabled/clientId/clientSecret and the existing metadata order/threshold for main-only callers. Provider-specific flag validation is separate from library setup, so an invalid IGDB flag does not block local browsing/scans. `configuredProviders` creates an IGDB entry only when listed in order; missing credentials or enabled=false prevent use. Reuse the instance during an explicit metadata session for shared token/rate state.

The optional `scripts/igdb-live.ts` check resolves configuration relative to its own repository location, requires `--run`, and validates search/details without catalog writes. No provider IPC, automatic scan enrichment, or matching persistence is added; application matching is Phase 8. Other providers remain their scheduled milestones.

## Phase 8 matching integration

`LibraryService` coordinates metadata with its existing operation lock and repository. Successful manual scans reconcile locally before provider work, then pass every unresolved, unbound game to the resolver. Existing bindings are preserved. A provider error leaves only that game unresolved, records a warning alongside the saved local catalog, and does not stop matching later games. Explicit per-game automatic matching remains available for an immediate retry.

Main-only provider sessions retain tokens and rate state while INI metadata settings remain unchanged. Search/selection and automatic matching check the game against the bound catalog; root/configuration changes and shutdown invalidate in-flight results before writes. Manual search caches only its latest game, settings snapshot, and candidates in memory. Selection must refer to that search, fetch matching details from an enabled/configured provider, and validate the record before saving. No renderer-supplied metadata is accepted.

Typed `autoMatch(gameId)`, `getMatchingStatus()`, `searchMatches(gameId, query, providerId?)`, `selectMatch(gameId, providerId, recordId)`, `fetchArtwork(gameId, steamGridDbId?)`, and `confirmArtwork(gameId)` IPC validates trusted frames, exact arguments, IDs, optional SteamGridDB IDs, and query bounds. Manual search defaults to the first enabled metadata provider and may target one enabled metadata-capable provider; SteamGridDB is never searchable because it supplies artwork only. Candidates expose only provider/record IDs, title, optional year, and a provider-reported artwork marker. Matching status exposes only bounded progress counts and the local game folder name. Artwork fetching stages local previews and requires confirmation before changing an association; confirmed replacement may replace pasted/manual artwork. Artwork is manual only when written by the clipboard paste operation; all provider/API downloads are provider artwork. Changing a metadata match refreshes provider-cached artwork but preserves pasted artwork. Catalog DTOs add binding status and allowlisted metadata. Remote artwork URLs, raw provider objects, and credentials never reach these views. Svelte renders metadata as text.

`CatalogRepository.saveMatch` uses the existing schema in one SQL update. It stores binding source/provider/record/confidence and allowlisted metadata while preserving manual overrides and all path/presence/date fields. Automatic saves apply only to unbound unmatched games; manual selection is an explicit replacement. Failed retrieval never clears existing data. Display applies manual fields over provider values, including explicit null clearing. Artwork persistence and general metadata refresh/editing remain later work.

The renderer adds Needs Matching, per-game automatic matching, candidate search/selection, and available metadata in details. Navigation, query text, and candidates remain transient. Matching operations are sequential; scanning/matching buttons wait for completion, while the current catalog can still be navigated. Tests use the real adapter with fake main-process fetch responses, plus temporary SQLite/filesystem fixtures; the production app contains no test-provider switch.

## Phase 9 TheGamesDB and priority

`TheGamesDbProvider` implements metadata search/details through the fixed `api.thegamesdb.net` origin using the [published API schema](https://api.thegamesdb.net/spec.yaml). TheGamesDB requires `apikey` as a query parameter. Main encodes it, forbids redirects, and exposes only fixed error codes; request URLs, response pagination links, and bodies never enter diagnostics or renderer DTOs. The provider uses one active operation, 300 ms spacing, a 10-second request/body deadline, and a 2 MiB streamed response limit.

Search uses `/v1.1/Games/ByGameName`, details use `/v1/Games/ByGameID`. Paginated or inconsistent result counts are rejected as incomplete/invalid rather than followed. Metadata maps literal titles, overview, and release year. Developer/publisher/genre IDs use the respective ByID endpoints, with at most 50 IDs per field and per-session in-memory name caching. Unknown/malformed lookup records fail the detail attempt. The provider's rating is an age classification and is omitted from review scores. No artwork request or download is introduced.

HTTP 403 is reported as key-or-quota rejection, since the API uses it for both. HTTP 429 respects Retry-After with a minimum one-second cooldown. Reported exhausted allowance prevents further requests until the reported reset interval; there are no automatic retry loops or background requests.

Main-only configuration adds `[provider.thegamesdb]` enabled/apiKey. The missing-order default is `igdb,thegamesdb`; existing INI values remain unchanged. `configuredProviders` follows the supplied order, deduplicates IDs, and ignores unsupported IDs. Invalid enabled flags disable only that provider; absent credentials skip it. Session instances persist until metadata configuration changes. Existing resolver fallback handles errors, ambiguity, and confidence independently for each provider; a successful fallback is saved normally. Manual search returns both providers' candidates, while selection still fetches only the explicitly chosen provider's record. Reordering never refreshes or replaces existing bindings.

## Artwork and offline behavior

Phase 10 adds the `artwork` table and `data/artwork` cache. A successful explicit match may cache artwork from its selected metadata record, then use enabled SteamGridDB as supplemental fallback. The cache uses bounded HTTPS downloads, validates JPEG/PNG/WebP signatures, writes a unique temporary sibling before atomic replacement, and stores only an opaque relative filename. The renderer receives a `gameshelf-artwork:` local URL, never a remote URL; its protocol handler only resolves validated cache basenames. Missing cache records render a bundled CSS placeholder. Provider cache writes cannot replace a `manual` row reserved for Phase 11.

Store covers/backgrounds under `data/artwork`, with database references. Precedence is **manual artwork > cached provider artwork > bundled placeholder**. Clipboard paste reads image data only on a user action, validates/decodes it, and writes a local asset. Normal refresh and cache maintenance must protect manual assets.

Provider downloads use temporary files followed by atomic replacement; failures leave usable cached/manual assets intact. The renderer never hotlinks remote images. Bundle UI assets/fonts. All network access is confined to enabled metadata/artwork providers and their required authentication/image endpoints. No startup scan, telemetry, background polling, updater, or unrelated network request.

## Maintenance and lifetime

Acquire the single-instance lock before opening the database; a second launch focuses the existing window. Close database work cleanly on exit. Updates replace application files manually and retain configuration/data; migrations handle older databases.

Phase 2 obtains Electron's [single-instance lock](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata) before configuration initialization. A rejected launch quits; the primary process restores, shows, and focuses its window. No database is opened in this milestone.

Deleting a missing entry removes catalog data only, never its installer folder. Database rebuild is a separate destructive catalog operation with explicit confirmation describing loss of matches/manual metadata and artwork associations. Validate the root first, retain a recoverable prior database until replacement succeeds, and never touch installer contents or erase INI settings. Rebuild is not a normal rescan or replace-all rescrape.

## Current MVP editing and maintenance

The Settings UI persists collection preferences, provider order/enabled state and credential replacements, confidence threshold, opt-in greedy matching, and default sort through validated IPC. It is divided into General, Library, and Providers tabs; library selection, manual scanning, and catalog maintenance live under Library. Title/year/genre/collection filters and navigation remain transient. Every launch starts on Home, which groups by release decade or genre; the first scan and rebuild establish a baseline excluded from Recently added.

The manual editor exposes title and description overrides and clipboard-pasted covers/backgrounds. Display applies manual values over provider data. Explicit replace-all rescrape fetches the bound provider record before clearing manual work. Clear-all metadata removes the binding, provider/manual metadata, and provider artwork associations but preserves pasted artwork. Confirmed Fetch artwork previews may replace pasted artwork; normal provider cache writes may not.

Missing-record deletion is explicit. Rebuild validates a complete scan, retains a recoverable database backup until replacement succeeds, and restores it on failure. Wipe removes catalog/cache/log state while preserving INI settings and credentials. Neither operation modifies game files.

## Known deviation: opening locations

The intended product boundary is to open game locations in Explorer only. The current UI instead labels `openInstallFolder` as **Install**. The path resolver returns folders and ISO parents, but returns ZIP/RAR/EXE paths directly to `shell.openPath`; an EXE may therefore execute. `openContainerFolder` resolves file entries to their parent directory. This is a known implementation deviation, not authorization to add launching or installation. See the [user guide](USER_GUIDE.md#open-a-games-folder) for the current folder-opening workaround. No application behavior was changed during the documentation pass.
