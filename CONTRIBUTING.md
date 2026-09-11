# Contributing to GameShelf

Thanks for taking a look. GameShelf is a focused Windows catalog. Useful contributions include clearer documentation, reproducible bug reports, and small fixes backed by relevant checks.

## Report a problem

Use the bug report template with the app version or commit, Windows version, reproduction steps, and expected versus actual behavior. A small example folder layout is more useful than a copy of a real library. Remove API keys, private paths, and personal information from screenshots and errors. Never attach `config.ini`, a real catalog database, or game files.

## Make a change

1. Read [AGENTS.md](AGENTS.md), [README](README.md), [the plan](docs/V1_PLAN.md), [architecture](docs/ARCHITECTURE.md), and [decisions](docs/DECISIONS.md).
2. Pick one bug, documentation improvement, or agreed milestone. For a scope change, explain the use case in an issue first.
3. Follow [development setup](docs/DEVELOPMENT.md). Keep edits small and preserve existing user data.
4. Run relevant tests, `npm run typecheck`, and `npm run build`. For UI/IPC changes, also run the applicable Electron smoke checks and report any failures honestly.
5. Update affected documentation and describe the resulting behavior, checks, and limitations in the pull request.

AI-assisted contributions are welcome. Review the generated diff, understand its behavior, and report checks actually run. Prompt history is not a substitute for explaining the change.

## Keep the boundaries clear

- Catalog one library with manual, shallow scans. Failed scans must preserve presence state; normal scans preserve matches and manual work.
- Keep game files untouched. The intended filesystem action is opening their location in Explorer.
- Keep privileged work behind the typed preload API and validated main-process IPC.
- Use only explicitly enabled metadata/artwork providers for app networking. Use fixtures and fake providers in automated tests.
- Keep credentials, databases, caches, logs, dependencies, and build output out of commits. Review the staged diff; ignore rules do not protect already tracked files.

Packaging and final hardening remain separate milestones. Avoid adding launchers, installers, recursive scans, multiple roots, cloud services, or unrelated refactors to a catalog fix.
