# GameShelf architecture

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
    Collection_Example/
      Game B/
```

The **portable base** is the persistent distribution directory on the external drive, never the current working directory or a portable executable's temporary extraction directory. Resolve it explicitly for the packaging target. Configuration, SQLite, artwork, and optional logs remain there. Temporary Electron/Chromium host files are acceptable; authoritative state must not depend on them.

Implemented resolution: unpackaged development/preview uses `app.getAppPath()`; packaged mode requires the local absolute `PORTABLE_EXECUTABLE_DIR` supplied by the [electron-builder portable launcher](https://www.electron.build/nsis/). There is no extraction-directory fallback. Actual packaged verification remains Phase 15. Same-drive sibling roots may contain `..` relative to the portable base; library roots cannot contain the app or overlap its data directory. This exception does not permit traversal in future game/artwork paths. Root checks use both lexical paths and resolved filesystem paths to catch junction overlap; they do not enumerate the selected folder.

- INI library root: relative to the portable base (for example `Games`). Ask the user to select a root if missing/unavailable. The supported portable layout keeps the app, data, and library on the same drive; do not silently persist a drive-qualified fallback for a cross-drive selection.
- Game and collection paths: relative to the selected library root. For Game B above, store `Collection_Example/Game B`, not just `Game B`.
- Artwork paths: relative to the artwork directory. Use app-controlled filenames, not remote names or absolute URLs as local identities.
- Normalize separators and Windows path identity consistently; preserve the literal folder name for display. Resolve absolute paths only at runtime and reject traversal outside each permitted base.

Keep app data outside the scanned tree; validate root selection accordingly. Do not add scanner exceptions for app data. Root selection must not trigger a scan or silently reconcile a different library against the existing catalog. Relocating the same library preserves records; switching to a different library uses the explicit rebuild flow.

## Configuration

Use a single versioned `config.ini` for durable settings: relative root, collection prefix (default `Collection_`), collection-game visibility, provider enabled flags/order/API credentials, matching threshold, and default sort. Provider sections use stable provider IDs. Providers are disabled until configured and enabled by the user.

The previously discussed `0.90` threshold is an initial tuning value, not proof of correctness; validate scoring with ambiguous-title fixtures. Concrete provider choices and credential fields are selected during provider milestones, not imposed by sample configuration.

Plaintext API keys in INI are accepted. Main owns credential storage/use; settings may submit replacements through dedicated IPC, while ordinary responses return redacted status. Do not log secrets. Validate configuration and write updates atomically. Do not persist current search, selection, page, or scroll position; explicit durable defaults are distinct from transient UI state.

Phase 2 uses a strict scalar INI reader/writer without an added dependency. Missing files use defaults in memory; the first successful root selection writes version 1 and defaults. Invalid files are preserved for correction and block selection. Each save writes a unique sibling temporary file, flushes and closes it, then renames it over `config.ini`; failed replacements clean up the temporary file. Unknown scalar entries are retained, while formatting/comments are normalized. Provider sections and their validation will be introduced with the provider milestones. The initial matching threshold is `0.90`, collection games are visible by default, default sort is `title`, and provider order is empty.

## Scanner contract

Input: root plus collection prefix and an injected directory-listing adapter. Output: discovered games/collections with literal folder names, relative paths, collection membership, and success/error status. The pure classification logic has no persistence, metadata, or UI side effects.

1. List immediate root entries; ignore files.
2. A directory without the prefix is a game. Never enumerate its contents.
3. A prefixed directory is a collection, named for display by removing the prefix. List its immediate child directories as games; ignore files.
4. Stop. Even a prefixed child inside a collection is a game, not a nested collection.

Do not detect executables, archives, installers, DLC, editions, or installed state. Empty game folders count; empty collections remain collections. Use game folder names literally as initial titles/search terms; elaborate cleanup and rename detection are out of scope. Do not traverse directory links outside the root or allow them to increase scan depth. Keep unusual-folder policy simple rather than inferring content semantics.

Phase 3 implements `scanLibrary({ root, collectionPrefix }, listDirectory)` in `src/main/library/scanner.ts`, with no imports or runtime dependencies. The adapter receives the absolute root separately from a relative directory (`''` for root, otherwise a single collection folder name). It must return a complete immediate listing or throw, distinguish directories/files/links/other entries without following links, and preserve literal entry names. The real filesystem adapter is deferred until application integration; fixtures supply all listings for this milestone.

The scanner skips links (including junctions) and special entries at both levels. Prefix matching is exact and case-sensitive. A prefix-only collection keeps an empty display name after prefix removal. Output uses forward-slash relative paths and nullable collection paths for game membership. Root entries and final results use ordinal string ordering, independent of locale or adapter order; listing arrays are not mutated. Unsafe entry names or duplicate case-insensitive sibling names fail the scan rather than producing ambiguous paths.

`ScanResult` is a discriminated union: `complete` contains games/collections; `failed` contains only an error code and the relative directory where it occurred. The scanner stops on the first failure and discards all partial discoveries. Raw adapter exceptions are not exposed. A future reconciliation consumer must accept only complete results; a failed result cannot be interpreted as an empty library.

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

If the root is unavailable or any required listing fails, report the failure and do not apply presence reconciliation. Never interpret an unplugged drive or unreadable collection as an empty library. Scanning and optional enrichment are separate stages; metadata failures cannot undo a valid catalog scan. A normal scan can enrich newly discovered entries using enabled providers, but never refresh or rematch existing records implicitly.

## Metadata and matching

Providers expose stable identity/capabilities, `search(query)`, `getGame(providerId)`, and artwork references through normalized contracts. Provider-specific authentication and response mapping stay in adapters. Use bounded concurrency, timeouts, and rate-limit handling; no provider is required for catalog operation.

The resolver tries enabled/configured providers in INI order. Accept only a sufficiently confident, unambiguous candidate; otherwise continue to the next provider, then leave the game in Needs Matching. Never select the first search result merely because it exists. A failure remains distinguishable from no match, and the user can retry manually.

Manual selection stores an exact provider + record ID and overrides priority. Scans and priority changes preserve existing bindings. Normal explicit refresh uses the stored binding and updates provider data underneath manual overrides. Explicit rematching can change a binding while preserving manual fields/artwork. Only an explicit **replace-all rescrape** may clear those overrides; state its scope before execution and retain prior data if retrieval fails.

## Artwork and offline behavior

Store covers/backgrounds under `data/artwork`, with database references. Precedence is **manual artwork > cached provider artwork > bundled placeholder**. Clipboard paste reads image data only on a user action, validates/decodes it, and writes a local asset. Normal refresh and cache maintenance must protect manual assets.

Provider downloads use temporary files followed by atomic replacement; failures leave usable cached/manual assets intact. The renderer never hotlinks remote images. Bundle UI assets/fonts. All network access is confined to enabled metadata/artwork providers and their required authentication/image endpoints. No startup scan, telemetry, background polling, updater, or unrelated network request.

## Maintenance and lifetime

Acquire the single-instance lock before opening the database; a second launch focuses the existing window. Close database work cleanly on exit. Updates replace application files manually and retain configuration/data; migrations handle older databases.

Phase 2 obtains Electron's [single-instance lock](https://www.electronjs.org/docs/latest/api/app#apprequestsingleinstancelockadditionaldata) before configuration initialization. A rejected launch quits; the primary process restores, shows, and focuses its window. No database is opened in this milestone.

Deleting a missing entry removes catalog data only, never its installer folder. Database rebuild is a separate destructive catalog operation with explicit confirmation describing loss of matches/manual metadata and artwork associations. Validate the root first, retain a recoverable prior database until replacement succeeds, and never touch installer contents or erase INI settings. Rebuild is not a normal rescan or replace-all rescrape.
