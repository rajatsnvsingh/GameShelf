# Working on GameShelf

## Read first

Inspect the repository and read `README.md`, `docs/V1_PLAN.md`, `docs/ARCHITECTURE.md`, and `docs/DECISIONS.md` before editing. These documents are source-of-truth context; earlier brainstorming does not override them. Follow the user's current instructions, and update affected documents when an authorized requirement changes.

## Milestone workflow

1. Identify the requested milestone and inspect existing code, scripts, tests, and dependencies. Do not assume previous milestones are complete.
2. State a short implementation plan, intended changes, and acceptance checks. Resolve routine implementation choices within the settled scope; ask only when missing information blocks the work.
3. Implement that milestone only, keeping changes small and reviewable. Do not begin later milestones, opportunistic refactors, or unrelated features.
4. Run relevant tests, type checks, and builds available in the repository. Test domain behavior and failure cases, not merely implementation details. Report checks actually run and any checks that could not run.
5. Update relevant documentation and report the outcome, limitations, and milestone status. Stop after the milestone; do not claim unverified behavior works.

## Non-negotiable boundaries

- GameShelf is a catalog. The only game filesystem action is **Open Install Folder** in Explorer. Never launch/install games or alter, delete, inspect, extract, or manage their files.
- Keep the scanner manual, shallow, deterministic, and separate from persistence and metadata. Recognize collections only at the library root. Never infer games from files.
- Normal reconciliation is idempotent: add discoveries, preserve existing data, mark missing, never auto-delete. A failed or incomplete scan must not mark entries missing.
- Use relative persisted paths with explicit bases. Keep durable state with the portable library, outside the scanned tree. Never depend on a fixed drive letter or the working directory.
- Renderer code owns presentation and transient state only. Keep filesystem, SQLite, provider calls, credential use, clipboard image processing, and Explorer operations behind a narrow typed preload API with validated IPC.
- Metadata failure must not break local browsing or scanning. Preserve manual matches and overrides during scans and normal refreshes. Replace-all rescrape and database rebuild are separate explicit user actions.
- No network beyond enabled metadata/artwork providers. No telemetry, updater, remote fonts, remote UI assets, or renderer-side provider requests.
- Persist durable settings in INI; catalog data in SQLite; artwork in local files. Do not add competing configuration stores or persist incidental navigation/search/scroll state.
- Keep scope sized for roughly 50–100 games. Do not add a server, plugin marketplace, recursive scanner, rename inference, multi-root support, or speculative abstractions.

Never commit real API keys, generated databases, caches, logs, or build output. Use fixtures and fake providers for automated tests; live provider checks must be explicitly configured and optional.
