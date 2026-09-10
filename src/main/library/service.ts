import { stat } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import type { CatalogView, LibraryState, OperationResult, MatchSearch, MatchCandidate } from '../../shared/api.ts';
import { ConfigService } from '../config/service.ts';
import { openCatalog } from '../database/catalog.ts';
import type { CatalogRepository } from '../database/repository.ts';
import { resolveInstallFolder } from '../system/install-folder.ts';
import { createScanReader, type ScanReader } from './directory-reader.ts';
import { scanLibrary } from './scanner.ts';
import { providerSession, configuredProviders } from '../metadata/service.ts';
import { resolveMetadata } from '../metadata/resolver.ts';
import { displayMetadata } from '../metadata/display.ts';

type Settings = NonNullable<Awaited<ReturnType<ConfigService['getLibrarySettings']>>>;

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
  private candidates: { gameId: number; settings: string; items: MatchCandidate[] } | null = null;

  constructor(base: string, config: ConfigService, openDirectory: (path: string) => Promise<string>, reader = createScanReader, providers = providerSession(config)) {
    this.base = base;
    this.config = config;
    this.openDirectory = openDirectory;
    this.reader = reader;
    this.providers = providers;
  }

  private async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.busy || this.closed) throw new Error('Library operation unavailable.');
    this.busy = true;
    try { return await operation(); } finally { this.busy = false; }
  }

  private async repositoryFor(settings: Settings, create = false): Promise<CatalogRepository | null> {
    if (this.closed) throw new Error('Library closed.');
    const key = win32.relative(this.base, settings.root).toLowerCase();
    if (this.repository && this.repositoryRoot !== key) {
      this.repository.close();
      this.repository = null;
    }
    if (!this.repository) {
      if (!create) {
        try { await stat(join(this.base, 'data', 'library.db')); }
        catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
      }
      if (this.closed) throw new Error('Library closed.');
      this.repository = openCatalog(this.base, settings.relativeRoot);
      this.repositoryRoot = key;
    }
    return this.repository;
  }

  private view(repo: CatalogRepository | null): CatalogView {
    return {
      games: repo?.listGames().map(({ id, folderName, relativePath, collectionId, addedAt, lastSeenAt, missing,
        matchStatus, bindingSource, providerId, providerRecordId, providerMetadata, manualOverrides }) =>
        ({ id, folderName, relativePath, collectionId, addedAt, lastSeenAt, missing, matchStatus, bindingSource, providerId, providerRecordId,
          metadata: displayMetadata(providerMetadata, manualOverrides) })) ?? [],
      collections: repo?.listCollections().map(({ id, folderName, displayName, missing }) => ({ id, folderName, displayName, missing })) ?? []
    };
  }

  async getCatalog(): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const settings = await this.config.getLibrarySettings();
        return { ok: true, value: this.view(settings ? await this.repositoryFor(settings) : null) };
      });
    } catch { return { ok: false, message: 'Cannot read the catalog. Check config.ini and the data folder; a different library requires a rebuild.' }; }
  }

  async chooseRoot(pick: () => Promise<string | undefined>): Promise<LibraryState> {
    try { return await this.run(() => this.config.chooseRoot(pick)); }
    catch { return { ...(await this.config.getState()), message: 'Wait for the current library operation to finish, then retry.' }; }
  }

  private async verifySettings(expected: Settings): Promise<void> {
    const current = await this.config.getLibrarySettings();
    if (this.closed || current?.root.toLowerCase() !== expected.root.toLowerCase() || current.collectionPrefix !== expected.collectionPrefix) {
      throw new Error('Library settings changed.');
    }
  }

  async scan(): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const settings = await this.config.getLibrarySettings();
        const state = await this.config.getState();
        if (!settings || state.status !== 'ready' || state.root !== settings.root) {
          return { ok: false, message: 'The library folder is unavailable. Choose a valid folder or reconnect the drive; the catalog was not changed.' };
        }
        const reader = await this.reader(settings.root);
        const result = await scanLibrary(settings, reader.listDirectory);
        if (result.status === 'failed') {
          return { ok: false, message: `Scan failed at ${result.error.relativePath || 'the library root'}. The catalog was not changed.` };
        }
        await reader.verifyUnchanged();
        await this.verifySettings(settings);
        const repo = await this.repositoryFor(settings, true);
        if (this.closed) throw new Error('Library closed.');
        const existingIds = new Set(repo!.listGames().map(game => game.id));
        repo!.reconcile(result);
        let matched = 0;
        let metadataNotice = '';
        // Local reconciliation is already committed. Provider failures cannot undo it.
        try {
          const session = await this.providers();
          const metadataSettings = await this.matchSettings();
          if (session.providers.some(entry => entry.enabled && entry.configured)) {
            for (const game of repo!.listGames().filter(game => !existingIds.has(game.id))) {
              const resolution = await resolveMetadata(game.folderName, session.providers, { threshold: session.threshold });
              await this.verifySettings(settings);
              if (metadataSettings !== await this.matchSettings()) throw new Error('Metadata settings changed.');
              if (resolution.status === 'matched') {
                if (repo!.saveMatch(game.id, resolution.binding, resolution.details)) matched++;
              } else if ('attempts' in resolution && resolution.attempts.some(attempt => attempt.outcome === 'error')) {
                metadataNotice = ' Metadata unavailable; use Needs Matching to retry.';
                break;
              }
            }
          }
        } catch {
          if (this.closed) return { ok: false, message: 'Library closed after the local scan was saved.' };
          metadataNotice = ' Metadata unavailable; the local scan was saved. Use Needs Matching to retry.';
        }
        return { ok: true, value: this.view(repo), message: `Scan complete: ${result.games.length} games and ${result.collections.length} collections found. ${matched} matched.${metadataNotice}` };
      });
    } catch { return { ok: false, message: 'Scan could not finish. Check the library, configuration, and data folder, then retry. Existing catalog records were preserved.' }; }
  }

  async openInstallFolder(gameId: number): Promise<OperationResult<null>> {
    try {
      return await this.run(async () => {
        if (!Number.isSafeInteger(gameId) || gameId <= 0) return { ok: false, message: 'Invalid game ID.' };
        const settings = await this.config.getLibrarySettings();
        if (!settings) return { ok: false, message: 'Choose your library folder first.' };
        const repo = await this.repositoryFor(settings);
        const game = repo?.listGames().find(item => item.id === gameId);
        if (!game) return { ok: false, message: 'Game not found in the current catalog.' };
        if ((await this.config.getState()).status !== 'ready') return { ok: false, message: 'The library folder is unavailable. Reconnect the drive and retry.' };
        const path = await resolveInstallFolder(settings.root, game.relativePath);
        await this.verifySettings(settings);
        const error = await this.openDirectory(path);
        return error ? { ok: false, message: 'Windows could not open the install folder.' } : { ok: true, value: null, message: 'Install folder opened.' };
      });
    } catch { return { ok: false, message: 'The install folder is missing, inaccessible, or no longer a regular folder in this library.' }; }
  }

  private async matchSettings(): Promise<string> {
    return JSON.stringify({ library: await this.config.getLibrarySettings(), metadata: await this.config.getMetadataSettings() });
  }

  private async matchContext(gameId: number) {
    if (!Number.isSafeInteger(gameId) || gameId <= 0) throw new Error('Invalid game ID.');
    const settings = await this.config.getLibrarySettings();
    if (!settings) throw new Error('Library not configured.');
    const repo = await this.repositoryFor(settings);
    const game = repo?.listGames().find(item => item.id === gameId);
    if (!repo || !game) throw new Error('Game not found.');
    return { repo, game, key: await this.matchSettings() };
  }

  private async verifyMatchContext(key: string): Promise<void> {
    if (this.closed || key !== await this.matchSettings()) throw new Error('Matching settings changed.');
    if (this.closed) throw new Error('Library closed.');
  }

  async autoMatch(gameId: number): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo, game, key } = await this.matchContext(gameId);
        if (game.matchStatus === 'matched' || game.providerId) return { ok: true, value: this.view(repo), message: 'Existing match preserved.' };
        const session = await this.providers();
        if (!session.providers.some(entry => entry.enabled && entry.configured)) return { ok: false, message: 'Enable and configure a metadata provider in config.ini first.' };
        const result = await resolveMetadata(game.folderName, session.providers, { threshold: session.threshold });
        await this.verifyMatchContext(key);
        if (result.status === 'matched') {
          repo.saveMatch(gameId, result.binding, result.details);
          return { ok: true, value: this.view(repo), message: 'Metadata matched and saved.' };
        }
        return { ok: true, value: this.view(repo), message: result.status === 'unresolved' && result.attempts.some(attempt => attempt.outcome === 'error')
          ? 'Provider request failed. Existing catalog data was preserved; retry or search manually.'
          : 'No confident unique match. Search and select a candidate manually.' };
      });
    } catch { return { ok: false, message: 'Could not match this game. Check configuration and retry; existing metadata was preserved.' }; }
  }

  async searchMatches(gameId: number, query: string): Promise<OperationResult<MatchSearch>> {
    try {
      return await this.run(async () => {
        this.candidates = null;
        if (typeof query !== 'string' || !query.trim() || query.length > 250 || /[\x00-\x1f]/.test(query)) throw new Error('Invalid search.');
        const { key } = await this.matchContext(gameId);
        const session = await this.providers();
        const enabled = session.providers.filter(entry => entry.enabled && entry.configured);
        if (!enabled.length) return { ok: false, message: 'Enable and configure a metadata provider in config.ini first.' };
        const candidates: MatchCandidate[] = [];
        let failed = false;
        for (const { provider } of enabled) {
          try {
            const results = await provider.search(query);
            for (const item of results.slice(0, 50)) {
              if (typeof item.recordId !== 'string' || !item.recordId || typeof item.title !== 'string' || !item.title.trim()) throw new Error('Invalid candidate.');
              if (!candidates.some(candidate => candidate.providerId === provider.id && candidate.recordId === item.recordId)) {
                candidates.push({ providerId: provider.id, recordId: item.recordId, title: item.title,
                  ...(Number.isInteger(item.releaseYear) ? { releaseYear: item.releaseYear } : {}) });
              }
            }
          } catch { failed = true; }
        }
        await this.verifyMatchContext(key);
        this.candidates = { gameId, settings: key, items: candidates };
        return { ok: true, value: { candidates }, message: failed ? 'Some provider requests failed or were too broad. Try a more specific search or retry.'
          : candidates.length ? 'Select the correct game to save its match.' : 'No candidates found. Try a different title.' };
      });
    } catch { return { ok: false, message: 'Could not search for matches. Check configuration and retry.' }; }
  }

  async selectMatch(gameId: number, providerId: string, recordId: string): Promise<OperationResult<CatalogView>> {
    try {
      return await this.run(async () => {
        const { repo, key } = await this.matchContext(gameId);
        const candidate = this.candidates?.gameId === gameId && this.candidates.settings === key
          ? this.candidates.items.find(item => item.providerId === providerId && item.recordId === recordId) : undefined;
        if (!candidate) return { ok: false, message: 'Search again before selecting a candidate.' };
        const session = await this.providers();
        const entry = session.providers.find(item => item.provider.id === providerId && item.enabled && item.configured);
        if (!entry) throw new Error('Provider unavailable.');
        const details = await entry.provider.getGame(recordId);
        if (!details || details.recordId !== recordId || details.title !== candidate.title) throw new Error('Candidate changed.');
        await this.verifyMatchContext(key);
        if (!repo.saveMatch(gameId, { providerId, providerRecordId: recordId, source: 'manual', confidence: null }, details)) throw new Error('Game unavailable.');
        this.candidates = null;
        return { ok: true, value: this.view(repo), message: 'Manual match saved.' };
      });
    } catch { return { ok: false, message: 'Could not save this match. Existing metadata was preserved; search again and retry.' }; }
  }

  close(): void {
    this.closed = true;
    this.candidates = null;
    this.repository?.close();
    this.repository = null;
  }
}
