import { stat } from 'node:fs/promises';
import { join, win32 } from 'node:path';
import type { CatalogView, LibraryState, OperationResult } from '../../shared/api.ts';
import { ConfigService } from '../config/service.ts';
import { openCatalog } from '../database/catalog.ts';
import type { CatalogRepository } from '../database/repository.ts';
import { resolveInstallFolder } from '../system/install-folder.ts';
import { createScanReader, type ScanReader } from './directory-reader.ts';
import { scanLibrary } from './scanner.ts';

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

  constructor(base: string, config: ConfigService, openDirectory: (path: string) => Promise<string>, reader = createScanReader) {
    this.base = base;
    this.config = config;
    this.openDirectory = openDirectory;
    this.reader = reader;
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
      games: repo?.listGames().map(({ id, folderName, relativePath, collectionId, addedAt, lastSeenAt, missing }) =>
        ({ id, folderName, relativePath, collectionId, addedAt, lastSeenAt, missing })) ?? [],
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
        repo!.reconcile(result);
        return { ok: true, value: this.view(repo), message: `Scan complete: ${result.games.length} games and ${result.collections.length} collections found.` };
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

  close(): void {
    this.closed = true;
    this.repository?.close();
    this.repository = null;
  }
}
