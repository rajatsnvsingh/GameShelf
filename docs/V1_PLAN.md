# GameShelf v1 implementation plan

Implement in the order below. Each milestone ends with its acceptance checks and a concise report; proceeding to the next milestone requires a new implementation task. The full product scope is in [README](../README.md); technical contracts are in [ARCHITECTURE](ARCHITECTURE.md).

| # | Milestone | Deliverable and acceptance checks |
| --- | --- | --- |
| 1 | Foundation | Scaffold Electron + Svelte 5 + TypeScript + Vite, main/preload/renderer boundaries, typed bridge, and test tooling. Open a minimal window; verify isolated renderer, type check, and build. Document actual development commands. |
| 2 | Portable config | Establish the portable base, INI parsing/writing and defaults, root picker, relative path resolution, and single-instance behavior. Test missing/invalid config, unavailable root, spaces/Unicode, and relocation. Keep data outside the scan tree. |
| 3 | Pure scanner + tests | Inject directory listing into a deterministic scanner, with no Electron, database, or provider dependency. Test normal games, collections, empty folders/collections, loose files, nested folders that must not be visited, and listing failures. |
| 4 | SQLite, migrations, reconciliation | Introduce the repository, versioned migrations, path identity, and transactional reconciliation. Test new/present/missing/reappearing entries, repeat scans, preserved added dates/overrides, and no missing-state updates after incomplete scans. |
| 5 | Minimal UI + Explorer action | Select root, manually scan, list games/collections, open details, and invoke **Open Install Folder** by game ID. Verify basic catalog operation without network or metadata, correct collection paths, and missing-folder errors. |
| 6 | Provider abstraction | Define normalized search/detail/artwork contracts and a separate resolver with fake providers. Test confidence/ambiguity handling, disabled providers, errors, and preserved manual matches. No real provider required yet. |
| 7 | First provider | Implement one provider through the abstraction, with INI credentials, bounded requests, error handling, and normalized metadata. Choose the provider at this milestone; test fixtures plus an optional configured live check. Local use survives authentication/network failure. |
| 8 | Matching UI | Add Needs Matching, candidate display, manual search/selection, and persistent provider + record ID binding. Verify ambiguous results remain unresolved and manual bindings survive rescans/restarts. |
| 9 | Second provider + priority | Add a second provider and configured fallback order. Test order, disabled/misconfigured sources, failure fallback, and manual binding precedence. Do not silently rematch existing bindings when priorities change. |
| 10 | Artwork cache | Download cover/background artwork through enabled providers and store relative cache references. Verify cached offline rendering, placeholders, interrupted downloads, and no remote image loads from the renderer. |
| 11 | Manual metadata/artwork | Add editable metadata and custom cover/background images, including clipboard paste. Test field-level override precedence across refresh/restart and explicit replace-all rescrape behavior. |
| 12 | Polish | Complete Playnite-inspired Home, All Games, Collections, details, and Needs Matching. Add title search, year/collection filters, alphabetical/release-date sorting, collection visibility toggle, keyboard usability, and clear empty/missing/error states. Search still finds collection games when hidden from the main listing. |
| 13 | Settings | Complete settings UI over the existing INI service: root, collection prefix, collection visibility, provider credentials/enabled state/priority, matching threshold, and default sort. Test persistence and validation; never persist incidental UI state or return stored secrets to ordinary view queries. |
| 14 | Maintenance/rebuild | Add explicit catalog-record deletion for missing entries and a separately confirmed database rebuild. Explain loss of matches/overrides before rebuild; preserve installer folders and INI. Test cancel/confirm, unavailable-root refusal, and recovery on failure. Rebuild is never ordinary refresh. |
| 15 | Portable packaging | Package Windows x64 with bundled runtime and SQLite native dependency. Verify on a clean Windows environment without installation/admin rights; test drive-letter relocation, upgrades retaining data, single instance, and offline cached browsing. Document manual update procedure. |
| 16 | Hardening | Verify migration failure handling, read-only/unplugged drive behavior, incomplete scans, IPC/path validation, provider outages, secret redaction, and absence of unintended network traffic. Run an end-to-end representative library workflow and document remaining limitations. |

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

Portable configuration is implemented. Phases 3–16 have not started.

- Acceptance results: `npm test` passed all 17 tests; `npm run typecheck` passed with zero errors/warnings; `npm run test:smoke` and `npm run test:smoke:dev` passed, including production builds. The generated screenshot was visually inspected.
- INI defaults, strict parsing, atomic root saves, native folder selection, safe library-state responses, and single-instance startup are in place.
- Unit tests cover missing/invalid INI, preservation of future provider values without exposing secrets, picker cancellation/concurrency, invalid roots and junction overlap, spaces/Unicode, folder and drive-letter relocation, restart, unavailable roots, existing-catalog switch refusal, and failed atomic replacement cleanup.
- Electron smoke tests exercise the UI and actual IPC with fake native dialog results, using only temporary fixtures. They verify persistence after relocation/restart, unavailable-root feedback, renderer isolation, and a real second process restoring the existing window and exiting.
- Native dialog presentation itself is not automated. A packaged executable, actual removable-drive reassignment, read-only/unplugged-drive fault injection, and power-loss durability are not verified here; their packaging/hardening checks remain scheduled. Drive-letter changes are covered with Windows path fixtures and relocation with actual temporary folders.
- No scanner, database, provider integration, or game-file operation has been added. INI files remain ignored by Git; `config.example.ini` is a sanitized reference only.

## Product completion criteria

A portable Windows build catalogs the specified folder grammar, survives relocation and restart, browses offline, protects manual work, and opens the correct folder. Both providers, manual matching, cached/custom artwork, settings, and explicit maintenance flows work. All applicable checks pass or limitations are clearly recorded. No out-of-scope manager/launcher behavior is included.
