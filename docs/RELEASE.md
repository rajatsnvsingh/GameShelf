# Portable Windows release

GameShelf ships as one Windows x64 portable executable. It does not install
itself, require administrator rights, create an updater, or modify game files.
The executable extracts its bundled application runtime while it runs; durable
user data remains beside the executable.

The current build is **unsigned** because this project has no Authenticode
certificate. Windows may show a SmartScreen warning for a new public download.
Do not describe a release as signed unless it was built and verified with the
intended certificate on the release host.

## Build a release

Use Windows x64 with Node.js 22.12 or newer. Start from a clean checkout and
install the lockfile exactly:

```powershell
npm ci
npm run typecheck
npm test
npm run format:check
npm run test:database:smoke
npm run package:portable
```

The final command compiles the Electron application and creates
`release/GameShelf-<version>-portable.exe`. `electron-builder` packages only
production dependencies and unpacks the `better-sqlite3` native binary so it
can load outside Electron's ASAR archive.

Do not distribute `out/`, `node_modules/`, `data/`, `config.ini`, logs, API
keys, or a developer's library. The `release/` directory is ignored by Git;
copy only the portable EXE to the release location.

## First launch and portable layout

Place the EXE in a folder on the same local drive as the game library, for
example:

```text
E:\GameShelf\GameShelf-0.1.0-portable.exe
E:\Games\
```

On first launch, choose the library folder. GameShelf then creates its
portable state next to the EXE:

```text
E:\GameShelf\
  GameShelf-0.1.0-portable.exe
  config.ini
  data\library.db
  data\artwork\
```

The stored library path is relative to this application folder. Move the EXE,
`config.ini`, `data`, and the library together to another drive to retain the
catalog and artwork. Keep the application folder outside the scanned library.

## Manual update

1. Close GameShelf, including any second running instance.
2. Back up `config.ini` and `data/` if the catalog matters.
3. Replace the old portable EXE with the new one in the same folder.
4. Start the new EXE and confirm the existing catalog opens.

Do not replace or remove `config.ini` or `data/`; they contain settings,
provider credentials, cached artwork, catalog matches, and manual changes.
There is no automatic updater.

## Release acceptance check

Before publishing, copy only the EXE to a clean Windows x64 machine or VM. It
must launch without Node.js, npm, administrator rights, or a source checkout.
Choose a same-drive test library, scan it, close and relaunch, then test:

- offline browsing of saved catalog data and artwork;
- a second launch restores the existing window rather than opening another;
- moving the portable app folder and library together to another drive retains
  the catalog;
- replacing the EXE with a newer build retains `config.ini` and `data/`.

Record the Windows version, test drive setup, EXE SHA-256, package version,
and results with the release notes. Do not claim a portable release is
verified until this clean-machine check passes.
