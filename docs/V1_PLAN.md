# GameShelf v1 implementation plan

Implement in the order below. Each milestone ends with its acceptance checks and a concise report; proceeding to the next milestone requires a new implementation task. The project overview is in [README](../README.md); settled scope is in [DECISIONS](DECISIONS.md), technical contracts are in [ARCHITECTURE](ARCHITECTURE.md), and setup and use are in the [user guide](USER_GUIDE.md).

| # | Milestone | Deliverable and acceptance checks |
| --- | --- | --- |
| 1 | Foundation | Scaffold Electron + Svelte 5 + TypeScript + Vite, main/preload/renderer boundaries, typed bridge, and test tooling. Open a minimal window; verify isolated renderer, type check, and build. Document actual development commands. |
| 2 | Portable config | Establish the portable base, INI parsing/writing and defaults, root picker, relative path resolution, and single-instance behavior. Test missing/invalid config, unavailable root, spaces/Unicode, and relocation. Keep data outside the scan tree. |
| 3 | Pure scanner + tests | Inject directory listing into a deterministic scanner, with no Electron, database, or provider dependency. Test normal games, collections, empty folders/collections, loose files, nested folders that must not be visited, and listing failures. |
| 4 | SQLite, migrations, reconciliation | Introduce the repository, versioned migrations, path identity, and transactional reconciliation. Test new/present/missing/reappearing entries, repeat scans, preserved added dates/overrides, and no missing-state updates after incomplete scans. |
| 5 | Minimal UI + Explorer action | Select root, manually scan, list games/collections, open details, and invoke **Open Install Folder** by game ID. Verify basic catalog operation without network or metadata, correct collection paths, and missing-folder errors. |
| 6 | Provider abstraction | Define normalized search/detail/artwork contracts and a separate resolver with fake providers. Test confidence/ambiguity handling, disabled providers, errors, and preserved manual matches. No real provider required yet. |
| 7 | First provider: IGDB | Implement IGDB through the abstraction, with INI credentials, bounded requests, error handling, and normalized metadata. Test fixtures plus an optional configured live check. Local use survives authentication/network failure. |
| 8 | Matching UI | Add Needs Matching, candidate display, manual search/selection, and persistent provider + record ID binding. Verify ambiguous results remain unresolved and manual bindings survive rescans/restarts. |
| 9 | Second provider + priority | Add TheGamesDB after IGDB in the default configured fallback order. Test order, disabled/misconfigured sources, failure fallback, and manual binding precedence. Do not silently rematch existing bindings when priorities change. |
| 10 | Artwork cache + SteamGridDB | Add SteamGridDB for supplemental artwork, after IGDB and TheGamesDB in default artwork priority. Download cover/background artwork through enabled providers and store relative cache references. Verify provider fallback, preserved metadata bindings, cached offline rendering, placeholders, interrupted downloads, and no remote image loads from the renderer. |
| 11 | Manual metadata/artwork | Add editable metadata and custom cover/background images, including clipboard paste. Test field-level override precedence across refresh/restart and explicit replace-all rescrape behavior. |
| 12 | Polish | Complete Playnite-inspired Home, All Games, Collections, details, and Needs Matching. Add title search, year/collection filters, alphabetical/release-date sorting, collection visibility toggle, keyboard usability, and clear empty/missing/error states. Search still finds collection games when hidden from the main listing. |
| 13 | Settings | Complete settings UI over the existing INI service: root, collection prefix, collection visibility, provider credentials/enabled state/priority, matching threshold, and default sort. Test persistence and validation; never persist incidental UI state or return stored secrets to ordinary view queries. |
| 14 | Maintenance/rebuild | Add explicit catalog-record deletion for missing entries and a separately confirmed database rebuild. Explain loss of matches/overrides before rebuild; preserve installer folders and INI. Test cancel/confirm, unavailable-root refusal, and recovery on failure. Rebuild is never ordinary refresh. |
| 15 | Portable packaging | Package Windows x64 with bundled runtime and SQLite native dependency. Verify on a clean Windows environment without installation/admin rights; test drive-letter relocation, upgrades retaining data, single instance, and offline cached browsing. Document manual update procedure. |
| 16 | Hardening | Verify migration failure handling, read-only/unplugged drive behavior, incomplete scans, IPC/path validation, provider outages, secret redaction, and absence of unintended network traffic. Run an end-to-end representative library workflow and document remaining limitations. |

## Current status

The MVP (milestones 1–14) is implemented. Portable packaging (15) and final hardening (16) remain pending. Verification entries below describe the checkout at the time of each milestone, including then-future work. Current limitations, including the file-opening deviation and stale smoke expectations, are tracked in [development](DEVELOPMENT.md#known-limitations).

## Phase 1 verification (2026-09-09)

Foundation was completed before Phase 2. Keep subsequent work simple and iterate after behavior is verified.

- Dependency installation succeeded with npm and an exact-version lockfile; npm reported zero vulnerabilities at install time.
- `npm run typecheck`: passed, with zero Svelte errors or warnings.
- `npm test`: all three tests passed (valid request, untrusted caller rejection, unexpected payload rejection).
- `npm run build`: passed for main, CommonJS sandbox-compatible preload, and Svelte renderer.
- `npm run dev`: built and launched the development window. A discovered trailing-slash URL mismatch was corrected.
- Production and development Electron smoke checks passed: visible window, rendered version from IPC, only `getAppInfo` exposed, no renderer `require`/`process`, context isolation and sandbox enabled, Node integration disabled. Screenshot visually inspected.
- Build/GUI checks required execution outside the Codex filesystem sandbox on this machine. This is a development environment restriction, not an app administrator requirement.

This verifies the foundation on the current Windows machine only. Portable packaging, clean-machine checks, catalog workflows, and full hardening remain their scheduled milestones.

## Phase 2 verification (2026-09-09)

Portable configuration was completed before Phase 3.

- Acceptance results: `npm test` passed all 17 tests; `npm run typecheck` passed with zero errors/warnings; `npm run test:smoke` and `npm run test:smoke:dev` passed, including production builds. The generated screenshot was visually inspected.
- INI defaults, strict parsing, atomic root saves, native folder selection, safe library-state responses, and single-instance startup are in place.
- Unit tests cover missing/invalid INI, preservation of future provider values without exposing secrets, picker cancellation/concurrency, invalid roots and junction overlap, spaces/Unicode, folder and drive-letter relocation, restart, unavailable roots, existing-catalog switch refusal, and failed atomic replacement cleanup.
- Electron smoke tests exercise the UI and actual IPC with fake native dialog results, using only temporary fixtures. They verify persistence after relocation/restart, unavailable-root feedback, renderer isolation, and a real second process restoring the existing window and exiting.
- Native dialog presentation itself is not automated. A packaged executable, actual removable-drive reassignment, read-only/unplugged-drive fault injection, and power-loss durability are not verified here; their packaging/hardening checks remain scheduled. Drive-letter changes are covered with Windows path fixtures and relocation with actual temporary folders.
- No scanner, database, provider integration, or game-file operation has been added. INI files remain ignored by Git; `config.example.ini` is a sanitized reference only.

## Phase 3 verification (2026-09-09)

The pure scanner was completed before Phase 4.

- `npm test`: all 30 tests passed, including 13 new scanner tests. `npm run typecheck`: passed with zero errors/warnings. `npm run build`: passed. GUI smoke tests were not repeated because this milestone changes no running app code or UI.
- Scanner fixtures cover ordinary games, collections, empty libraries/games/collections, loose files, nested folders that must not be visited, custom prefixes, Unicode and spaces, ignored links/special entries, deterministic ordering, invalid names, duplicate Windows names, and root/collection listing failures.
- All listings are injected in memory. The scanner imports no Electron, filesystem, database, or provider code. Failure results omit partial discoveries, keeping later presence reconciliation separate and safe.
- No UI, IPC, real directory-listing adapter, persistence, or provider integration was added. The current app still provides Phase 2 library setup only; actual manual scanning remains an integration milestone.

## Phase 4 verification (2026-09-09)

SQLite persistence, migrations, and reconciliation were completed before Phase 5.

- `npm test`: all 50 tests passed, including 20 database tests. `npm run typecheck`: passed with zero errors/warnings. `npm run test:database:smoke`: production build and compiled repository checks passed in the actual Electron main process.
- `node scripts/smoke.mjs`: existing library setup, isolation, relocation, and single-instance regression checks passed against the built app.
- Tests cover first/repeat scans, missing/reappearing games and collections, empty snapshots, stable IDs/added dates, case/separator identity, moves/renames, preserved provider/manual data and explicit clearing, and failed/incomplete scans with no presence updates.
- Real SQLite tests verify ordered/idempotent migrations, unknown history rejection, initial and upgrade rollback, reconciliation rollback after a forced SQL failure, read-only connection failure, corrupt-file preservation, portable relocation/reopen with overrides, root-binding refusal, and storage separation.
- `better-sqlite3` 13.0.3 and its shipped Windows x64 native binary work in Node 24.14.1 and Electron 44.3.0. No rebuild dependency or command is needed for the verified setup.
- Catalogs used for verification are temporary fixtures. The real app still provides library setup only; no automatic database open, real scanner adapter, catalog UI, or provider behavior was added.
- Portable packaging, actual removable-drive/power-loss failures, and full recovery UX remain scheduled work. The migration runner reports errors and closes the database; it does not attempt a rebuild.

## Phase 5 verification (2026-09-09)

The minimal local catalog workflow was completed before Phase 6.

- `npm test`: all 65 tests passed. `npm run typecheck`: passed with zero errors/warnings. Production and development Electron smoke checks passed, including builds; the catalog screenshot was visually inspected.
- The app supports root selection, manual scans, game/collection lists, local details, and **Open Install Folder** by stored game ID. It creates a database only on the first successful scan and reads existing catalogs without an automatic scan.
- Real filesystem fixtures verify shallow listings, ignored links/files, collection membership, missing/reappearing paths, unavailable-root browsing, stable identity, failed/incomplete scans, detected directory/configuration changes, concurrent requests, shutdown, corrupt databases, and root-binding refusal. IPC rejects malformed IDs and untrusted callers; ordinary views omit provider fields and credentials.
- Electron checks exercise the UI and actual IPC, SQLite persistence, collection paths, missing-folder errors, restart/relocation, unavailable roots, isolation, and a second process. Fixtures copy the native runtime dependencies beside the compiled app; no real library or provider is used.
- Native picker responses and `shell.openPath` are replaced in smoke checks: the exact validated Explorer target is verified, but native dialog/Explorer presentation is not automated. Packaged distribution, real removable-drive interruption, and full hardening remain their scheduled milestones.
- Metadata, artwork, search/filter/sort controls, full Home/Settings screens, and maintenance flows remain later work.

## Phase 6 verification (2026-09-09)

Provider abstraction and the separate resolver were completed before Phase 7.

- `npm test`: all 79 tests passed, including 14 new metadata tests. `npm run typecheck`: passed with zero errors/warnings. `npm run build`: passed. GUI smoke tests were not repeated because this milestone adds isolated modules without changing the running app or IPC.
- Fake providers verify normalization, result-order independence, confidence thresholds, ambiguous remakes, a close runner-up below threshold, disabled/unconfigured providers, priority/fallback, empty results, search/detail failures, missing/inconsistent details, duplicate/malformed records, safe error outcomes, optional metadata/artwork, and manual/automatic binding preservation without provider calls.
- The resolver returns proposals only. Existing database tests continue to verify preservation of bindings and overrides during scans. No database migration, credentials, dependencies, network requests, renderer API, or application integration was added.
- Confidence scores are conservative heuristics rather than measured probabilities. Real-provider accuracy, transport timeouts/rate limits, and optional configured live checks remain Phase 7 and subsequent provider work. Explicit refresh/rematching and matching UI remain later integration work.

## Phase 7 verification (2026-09-09)

The IGDB adapter, main-only INI settings, and optional live check were completed before Phase 8.

- `npm test`: all 92 tests passed, including 13 IGDB tests. `npm run typecheck`: passed with zero errors/warnings. `npm run test:smoke`: production build and local catalog/isolation/relocation regression checks passed.
- Fixture checks cover token acquisition/reuse/expiry, bounded 401 retry, rate-limit cooldown, request spacing, timeout/overlap, response size, malformed/partial responses, search escaping, invalid IDs, normalized optional fields/artwork, secret-safe errors, resolver integration, preserved bindings, and INI provider isolation.
- `npm run test:igdb:live` without `--run` correctly skipped without networking. The subsequent user-authorized credentialed check passed authentication, search, and normalized details after adding igdb to providerOrder. Credentials remained ignored/untracked and no catalog/artwork files changed.
- No dependencies, database schema changes, metadata IPC, automatic enrichment, persisted matches, or artwork downloads were introduced. Existing local operation remains independent of provider availability. Native matching UI/persistence is Phase 8; TheGamesDB is Phase 9.

## Phase 8 verification (2026-09-09)

Matching UI, automatic enrichment of new discoveries, and persisted provider bindings/metadata were completed before Phase 9.

- `npm test`: all 102 tests passed, including 10 matching integration/IPC tests. `npm run typecheck`: passed with zero errors/warnings. Production build and production/development Electron smoke checks passed. Catalog and candidate-selection screenshots were visually inspected.
- Tests verify exact automatic matches, unresolved ambiguity, explicit retry for old records, manual search/selection, latest-search validation, preserved overrides including null clearing, rescan/restart persistence, automatic-overwrite refusal, failed details, provider outages after reconciliation, settings changes/shutdown preventing late writes, and strict IPC payloads.
- Electron checks use fake main-process HTTP responses with the actual IGDB adapter, resolver, repository, IPC, and UI. They verify automatic/manual matching, metadata display, unresolved ambiguity, provider failure, no renderer provider/artwork requests, and offline persistence after restart/relocation. Tests now use a temporary Chromium profile and an available loopback dev port, allowing a user instance to remain open.
- No real credentials or user library were used in Phase 8 tests. The Phase 7 live adapter check had already passed; the combined UI workflow was verified with fixtures. No migrations, dependencies, artwork downloads, or second provider were added.
- Matching remains sequential, with per-game retry/search for existing unresolved entries. Artwork, broader UI polish, and bulk maintenance remain scheduled work.

## Phase 9 verification (2026-09-09)

TheGamesDB and configured provider priority are implemented. Phases 10–16 have not started.

- `npm test`: all 112 tests passed, including 10 TheGamesDB/priority tests. `npm run typecheck`: passed with zero errors/warnings. `npm run test:smoke`: production build and two-provider Electron workflow passed.
- Fixtures verify encoded queries, normalized metadata/name lookups and cache reuse, invalid/partial responses, missing values, secret-safe failures, disabled/missing keys, response size, timeout/overlap, rate limits/quota cooldown, configured/reversed order, duplicate/unknown IDs, misconfigured-provider isolation, actual adapter fallback, and preserved manual binding after reordering/rescanning.
- Electron checks use fake HTTP responses with both real adapters. They verify first-provider automatic matching, ambiguity, candidates from both providers, explicit TheGamesDB selection, failed-provider preservation, and offline persisted matches after restart/relocation. No user library or credentials were used.
- `npm run test:thegamesdb:live` without `--run` correctly skipped. The optional credentialed TheGamesDB check has not run yet; live API compatibility remains unverified until configured. IGDB's earlier live check had passed.
- No dependencies, schema changes, new IPC, or artwork features were added. Development GUI smoke was not repeated because renderer/preload code is unchanged and production integration checks passed.

## Phase 10 verification (2026-09-09)

Artwork cache and SteamGridDB support are implemented. `npm test` passed 115 tests, `npm run typecheck` and the production `npm run build` passed, and `npm run test:smoke` passed. Tests cover local opaque cache names, image validation, interrupted downloads, protected manual rows, SteamGridDB artwork-only configuration, migrations, and local-only artwork DTOs. SteamGridDB live compatibility remains unverified until a key is explicitly configured.

## Phase 11 verification (2026-09-09)

Manual metadata overrides, clipboard-pasted PNG cover/background artwork, and explicit replace-all rescrape are implemented. `npm test` passed 117 tests, `npm run typecheck` passed, and production `npm run test:smoke` passed. Focused tests verify field-level override precedence and restart persistence, manual PNG preservation, invalid clipboard-image rejection, failure-safe rescrape, and successful replacement of manual work. The rescrape fetches the bound provider record before clearing manual data, so failures preserve it.

## Phase 12 verification (2026-09-09)

Home, All Games, Collections, details, Needs Matching, title/year/collection filters, and title/release sorting are implemented with transient renderer state. `npm test` and `npm run typecheck` passed.

## Phase 13 verification (2026-09-09)

Settings persist collection options, matching threshold, sorting default, provider order/enabled flags, and replacement credentials through redacted IPC. `npm test` and `npm run typecheck` passed. Phase 14 maintenance is intentionally not started.

## Phase 14 verification (2026-09-09)

Catalog-only maintenance adds explicit missing-record deletion and a confirmed rebuild. Rebuild performs a complete validated scan before replacing the database, keeps a recoverable sibling backup until the new catalog reconciles, and restores the backup on failure. It does not access installer contents or alter `config.ini`. `npm test` passed 119 tests and `npm run typecheck` passed; added coverage includes Phase 12 navigation/filter availability, Phase 13 settings persistence/redaction, and Phase 14 removal/rebuild recovery.

## Documentation showcase pass (2026-09-10)

Reworked the README around the MVP, added a nontechnical setup/use guide and a separate development reference, and added a local SVG banner, two Mermaid architecture diagrams, contributor guidance, and GitHub issue/PR templates. Updated current scanner documentation and distinguished historical milestone notes from present status. Recorded the existing file-opening boundary deviation without changing runtime behavior.

Verification: `npm test` passed all 130 tests; `npm run typecheck` passed with zero errors/warnings; `npm run build` passed. Local documentation links, anchors, code-fence balance, documented npm script names, and SVG XML were checked. The banner was rendered for visual inspection. Electron GUI smoke and live-provider checks were not run for this documentation-only pass; current smoke expectations need updating separately. Mermaid blocks were reviewed as source; GitHub rendering and remote repository settings were not verified or changed.

## UI polish pass (2026-09-10)

GameShelf now starts on Home. Library selection, scanning, collection preferences, and catalog maintenance are grouped in the Library tab of a three-tab Settings screen; General contains the default sort and Providers contains matching/provider configuration. Settings and the author link are anchored at the sidebar bottom. Detail actions, same-row buttons, and the search icon received spacing/alignment corrections, and the app now includes a project-owned icon for the window and renderer.

Verification: `npm test` passed all 130 tests; `npm run typecheck` passed with zero errors/warnings; `npm run build` passed and copied the icon into the renderer output. A focused production Electron check used a disposable library and verified Home startup, all three settings tabs, bottom sidebar placement, the allowlisted author URL, library/settings action spacing, search-icon centering, location-action spacing, and Edit-before-Close ordering. Its screenshot was visually inspected. No live-provider check or user library was used.

## Metadata backfill and screenshots (2026-09-10)

Existing IGDB bindings can now fetch up to five locally cached screenshots, displayed only when available in a details-page gallery with enlarge, keyboard navigation, and close controls. Settings > Library also includes **Fetch missing metadata**, an explicit compatibility action that reads existing enabled/configured bindings, fills only fields and assets absent from the local catalog, and preserves bindings, existing provider values, manual metadata, and pasted artwork. Per-game provider failures do not stop later matches.

Verification: `npm test` passed all 135 tests and `npm run typecheck` passed with zero errors or warnings. The production Electron smoke test exercised the Library backfill action. The focused screenshot Electron test verified the five-image limit, hidden empty gallery, keyboard viewer behavior, offline restart/relocation, local-only renderer loads, and the one-image/missing-cache cases. Fixture providers and temporary libraries were used; no live provider request or user catalog was accessed.

## Product completion criteria

A portable Windows build catalogs the specified folder grammar, survives relocation and restart, browses offline, protects manual work, and opens the correct folder. IGDB and TheGamesDB metadata, supplemental SteamGridDB artwork, manual matching, cached/custom artwork, settings, and explicit maintenance flows work. Other providers are deferred. All applicable checks pass or limitations are clearly recorded. No out-of-scope manager/launcher behavior is included.
