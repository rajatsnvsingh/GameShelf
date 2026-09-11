# Development

[README](../README.md) · [User guide](USER_GUIDE.md) · [Architecture](ARCHITECTURE.md) · [Decisions](DECISIONS.md)

## Local setup

Use Windows x64 and Node.js 22.12 or newer. Earlier milestone checks used Node 24.14.1 and npm 11.11.0. npm is the package manager; preserve `package-lock.json` and install with `npm ci`.

```powershell
npm ci
npm run dev
```

Initial dependency and Electron runtime downloads require network access. Renderer edits update through Vite; restart after main/preload changes or use `npm run dev -- --watch`. Close the app window to end the session. The Vite development server is loopback-only; built app resources are local.

## Commands and verification

| Command                                 | Purpose                                                                                                                          |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npm run typecheck`                     | Check main/preload/shared TypeScript and Svelte renderer types.                                                                  |
| `npm run format`                        | Format source, tests, scripts, renderer styles, and documentation with the repository's 80-column Prettier rules.                |
| `npm run format:check`                  | Verify that the repository follows the Prettier formatting rules without modifying files.                                        |
| `npm test`                              | Run domain, configuration, scanner, database, provider, artwork, filesystem-fixture, and IPC tests.                              |
| `npm run build`                         | Compile into `out/`. Does not package an executable.                                                                             |
| `npm run package:portable`              | Build the Windows x64 no-install EXE in `release/`. See [portable release](RELEASE.md) for the required verification.            |
| `npm start`                             | Preview the compiled app after a build.                                                                                          |
| `npm run test:smoke`                    | Build and exercise the UI in real Electron. Requires an interactive Windows desktop.                                             |
| `npm run test:smoke:dev`                | Run the Electron workflow against a test-owned loopback Vite server.                                                             |
| `npm run capture:screenshots`           | Build and capture README-ready views from the same temporary Electron fixture; it never reads the user's library or credentials. |
| `npm run test:database:smoke`           | Build and exercise compiled SQLite code inside Electron.                                                                         |
| `npm run test:igdb:live -- --run`       | Optional configured IGDB authentication/search/detail check.                                                                     |
| `npm run test:thegamesdb:live -- --run` | Optional configured TheGamesDB search/detail/name-lookup check.                                                                  |

Automated tests use fixtures and fake provider responses. Electron smoke scripts use temporary app/library folders, an isolated Chromium profile, and fake picker responses. They capture shell targets without opening game locations; no separate Playwright browser download is needed. Screenshots under `test-results/` are ignored and may represent older UI revisions.

Live checks require explicit configuration and `--run`. Without that flag they skip without networking. They do not scan, save catalog matches, or download artwork. Do not enable live checks in routine CI or publish credentials in test output.

`better-sqlite3` 13.0.3 is a runtime dependency. Earlier checks verified its shipped Windows x64 binary in Node 24.14.1 and Electron 44.3.0. Rerun the database smoke check after Electron/SQLite upgrades. Packaged native dependency verification remains pending.

Historical results are recorded in [V1_PLAN.md](V1_PLAN.md); they are not a claim that today's checkout passes every check. Report the commands and results from each change separately.

## Source map

| Path                                        | Responsibility                                                                     |
| ------------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/renderer/src/App.svelte`               | Renderer composition plus transient navigation, filtering, and dialog state        |
| `src/renderer/src/components/`              | Focused presentation components, beginning with reusable game and collection cards |
| `src/shared/api.ts`, `src/preload/index.ts` | Typed interface and narrow bridge                                                  |
| `src/main/ipc.ts`                           | Caller and payload validation                                                      |
| `src/main/config/`                          | INI persistence, portable base, root validation                                    |
| `src/main/library/`                         | Pure scanner, filesystem adapter, workflow orchestration                           |
| `src/main/database/`                        | SQLite schema, migrations, identity, reconciliation                                |
| `src/main/metadata/`                        | Matching resolver and provider adapters                                            |
| `src/main/artwork/`                         | Validated local image cache                                                        |
| `src/main/system/`                          | Stored-path validation for Windows shell actions                                   |
| `tests/`, `scripts/`                        | Fixture tests, Electron checks, optional live provider checks                      |

## Configuration

The app creates `config.ini` after a valid library selection. [config.example.ini](../config.example.ini) is a sanitized reference, not a file for real keys. Prefer the Settings UI; close GameShelf before manually editing the INI.

INI supports named sections, scalar `key=value` entries, blank lines, and full-line `;` or `#` comments. App-written strings use JSON quoting. Use forward slashes for paths. Duplicate sections/keys, malformed lines, unsupported versions, and invalid known settings produce an error without resetting the original file. Saves preserve unknown scalar values but normalize formatting and remove comments.

The current default order is `igdb,thegamesdb,steamgriddb`, with all providers disabled. A provider must be enabled, configured, and included in the order. Existing order values, including an empty order, are preserved. Unknown IDs are skipped and duplicates run once. Blank credential replacements from Settings preserve stored secrets; ordinary queries expose configured/enabled status only.

Development and compiled preview use the checkout as the portable base, independently of the shell working directory. Durable files are `config.ini`, `data/library.db`, and `data/artwork/`. Same-drive roots persist relative to the base, including sibling paths such as `../Games`. Development-only cross-drive roots are absolute and non-portable. The portable launcher supplies `PORTABLE_EXECUTABLE_DIR`; its clean-machine verification remains required before publishing.

Roots containing the app or overlapping its data are rejected, including resolved junction targets. Changing the selected root preserves the existing catalog and requires an explicit rebuild to replace it. A normal scan must never reconcile one library against another.

## Known limitations

- **Windows shell action:** the UI's **Install** button calls `openInstallFolder`. `resolveInstallFolder` returns folder/ISO-parent paths but returns ZIP/RAR/EXE files directly; these reach `shell.openPath`, so EXEs may execute. This violates the intended folder-only product boundary. **Open Container Folder** resolves file entries to their parent. This documentation pass records the discrepancy without changing application behavior.
- **Delivery:** milestones 1–14 comprise the implemented MVP. `npm run package:portable` creates the Windows x64 portable EXE and unpacks `better-sqlite3`'s native binary. Clean-machine deployment, manual upgrades, and actual removable-drive reassignment remain Phase 15 verification work; follow [the release procedure](RELEASE.md) before publishing.
- **Hardening:** actual unplugged/read-only drive faults, power-loss durability, and full end-to-end hardening remain Phase 16 work. Path fixtures and temporary-folder relocation are narrower evidence.
- **Smoke maintenance:** the current smoke script still expects an older preload method list and older UI labels. A failure there must be investigated; historical smoke passes do not verify the latest UI.
- **Provider compatibility:** automated checks use fakes. IGDB has a historical live check; TheGamesDB and SteamGridDB live compatibility are not established by the milestone log. Confidence scoring is a heuristic, not an accuracy guarantee.

## Repository presentation

The README uses a local decorative SVG banner with the application's icon and GitHub-native Mermaid diagrams. No external fonts, image hotlinks, generated data, or provider art are needed to display them.

Suggested GitHub About description: **A Windows game catalog with collections, local artwork, and offline browsing. Built with Electron, Svelte, and TypeScript.**

Suggested topics: `game-catalog`, `windows`, `electron`, `svelte`, `typescript`, `sqlite`, `offline-first`.

These are suggestions for repository settings, not evidence that remote settings were changed. The checkout has no project license file; this documentation pass does not assign a license or advertise one.
