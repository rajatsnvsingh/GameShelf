# GameShelf decisions

This is the concise decision ledger. [Architecture](ARCHITECTURE.md) defines behavior; [the plan](V1_PLAN.md) defines implementation order. Update these together when requirements change.

## Settled for v1

| Area | Decision |
| --- | --- |
| Product | Local installer-folder catalog named GameShelf. Only game filesystem action: **Open Install Folder**. |
| Platform | Windows-only portable desktop app, targeting x64; no installation/admin requirement or background service. |
| Stack | Electron + Svelte 5 + TypeScript + Vite, embedded SQLite, INI configuration. Earlier React/browser-mode ideas are superseded. |
| Storage | Durable config, database, cached/custom artwork, and any logs stay with the portable library. Temporary host Electron files are acceptable. |
| Paths | Root relative to portable base; game/collection paths relative to root; artwork paths relative to cache. Preserve collection segments. No fixed drive letters. |
| Discovery | One user-selected root. Immediate directories are games, except `Collection_` directories whose immediate child directories are games. No deeper scan or file inspection. |
| Names | Literal game folder names initially. Collection display names omit the prefix. No edition parsing or rename inference. |
| Collections | Separate collection views; configurable inclusion of members in main library. Members always remain searchable. Prefix defaults to `Collection_` and is an INI setting. |
| Scans | Manual only. Add new, mark missing, never auto-delete. Failed/incomplete scans do not change presence state. |
| Identity | Relative path initially identifies a game. Rename/move may become an old missing entry and a new entry. |
| Metadata | Optional; multiple enabled providers with INI priority and credentials. Only confident, unambiguous auto-matches; otherwise manual matching. |
| Manual work | Stored manual matches override provider order. Manual metadata/artwork overrides survive normal scans/refreshes; only explicit replace-all rescrape may replace them. |
| Artwork | Covers and backgrounds first; locally cached, with clipboard-paste custom images. Manual > cached provider > placeholder. |
| UI | Playnite-inspired, windowed, mouse/keyboard. Home (recently added, collections, all games), All Games, Collections, details, Needs Matching, Settings. |
| Discovery UI | Title search, year/collection filters, alphabetical/release-date sorts. Omit unavailable metadata sections. |
| Settings | INI holds durable choices and plaintext API keys. Do not persist incidental UI state. |
| Network | Only enabled metadata/artwork provider traffic; no telemetry or automatic updates. Local catalog works without providers and offline after caching. |
| Lifetime | Single app instance; manual application updates; migrations preserve usable existing catalogs. |
| Maintenance | Explicit deletion of missing catalog entries; separately confirmed database rebuild. Never delete or modify installer folders. |
| Delivery | One milestone per implementation task: inspect, plan, implement, test, report. No scope expansion. |

## Phase 1 tooling

Phase 1 tooling: npm with exact dependency versions and `package-lock.json`; electron-vite for build/dev wiring, Node's built-in runner for pure tests, and Playwright's Electron API for window smoke checks. Use the smallest implementation that meets each milestone and iterate after verification. No UI framework beyond Svelte or speculative service abstractions are added.

## Phase 2 configuration

Phase 2 uses a strict scalar INI format with atomic replacement and no new dependency. The checkout is the unpackaged base; packaged builds require the portable launcher's directory. Same-drive sibling libraries are supported through relative paths. Missing config remains in memory until the user selects a valid root; invalid config is never silently reset. Collection games default to visible and sorting defaults to title. `0.90` is stored as an initial threshold only, pending fixture-based matching work.

## Phase 3 scanner

Use one dependency-free scanner with an injected immediate-directory listing function. Match collection prefixes exactly, sort by ordinal relative path, preserve literal names, and skip all links/junctions and special entries. Reject unsafe names and duplicate case-insensitive sibling names. On any listing failure, return no partial discoveries. The filesystem adapter and app wiring remain later integration work.

## Phase 4 persistence

Use `better-sqlite3` 13.0.3 with its shipped native binary, verified on this Windows x64 machine in both Node and Electron. Use a small repository, consecutive transactional migrations, DELETE journaling, and FULL synchronization. Store normalized case-insensitive path keys separately from literal relative paths. Bind the database to the relative library root and reject silent root changes. Complete scans are reconciled atomically; failed scans do nothing. Defer artwork tables, metadata editing, query-specific indexes/columns, and app wiring to their milestones.

## Phase 5 local catalog workflow

Connect the existing scanner and repository through one main-process library service. Create the database on the first successful manual scan, open existing data for offline browsing, and close it on exit. Use a small collection/game/details interface with transient selection. Resolve **Open Install Folder** from a validated game ID in main and reject missing, non-directory, or linked paths. Automated Electron checks capture the native shell target rather than opening Explorer; no providers or additional dependencies are introduced.

## Phase 6 matching foundation

Use main-only normalized provider contracts and a dependency-free resolver that returns proposals without persistence. Start conservatively: normalized exact titles score 1, other shared-word scores are capped at 0.89, and the default threshold stays 0.90. Require a 0.10 lead over the runner-up. Preserve all existing bindings without provider calls. Try enabled/configured providers sequentially in supplied priority order and return safe per-provider outcomes for unresolved/error cases. Fake providers validate this contract; actual provider wiring and request controls begin in Phase 7.

## Phase 7 IGDB

Use native fetch without a new dependency. Credentials belong in the ignored `[provider.igdb]` INI section; access tokens are memory-only. Keep one active operation, 300 ms request spacing, 10-second deadlines, 2 MiB responses, one authentication retry, and explicit retry after rate-limit cooldown. Treat a full search page as incomplete. Normalize release year without fabricating date precision. Expose the adapter through the existing contracts and an explicit optional live check; defer matching UI/persistence to Phase 8 and artwork downloads to Phase 10.

## Implementation choices still to validate

- `better-sqlite3` is verified with the current development Electron runtime; native dependency inclusion and behavior in the packaged Windows build remain to validate.
- electron-builder is the planned packaging tool; verify persistent portable-base resolution and native dependency bundling.
- Provider selection is settled: IGDB first (Phase 7), TheGamesDB second (Phase 9), and SteamGridDB third for supplemental artwork (Phase 10). Default priority is IGDB -> TheGamesDB -> SteamGridDB, applied within provider capabilities; SteamGridDB does not replace descriptive metadata. All other providers are deferred. Each provider remains optional and must use the enabled-provider boundary.
- Tune confidence scoring and ambiguity rules against fixtures. `0.90` was an example starting threshold, not an established accuracy guarantee.
- Exact schema, IPC method names, package versions, and component filenames are implementation details; preserve the documented contracts.

## Explicitly out of scope

Launching/installing/updating games; inspecting or extracting installers/archives; ISO mounting; game downloads; installed-state or playtime tracking; save management; emulators; recursive discovery; automatic scans; multiple roots; cloud sync; remote access; accounts; telemetry; automatic app updates. Do not reopen these decisions without a user-requested scope change.
