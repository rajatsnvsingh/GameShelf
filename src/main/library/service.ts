/** Coordinates catalog operations while keeping scanning, persistence, and providers separate. */
import { lstat, rename, rm, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  ArtworkPreview,
  ArtworkPreviewItem,
  CatalogView,
  LibraryState,
  OperationResult,
  MatchSearch,
  MatchCandidate,
  MatchingStatus,
} from '../../shared/api.ts';
import { ConfigService } from '../config/service.ts';
import { openCatalog } from '../database/catalog.ts';
import type { CatalogRepository } from '../database/repository.ts';
import { resolveInstallFolder } from '../system/install-folder.ts';
import { createScanReader, type ScanReader } from './directory-reader.ts';
import { scanLibrary } from './scanner.ts';
import { providerSession, configuredProviders } from '../metadata/service.ts';
import { resolveMetadata } from '../metadata/resolver.ts';
import { metadataTitle } from '../metadata/title.ts';
import { displayMetadata } from '../metadata/display.ts';
import { ArtworkCache } from '../artwork/cache.ts';
import type { GameDetails, ProviderEntry } from '../metadata/provider.ts';

type Settings = NonNullable<
  Awaited<ReturnType<ConfigService['getLibrarySettings']>>
>;
type StagedArtwork = {
  kind: 'cover' | 'background';
  localPath: string;
  remoteUrl: string;
};

/** Coordinates catalog operations while keeping scanning, persistence, and providers separate. */
export class LibraryService {
  private readonly base: string;
  private readonly config: ConfigService;
  private readonly openDirectory: (path: string) => Promise<string>;
  private readonly reader: (root: string) => Promise<ScanReader>;
  private repository: CatalogRepository | null = null;
  private repositoryRoot = '';
  private busy = false;
  private closed = false;
  private readonly providers: () => ReturnType<typeof configuredProviders>;
  private readonly artwork: ArtworkCache;
  private candidates: {
    gameId: number;
    settings: string;
    items: MatchCandidate[];
  } | null = null;
  private artworkPreview: {
    gameId: number;
    settings: string;
    items: StagedArtwork[];
  } | null = null;
  private matchingStatus: MatchingStatus = {
    phase: 'idle',
    attempted: 0,
    total: 0,
    matched: 0,
  };

  constructor(
    base: string,
    config: ConfigService,
    openDirectory: (path: string) => Promise<string>,
    reader = createScanReader,
    providers = providerSession(config),
    artwork = new ArtworkCache(base)
  ) {
    this.base = base;
    this.config = config;
    this.openDirectory = openDirectory;
    this.reader = reader;
    this.providers = providers;
    this.artwork = artwork;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy || this.closed)
      throw new Error('Library operation unavailable.');
    this.busy = true;
    try {
      return await operation();
    } finally {
      this.busy = false;
    }
  }

  getMatchingStatus(): MatchingStatus {
    return { ...this.matchingStatus };
  }

  private async repositoryFor(
    settings: Settings,
    create = false
  ): Promise<CatalogRepository | null> {
    if (this.closed) throw new Error('Library closed.');
    const key = settings.relativeRoot.replaceAll('\\', '/').toLowerCase();
    if (this.repository && this.repositoryRoot !== key) {
      this.repository.close();
      this.repository = null;
    }
    if (!this.repository) {
      if (!create) {
        try {
          await stat(join(this.base, 'data', 'library.db'));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
          throw error;
        }
      }
      if (this.closed) throw new Error('Library closed.');
      this.repository = openCatalog(
        this.base,
        settings.relativeRoot,
        this.config.allowCrossDriveRoots
      );
      this.repositoryRoot = key;
    }

    return this.repository;
  }

  private view(repo: CatalogRepository | null): CatalogView {
    return {
      games:
        repo
          ?.listGames()
          .map(
            ({
              id,
              folderName,
              relativePath,
              collectionId,
              addedAt,
              lastSeenAt,
              missing,
              matchStatus,
              bindingSource,
              providerId,
              providerRecordId,
              providerMetadata,
              manualOverrides,
            }) => ({
              id,
              folderName: metadataTitle(folderName),
              displayName: metadataTitle(folderName),
              relativePath,
              collectionId,
              addedAt,
              lastSeenAt,
              missing,
              matchStatus,
              bindingSource,
              providerId,
              providerRecordId,
              screenshotUrls: repo
                .listScreenshots(id)
                .map((item) => `gameshelf-artwork://local/${item.localPath}`),
              metadata: displayMetadata(providerMetadata, manualOverrides),
              ...Object.fromEntries(
                repo
                  .listArtwork(id)
                  .map((item) => [
                    item.kind === 'cover' ? 'coverUrl' : 'backgroundUrl',
                    `gameshelf-artwork://local/${item.localPath}`,
                  ])
              ),
            })
          ) ?? [],
      collections:
        repo
          ?.listCollections()
          .map(({ id, folderName, displayName, missing }) => ({
            id,
            folderName,
            displayName,
            missing,
          })) ?? [],
    };
  }

  async getCatalog(): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const settings = await this.config.getLibrarySettings();

        return {
          ok: true,
          value: this.view(
            settings ? await this.repositoryFor(settings) : null
          ),
        };
      });
    } catch {
      return {
        ok: false,
        message:
          'Cannot read the catalog. Check config.ini and the data folder. If you selected a different library, open Settings and choose Rebuild catalog.',
      };
    }
  }

  async chooseRoot(
    pick: () => Promise<string | undefined>
  ): Promise<LibraryState> {
    try {
      return await this.run(() => this.config.chooseRoot(pick));
    } catch {
      return {
        ...(await this.config.getState()),
        message:
          'Wait for the current library operation to finish, then retry.',
      };
    }
  }

  private async verifySettings(expected: Settings): Promise<void> {
    const current = await this.config.getLibrarySettings();
    if (
      this.closed ||
      current?.root.toLowerCase() !== expected.root.toLowerCase() ||
      current.collectionPrefix !== expected.collectionPrefix
    ) {
      throw new Error('Library settings changed.');
    }
  }

  async scan(): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        this.matchingStatus = {
          phase: 'scanning',
          attempted: 0,
          total: 0,
          matched: 0,
          message: 'Scanning library…',
        };
        const settings = await this.config.getLibrarySettings();
        const state = await this.config.getState();
        if (
          !settings ||
          state.status !== 'ready' ||
          state.root !== settings.root
        ) {
          return {
            ok: false,
            message:
              'The library folder is unavailable. Choose a valid folder or reconnect the drive; the catalog was not changed.',
          };
        }
        const reader = await this.reader(settings.root);
        const result = await scanLibrary(settings, reader.listDirectory);
        if (result.status === 'failed') {
          return {
            ok: false,
            message: `Scan failed at ${result.error.relativePath || 'the library root'}. The catalog was not changed.`,
          };
        }
        await reader.verifyUnchanged();
        await this.verifySettings(settings);
        const repo = await this.repositoryFor(settings, true);
        if (this.closed) throw new Error('Library closed.');
        repo!.reconcile(result);
        let matched = 0;
        let metadataNotice = '';
        // Local reconciliation is already committed. Provider failures cannot undo it.
        try {
          const session = await this.providers();
          const metadataSettings = await this.matchSettings();
          const metadataProviders = session.providers.filter(
            (entry) => entry.provider.capabilities.metadata !== false
          );
          if (
            metadataProviders.some((entry) => entry.enabled && entry.configured)
          ) {
            const unresolved = repo!
              .listGames()
              .filter(
                (game) => game.matchStatus === 'unmatched' && !game.providerId
              );
            this.matchingStatus = {
              phase: 'matching',
              attempted: 0,
              total: unresolved.length,
              matched,
              message: unresolved.length
                ? 'Matching unresolved games…'
                : 'No unresolved games to match.',
            };
            for (const game of unresolved) {
              this.matchingStatus = {
                ...this.matchingStatus,
                attempted: this.matchingStatus.attempted + 1,
                gameName: game.folderName,
              };
              const title = metadataTitle(game.folderName);
              const resolution = await resolveMetadata(
                title,
                metadataProviders,
                {
                  threshold: session.threshold,
                  greedyMatch: session.greedyMatch,
                }
              );
              await this.verifySettings(settings);
              if (metadataSettings !== (await this.matchSettings()))
                throw new Error('Metadata settings changed.');
              if (resolution.status === 'matched') {
                if (
                  repo!.saveMatch(
                    game.id,
                    resolution.binding,
                    resolution.details
                  )
                ) {
                  matched++;
                  this.matchingStatus = { ...this.matchingStatus, matched };
                  await this.cacheArtwork(
                    game.id,
                    title,
                    resolution.details,
                    resolution.binding.providerId,
                    session.providers,
                    repo!
                  );
                }
              } else if (
                'attempts' in resolution &&
                resolution.attempts.some(
                  (attempt) => attempt.outcome === 'error'
                )
              ) {
                // A provider failure applies only to this game. Keep the local scan and the rest of
                // the matching pass moving; unresolved games remain available for a later retry.
                metadataNotice =
                  ' Some provider requests failed; unresolved games can be retried from Needs Matching.';
              }
            }
          } else {
            this.matchingStatus = {
              phase: 'complete',
              attempted: 0,
              total: 0,
              matched: 0,
              message: 'No enabled metadata provider is configured.',
            };
          }
        } catch {
          if (this.closed)
            return {
              ok: false,
              message: 'Library closed after the local scan was saved.',
            };
          metadataNotice =
            ' Metadata unavailable; the local scan was saved. Use Needs Matching to retry.';
        }
        this.matchingStatus = {
          ...this.matchingStatus,
          phase: 'complete',
          matched,
          message: metadataNotice
            ? `${matched} of ${this.matchingStatus.total} unresolved games matched. Some provider requests failed.`
            : `${matched} of ${this.matchingStatus.total} unresolved games matched.`,
        };

        return {
          ok: true,
          value: this.view(repo),
          message: `Scan complete: ${result.games.length} games and ${result.collections.length} collections found. ${matched} of ${this.matchingStatus.total} unresolved games matched.${metadataNotice}`,
        };
      });
    } catch (error) {
      this.matchingStatus = {
        ...this.matchingStatus,
        phase: 'complete',
        message: 'Scan or matching could not finish.',
      };
      if (
        error instanceof Error &&
        error.message ===
          'Catalog belongs to a different library; an explicit rebuild is required.'
      ) {
        return {
          ok: false,
          message:
            'This catalog belongs to the previously selected library. Open Settings and choose Rebuild catalog to replace it with the selected library.',
        };
      }

      return {
        ok: false,
        message:
          'Scan could not finish. Check the library, configuration, and data folder, then retry. Existing catalog records were preserved.',
      };
    }
  }

  async openInstallFolder(gameId: number): Promise<OperationResult<null>> {
    try {
      return await this.run(async () => {
        if (!Number.isSafeInteger(gameId) || gameId <= 0)
          return { ok: false, message: 'Invalid game ID.' };
        const settings = await this.config.getLibrarySettings();
        if (!settings)
          return { ok: false, message: 'Choose your library folder first.' };
        const repo = await this.repositoryFor(settings);
        const game = repo?.listGames().find((item) => item.id === gameId);
        if (!game)
          return {
            ok: false,
            message: 'Game not found in the current catalog.',
          };
        if ((await this.config.getState()).status !== 'ready')
          return {
            ok: false,
            message:
              'The library folder is unavailable. Reconnect the drive and retry.',
          };
        const path = await resolveInstallFolder(
          settings.root,
          game.relativePath
        );
        await this.verifySettings(settings);
        const error = await this.openDirectory(path);

        return error
          ? {
              ok: false,
              message: 'Windows could not open the install location.',
            }
          : { ok: true, value: null, message: 'Install location opened.' };
      });
    } catch {
      return {
        ok: false,
        message:
          'The install location is missing, inaccessible, linked, or no longer a recognized folder/archive in this library.',
      };
    }
  }

  async openContainerFolder(gameId: number): Promise<OperationResult<null>> {
    try {
      return await this.run(async () => {
        if (!Number.isSafeInteger(gameId) || gameId <= 0)
          return { ok: false, message: 'Invalid game ID.' };
        const settings = await this.config.getLibrarySettings();
        if (!settings)
          return { ok: false, message: 'Choose your library folder first.' };
        const repo = await this.repositoryFor(settings);
        const game = repo?.listGames().find((item) => item.id === gameId);
        if (!game)
          return {
            ok: false,
            message: 'Game not found in the current catalog.',
          };
        if ((await this.config.getState()).status !== 'ready')
          return {
            ok: false,
            message:
              'The library folder is unavailable. Reconnect the drive and retry.',
          };
        const path = await resolveInstallFolder(
          settings.root,
          game.relativePath,
          true
        );
        await this.verifySettings(settings);
        const error = await this.openDirectory(path);

        return error
          ? {
              ok: false,
              message: 'Windows could not open the container folder.',
            }
          : { ok: true, value: null, message: 'Container folder opened.' };
      });
    } catch {
      return {
        ok: false,
        message:
          'The container folder is missing, inaccessible, linked, or no longer recognized in this library.',
      };
    }
  }

  private async matchSettings(): Promise<string> {
    return JSON.stringify({
      library: await this.config.getLibrarySettings(),
      metadata: await this.config.getMetadataSettings(),
    });
  }

  private async matchContext(gameId: number) {
    if (!Number.isSafeInteger(gameId) || gameId <= 0)
      throw new Error('Invalid game ID.');
    const settings = await this.config.getLibrarySettings();
    if (!settings) throw new Error('Library not configured.');
    const repo = await this.repositoryFor(settings);
    const game = repo?.listGames().find((item) => item.id === gameId);
    if (!repo || !game) throw new Error('Game not found.');

    return { repo, game, key: await this.matchSettings() };
  }

  private async verifyMatchContext(key: string): Promise<void> {
    if (this.closed || key !== (await this.matchSettings()))
      throw new Error('Matching settings changed.');
    if (this.closed) throw new Error('Library closed.');
  }

  private async cacheArtwork(
    gameId: number,
    title: string,
    details: GameDetails,
    selectedProvider: string,
    providers: readonly ProviderEntry[],
    repo: CatalogRepository,
    options: {
      replaceProvider?: boolean;
      steamGridDbId?: string;
      cacheScreenshots?: boolean;
      preserveExistingScreenshots?: boolean;
    } = {}
  ): Promise<number> {
    if (
      options.cacheScreenshots !== false &&
      selectedProvider === 'igdb' &&
      providers.some(
        (item) => item.provider.id === 'igdb' && item.enabled && item.configured
      )
    ) {
      try {
        await this.cacheScreenshots(
          gameId,
          details,
          repo,
          await this.matchSettings(),
          options.preserveExistingScreenshots
        );
      } catch {
        /* Optional screenshots cannot undo a saved match or block cover caching. */
      }
    }
    const saved = new Map(
      repo.listArtwork(gameId).map((item) => [item.kind, item.source])
    );
    const written = new Set<'cover' | 'background'>();
    let downloaded = 0;
    const artworkProviders = providers
      .filter((item) => item.provider.id === selectedProvider)
      .concat(
        providers.filter(
          (item) =>
            item.provider.id === 'steamgriddb' &&
            item.provider.id !== selectedProvider
        )
      );
    for (const { provider, enabled, configured } of artworkProviders) {
      if (
        !enabled ||
        !configured ||
        !provider.capabilities.artwork.length ||
        written.size === 2
      )
        continue;
      // Descriptive providers contribute only the selected record's references. SteamGridDB is the
      // configured supplemental lookup, so artwork caching never rematches through another metadata source.
      if (provider.id !== selectedProvider && provider.id !== 'steamgriddb')
        continue;
      let candidate: GameDetails | null = null;
      try {
        if (provider.id === selectedProvider) candidate = details;
        else if (provider.id === 'steamgriddb' && options.steamGridDbId)
          candidate = await provider.getGame(options.steamGridDbId);
        else {
          const results = await provider.search(title);
          const exact = results.find(
            (item) =>
              item.title.normalize('NFC').trim().toLowerCase() ===
              title.normalize('NFC').trim().toLowerCase()
          );
          if (exact) candidate = await provider.getGame(exact.recordId);
        }
        for (const reference of candidate?.artwork ?? []) {
          const existing = saved.get(reference.kind);
          if (
            written.has(reference.kind) ||
            existing === 'manual' ||
            (existing === 'provider' && !options.replaceProvider) ||
            !provider.capabilities.artwork.includes(reference.kind)
          )
            continue;
          const localPath = await this.artwork.download(gameId, reference);
          if (
            repo.saveProviderArtwork(
              gameId,
              reference.kind,
              localPath,
              reference.url
            )
          ) {
            saved.set(reference.kind, 'provider');
            written.add(reference.kind);
            downloaded++;
          }
        }
      } catch {
        /* A failed source leaves earlier cached artwork usable and tries the next provider. */
      }
    }

    return downloaded;
  }

  private async cacheScreenshots(
    gameId: number,
    details: GameDetails,
    repo: CatalogRepository,
    key: string,
    preserveExisting = false
  ): Promise<boolean> {
    if (!details.screenshots) return false;
    const previous = repo.listScreenshots(gameId);
    const items: { localPath: string; remoteUrl: string }[] = [];
    let failed = false;
    for (const url of [
      ...new Set(details.screenshots.map((item) => item.url)),
    ].slice(0, 5)) {
      const cached = previous.find((item) => item.remoteUrl === url);
      if (cached && (await this.cachedArtworkExists(cached.localPath))) {
        items.push(cached);
        continue;
      }
      try {
        const localPath = await this.artwork.download(gameId, {
          kind: 'screenshot',
          url,
        });
        items.push({ localPath, remoteUrl: url });
      } catch {
        failed = true;
      }
      await this.verifyMatchContext(key);
    }
    // Keep usable cached images when a refresh only partially succeeds.
    if (failed || preserveExisting) {
      for (const item of previous) {
        if (
          items.length < 5 &&
          !items.some((saved) => saved.remoteUrl === item.remoteUrl)
        )
          items.push(item);
      }
    }
    await this.verifyMatchContext(key);
    repo.replaceScreenshots(gameId, details.recordId, items);

    return !failed;
  }

  private async cachedArtworkExists(localPath: string): Promise<boolean> {
    try {
      return (
        await stat(join(this.base, 'data', 'artwork', localPath))
      ).isFile();
    } catch {
      return false;
    }
  }

  async fetchScreenshots(
    gameId: number
  ): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo, game, key } = await this.matchContext(gameId);
        if (game.providerId !== 'igdb' || !game.providerRecordId)
          return { ok: false, message: 'Screenshots require an IGDB match.' };
        const session = await this.providers();
        const entry = session.providers.find(
          (item) =>
            item.provider.id === 'igdb' && item.enabled && item.configured
        );
        if (!entry)
          return {
            ok: false,
            message: 'Enable and configure IGDB to fetch screenshots.',
          };
        const details = await entry.provider.getGame(game.providerRecordId);
        if (!details || details.recordId !== game.providerRecordId)
          throw new Error();
        await this.verifyMatchContext(key);
        const complete = await this.cacheScreenshots(
          gameId,
          details,
          repo,
          key
        );
        const count = repo.listScreenshots(gameId).length;

        return {
          ok: true,
          value: this.view(repo),
          message: complete
            ? count
              ? `${count} screenshots cached.`
              : 'No screenshots are available from IGDB.'
            : 'Some screenshots could not be fetched. Existing cached screenshots were preserved.',
        };
      });
    } catch {
      return {
        ok: false,
        message:
          'Could not fetch screenshots. Existing cached screenshots were preserved.',
      };
    }
  }

  async fetchMissingMetadata(): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const settings = await this.config.getLibrarySettings();
        const repo = settings ? await this.repositoryFor(settings) : null;
        if (!repo)
          return { ok: false, message: 'There is no catalog to update.' };
        const session = await this.providers();
        const key = await this.matchSettings();
        const games = repo
          .listGames()
          .filter(
            (game) =>
              game.matchStatus === 'matched' &&
              game.providerId &&
              game.providerRecordId
          );
        let fetched = 0;
        let unavailable = 0;
        let failed = 0;
        for (const game of games) {
          const entry = session.providers.find(
            (item) =>
              item.provider.id === game.providerId &&
              item.enabled &&
              item.configured &&
              item.provider.capabilities.metadata !== false
          );
          if (!entry) {
            unavailable++;
            continue;
          }
          try {
            const details = await entry.provider.getGame(
              game.providerRecordId!
            );
            if (!details || details.recordId !== game.providerRecordId)
              throw new Error('Invalid details.');
            await this.verifyMatchContext(key);
            repo.mergeMissingBoundMatch(
              game.id,
              game.providerId!,
              game.providerRecordId!,
              details
            );
            const artwork = repo.listArtwork(game.id);
            const needsArtwork =
              !artwork.some((item) => item.kind === 'cover') ||
              !artwork.some((item) => item.kind === 'background');
            const needsScreenshots =
              game.providerId === 'igdb' &&
              repo.listScreenshots(game.id).length < 5;
            if (needsArtwork || needsScreenshots) {
              await this.cacheArtwork(
                game.id,
                metadataTitle(game.folderName),
                details,
                game.providerId!,
                session.providers,
                repo,
                {
                  cacheScreenshots: needsScreenshots,
                  preserveExistingScreenshots: true,
                }
              );
            }
            fetched++;
          } catch {
            failed++;
          }
        }
        const notices = [
          `Fetched missing data for ${fetched} of ${games.length} matched game${games.length === 1 ? '' : 's'}.`,
          unavailable
            ? `${unavailable} skipped because its provider is disabled or not configured.`
            : '',
          failed
            ? `${failed} provider request${failed === 1 ? '' : 's'} failed; existing data was preserved.`
            : '',
        ].filter(Boolean);

        return { ok: true, value: this.view(repo), message: notices.join(' ') };
      });
    } catch {
      return {
        ok: false,
        message:
          'Could not fetch missing metadata. Existing catalog data was preserved.',
      };
    }
  }

  private async stageArtwork(
    gameId: number,
    title: string,
    details: GameDetails,
    selectedProvider: string,
    providers: readonly ProviderEntry[],
    steamGridDbId?: string
  ): Promise<StagedArtwork[]> {
    const staged = new Map<'cover' | 'background', StagedArtwork>();
    const artworkProviders = providers
      .filter((item) => item.provider.id === selectedProvider)
      .concat(
        providers.filter(
          (item) =>
            item.provider.id === 'steamgriddb' &&
            item.provider.id !== selectedProvider
        )
      );
    for (const { provider, enabled, configured } of artworkProviders) {
      if (
        !enabled ||
        !configured ||
        !provider.capabilities.artwork.length ||
        staged.size === 2
      )
        continue;
      let candidate: GameDetails | null = null;
      try {
        if (provider.id === selectedProvider) candidate = details;
        else if (steamGridDbId)
          candidate = await provider.getGame(steamGridDbId);
        else {
          const results = await provider.search(title);
          const exact = results.find(
            (item) =>
              item.title.normalize('NFC').trim().toLowerCase() ===
              title.normalize('NFC').trim().toLowerCase()
          );
          if (exact) candidate = await provider.getGame(exact.recordId);
        }
        for (const reference of candidate?.artwork ?? []) {
          if (
            staged.has(reference.kind) ||
            !provider.capabilities.artwork.includes(reference.kind)
          )
            continue;
          staged.set(reference.kind, {
            kind: reference.kind,
            localPath: await this.artwork.download(gameId, reference, true),
            remoteUrl: reference.url,
          });
        }
      } catch {
        /* Preview failures leave existing artwork unchanged and allow fallback. */
      }
    }

    return [...staged.values()];
  }

  async autoMatch(gameId: number): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo, game, key } = await this.matchContext(gameId);
        if (game.matchStatus === 'matched' || game.providerId)
          return {
            ok: true,
            value: this.view(repo),
            message: 'Existing match preserved.',
          };
        const session = await this.providers();
        const metadataProviders = session.providers.filter(
          (entry) => entry.provider.capabilities.metadata !== false
        );
        if (
          !metadataProviders.some((entry) => entry.enabled && entry.configured)
        )
          return {
            ok: false,
            message:
              'Enable and configure a metadata provider in config.ini first.',
          };
        const title = metadataTitle(game.folderName);
        const result = await resolveMetadata(title, metadataProviders, {
          threshold: session.threshold,
          greedyMatch: session.greedyMatch,
        });
        await this.verifyMatchContext(key);
        if (result.status === 'matched') {
          repo.saveMatch(gameId, result.binding, result.details);
          await this.cacheArtwork(
            gameId,
            title,
            result.details,
            result.binding.providerId,
            session.providers,
            repo
          );

          return {
            ok: true,
            value: this.view(repo),
            message: 'Metadata matched and saved.',
          };
        }

        return {
          ok: true,
          value: this.view(repo),
          message:
            result.status === 'unresolved' &&
            result.attempts.some((attempt) => attempt.outcome === 'error')
              ? 'Provider request failed. Existing catalog data was preserved; retry or search manually.'
              : 'No confident unique match. Search and select a candidate manually.',
        };
      });
    } catch {
      return {
        ok: false,
        message:
          'Could not match this game. Check configuration and retry; existing metadata was preserved.',
      };
    }
  }

  async searchMatches(
    gameId: number,
    query: string,
    providerId?: string
  ): Promise<OperationResult<MatchSearch>> {
    try {
      return await this.run(async () => {
        this.candidates = null;
        if (
          typeof query !== 'string' ||
          !query.trim() ||
          query.length > 250 ||
          /[\x00-\x1f]/.test(query)
        )
          throw new Error('Invalid search.');
        const { key } = await this.matchContext(gameId);
        const session = await this.providers();
        const enabled = session.providers.filter(
          (entry) =>
            entry.enabled &&
            entry.configured &&
            entry.provider.capabilities.metadata !== false
        );
        if (!enabled.length)
          return {
            ok: false,
            message:
              'Enable and configure a metadata provider in config.ini first.',
          };
        const selected = providerId
          ? enabled.filter((entry) => entry.provider.id === providerId)
          : enabled.slice(0, 1);
        if (!selected.length)
          return {
            ok: false,
            message: 'That metadata provider is not enabled and configured.',
          };
        const candidates: MatchCandidate[] = [];
        let failed = false;
        for (const { provider } of selected) {
          try {
            const results = await provider.search(query);
            for (const item of results.slice(0, 50)) {
              if (
                typeof item.recordId !== 'string' ||
                !item.recordId ||
                typeof item.title !== 'string' ||
                !item.title.trim() ||
                (item.platforms !== undefined &&
                  (!Array.isArray(item.platforms) ||
                    item.platforms.length > 50 ||
                    item.platforms.some(
                      (platform) =>
                        typeof platform !== 'string' ||
                        !platform.trim() ||
                        platform.length > 200
                    )))
              )
                throw new Error('Invalid candidate.');
              if (
                !candidates.some(
                  (candidate) =>
                    candidate.providerId === provider.id &&
                    candidate.recordId === item.recordId
                )
              ) {
                candidates.push({
                  providerId: provider.id,
                  recordId: item.recordId,
                  title: item.title,
                  ...(Number.isInteger(item.releaseYear)
                    ? { releaseYear: item.releaseYear }
                    : {}),
                  ...(item.platforms?.length
                    ? { platforms: [...item.platforms] }
                    : {}),
                  ...(item.hasArtwork === true ? { hasArtwork: true } : {}),
                });
              }
            }
          } catch {
            failed = true;
          }
        }
        await this.verifyMatchContext(key);
        this.candidates = { gameId, settings: key, items: candidates };

        return {
          ok: true,
          value: { candidates },
          message: failed
            ? 'Some provider requests failed or were too broad. Try a more specific search or retry.'
            : candidates.length
              ? 'Select the correct game to save its match.'
              : 'No candidates found. Try a different title.',
        };
      });
    } catch {
      return {
        ok: false,
        message: 'Could not search for matches. Check configuration and retry.',
      };
    }
  }

  async selectMatch(
    gameId: number,
    providerId: string,
    recordId: string
  ): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo, key } = await this.matchContext(gameId);
        const candidate =
          this.candidates?.gameId === gameId && this.candidates.settings === key
            ? this.candidates.items.find(
                (item) =>
                  item.providerId === providerId && item.recordId === recordId
              )
            : undefined;
        if (!candidate)
          return {
            ok: false,
            message: 'Search again before selecting a candidate.',
          };
        const session = await this.providers();
        const entry = session.providers.find(
          (item) =>
            item.provider.id === providerId && item.enabled && item.configured
        );
        if (!entry) throw new Error('Provider unavailable.');
        const details = await entry.provider.getGame(recordId);
        if (
          !details ||
          details.recordId !== recordId ||
          details.title !== candidate.title
        )
          throw new Error('Candidate changed.');
        await this.verifyMatchContext(key);
        if (
          !repo.saveMatch(
            gameId,
            {
              providerId,
              providerRecordId: recordId,
              source: 'manual',
              confidence: null,
            },
            details
          )
        )
          throw new Error('Game unavailable.');
        const artworkCount = await this.cacheArtwork(
          gameId,
          candidate.title,
          details,
          providerId,
          session.providers,
          repo,
          { replaceProvider: true }
        );
        this.candidates = null;
        this.artworkPreview = null;

        return {
          ok: true,
          value: this.view(repo),
          message: `Manual match saved. ${artworkCount} provider artwork item${artworkCount === 1 ? '' : 's'} refreshed.`,
        };
      });
    } catch {
      return {
        ok: false,
        message:
          'Could not save this match. Existing metadata was preserved; search again and retry.',
      };
    }
  }

  async saveOverrides(
    gameId: number,
    overrides: Record<string, unknown>
  ): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo } = await this.matchContext(gameId);
        if (!repo.saveManualOverrides(gameId, overrides)) throw new Error();

        return {
          ok: true,
          value: this.view(repo),
          message: 'Manual metadata saved.',
        };
      });
    } catch {
      return {
        ok: false,
        message: 'Could not save manual metadata. Existing data was preserved.',
      };
    }
  }
  async clearMetadata(gameId: number): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo } = await this.matchContext(gameId);
        if (!repo.clearMetadata(gameId)) throw new Error();
        this.candidates = null;
        this.artworkPreview = null;

        return {
          ok: true,
          value: this.view(repo),
          message: 'Metadata cleared. This game now needs matching.',
        };
      });
    } catch {
      return {
        ok: false,
        message: 'Could not clear metadata. Existing data was preserved.',
      };
    }
  }
  async pasteArtwork(
    gameId: number,
    kind: 'cover' | 'background',
    png: Uint8Array
  ): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo } = await this.matchContext(gameId);
        const path = await this.artwork.saveManualPng(gameId, png);
        if (!repo.saveManualArtwork(gameId, kind, path)) throw new Error();

        return {
          ok: true,
          value: this.view(repo),
          message: 'Custom artwork saved.',
        };
      });
    } catch {
      return {
        ok: false,
        message:
          'Clipboard does not contain a usable image; existing artwork was preserved.',
      };
    }
  }
  async fetchArtwork(
    gameId: number,
    steamGridDbId?: string
  ): Promise<OperationResult<ArtworkPreview>> {
    try {
      return await this.run(async () => {
        const { repo, game, key } = await this.matchContext(gameId);
        if (!game.providerId || !game.providerRecordId)
          return {
            ok: false,
            message: 'Match this game before requesting artwork.',
          };
        const session = await this.providers();
        const entry = session.providers.find(
          (item) =>
            item.provider.id === game.providerId &&
            item.enabled &&
            item.configured
        );
        if (!entry)
          return {
            ok: false,
            message:
              'The matched metadata provider is not enabled and configured.',
          };
        const details = await entry.provider.getGame(game.providerRecordId);
        if (!details || details.recordId !== game.providerRecordId)
          throw new Error();
        await this.verifyMatchContext(key);
        const staged = await this.stageArtwork(
          gameId,
          metadataTitle(game.folderName),
          details,
          game.providerId,
          session.providers,
          steamGridDbId
        );
        await this.verifyMatchContext(key);
        if (!staged.length)
          return {
            ok: false,
            message: 'No new artwork was available to preview.',
          };
        const saved = new Map(
          repo.listArtwork(gameId).map((item) => [item.kind, item])
        );
        const items: ArtworkPreviewItem[] = staged.map((item) => {
          const current = saved.get(item.kind);

          return {
            kind: item.kind,
            currentUrl: current
              ? `gameshelf-artwork://local/${current.localPath}`
              : undefined,
            currentSource: current?.source,
            proposedUrl: `gameshelf-artwork://local/${item.localPath}`,
          };
        });
        this.artworkPreview = { gameId, settings: key, items: staged };

        return {
          ok: true,
          value: { items },
          message: 'Review the proposed artwork, then confirm replacement.',
        };
      });
    } catch {
      return {
        ok: false,
        message:
          'Could not prepare artwork preview. Existing artwork was unchanged.',
      };
    }
  }
  async confirmArtwork(gameId: number): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo, key } = await this.matchContext(gameId);
        const preview = this.artworkPreview;
        if (!preview || preview.gameId !== gameId || preview.settings !== key)
          throw new Error();
        await this.verifyMatchContext(key);
        for (const item of preview.items) {
          if (
            !repo.replaceWithProviderArtwork(
              gameId,
              item.kind,
              item.localPath,
              item.remoteUrl
            )
          )
            throw new Error();
        }
        this.artworkPreview = null;

        return {
          ok: true,
          value: this.view(repo),
          message: `${preview.items.length} artwork item${preview.items.length === 1 ? '' : 's'} replaced. User-supplied artwork is now replaced by provider artwork where confirmed.`,
        };
      });
    } catch {
      return {
        ok: false,
        message:
          'Artwork confirmation expired or failed. Existing artwork was unchanged.',
      };
    }
  }
  async replaceAllRescrape(
    gameId: number
  ): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo, game, key } = await this.matchContext(gameId);
        if (!game.providerId || !game.providerRecordId) throw new Error();
        const session = await this.providers();
        const entry = session.providers.find(
          (item) =>
            item.provider.id === game.providerId &&
            item.enabled &&
            item.configured
        );
        if (!entry) throw new Error();
        const details = await entry.provider.getGame(game.providerRecordId);
        if (!details) throw new Error();
        await this.verifyMatchContext(key);
        if (
          !repo.refreshBoundMatch(
            gameId,
            game.providerId,
            game.providerRecordId,
            details
          )
        )
          throw new Error();
        repo.clearManualWork(gameId);
        await this.cacheArtwork(
          gameId,
          metadataTitle(game.folderName),
          details,
          game.providerId,
          session.providers,
          repo
        );

        return {
          ok: true,
          value: this.view(repo),
          message: 'Provider data replaced all manual metadata and artwork.',
        };
      });
    } catch {
      return {
        ok: false,
        message: 'Rescrape failed; manual metadata and artwork were preserved.',
      };
    }
  }
  async deleteMissing(): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const settings = await this.config.getLibrarySettings();
        const repo = settings ? await this.repositoryFor(settings) : null;
        if (!repo)
          return { ok: false, message: 'There is no catalog to maintain.' };
        const count = repo.deleteMissing();

        return {
          ok: true,
          value: this.view(repo),
          message: `${count} missing catalog record${count === 1 ? '' : 's'} removed. Installer folders were not changed.`,
        };
      });
    } catch {
      return {
        ok: false,
        message: 'Could not remove missing catalog records.',
      };
    }
  }
  async rebuildCatalog(): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const settings = await this.config.getLibrarySettings();
        const state = await this.config.getState();
        if (!settings || state.status !== 'ready')
          return {
            ok: false,
            message: 'The library must be available before rebuilding.',
          };
        const reader = await this.reader(settings.root);
        const scan = await scanLibrary(settings, reader.listDirectory);
        if (scan.status !== 'complete')
          return {
            ok: false,
            message:
              'The library scan failed; the existing catalog was preserved.',
          };
        await reader.verifyUnchanged();
        await this.verifySettings(settings);
        const database = join(this.base, 'data', 'library.db');
        const backup = `${database}.rebuild-backup`;
        this.repository?.close();
        this.repository = null;
        this.repositoryRoot = '';
        try {
          await unlink(backup);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        await rename(database, backup);
        try {
          const repo = await this.repositoryFor(settings, true);
          repo!.reconcile(scan);
          await unlink(backup);

          return {
            ok: true,
            value: this.view(repo),
            message:
              'Catalog rebuilt from the current library. Prior matches, overrides, and artwork associations were removed; installer folders were not changed.',
          };
        } catch (error) {
          try {
            const reopened = this.repository as CatalogRepository | null;
            reopened?.close();
          } catch {}
          this.repository = null;
          try {
            await unlink(database);
          } catch {}
          await rename(backup, database);
          throw error;
        }
      });
    } catch {
      return {
        ok: false,
        message: 'Catalog rebuild failed; the previous catalog was restored.',
      };
    }
  }
  async wipeLibrary(): Promise<OperationResult<null>> {
    try {
      return await this.run(async () => {
        this.repository?.close();
        this.repository = null;
        this.repositoryRoot = '';
        this.candidates = null;
        this.artworkPreview = null;
        const data = join(this.base, 'data');
        try {
          const info = await lstat(data);
          if (info.isSymbolicLink()) await unlink(data);
          else await rm(data, { recursive: true, force: true });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
        this.matchingStatus = {
          phase: 'idle',
          attempted: 0,
          total: 0,
          matched: 0,
        };

        return {
          ok: true,
          value: null,
          message:
            'Library catalog data was wiped. Settings, credentials, game folders, and archives were not changed.',
        };
      });
    } catch {
      return {
        ok: false,
        message:
          'Could not wipe GameShelf data. Your game folders were not changed.',
      };
    }
  }

  close(): void {
    this.closed = true;
    this.candidates = null;
    this.artworkPreview = null;
    this.repository?.close();
    this.repository = null;
  }
}
