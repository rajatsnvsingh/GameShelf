import { constants } from 'node:fs';
import { access, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibraryState, SettingsUpdate, SettingsView } from '../../shared/api.ts';
import { parseIni, withDefaults, writeIni, type Ini } from './ini.ts';
import { relativeRoot, resolveRoot, validateRootLayout } from './paths.ts';
import type { IgdbSettings } from '../metadata/igdb.ts';
import type { TheGamesDbSettings } from '../metadata/thegamesdb.ts';
import type { SteamGridDbSettings } from '../metadata/steamgriddb.ts';

export async function atomicWrite(path: string, content: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx');
    try { await file.writeFile(content, 'utf8'); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
  }
}

export class ConfigService {
  private readonly file: string;
  private readonly base: string;
  private busy = false;

  constructor(base: string) { this.base = base; this.file = join(base, 'config.ini'); }

  private async read(): Promise<Ini> {
    try { return withDefaults(parseIni(await readFile(this.file, 'utf8'))); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return withDefaults(Object.create(null));
    }
  }

  private async checkRoot(root: string): Promise<void> {
    validateRootLayout(this.base, root);
    if (!(await stat(root)).isDirectory()) throw new Error('Not a directory.');
    await access(root, constants.R_OK);
    const base = await realpath(this.base);
    const canonical = await realpath(root);
    let data = join(base, 'data');
    try { data = await realpath(data); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    validateRootLayout(base, canonical, data);
  }

  // Main-process use only; never expose the full INI or provider credentials to views.
  async getMetadataSettings(): Promise<{ igdb: IgdbSettings; thegamesdb: TheGamesDbSettings; steamgriddb: SteamGridDbSettings; threshold: number; providerOrder: string[] }> {
    const ini = await this.read();
    const provider = ini['provider.igdb'] ?? {};
    const second = ini['provider.thegamesdb'] ?? {};
    const third = ini['provider.steamgriddb'] ?? {};
    // An invalid enabled flag disables only that provider; other providers and local use survive.
    return { igdb: { enabled: provider.enabled === 'true', clientId: provider.clientId ?? '', clientSecret: provider.clientSecret ?? '' },
      thegamesdb: { enabled: second.enabled === 'true', apiKey: second.apiKey ?? '' },
      steamgriddb: { enabled: third.enabled === 'true', apiKey: third.apiKey ?? '' },
      threshold: Number(ini.metadata.matchingThreshold),
      providerOrder: ini.metadata.providerOrder.split(',').map(id => id.trim()).filter(Boolean) };
  }

  async getLibrarySettings(): Promise<{ root: string; relativeRoot: string; collectionPrefix: string } | null> {
    const ini = await this.read();
    if (!ini.library.root) return null;
    return { root: resolveRoot(this.base, ini.library.root), relativeRoot: ini.library.root, collectionPrefix: ini.library.collectionPrefix };
  }
  async getSettings(): Promise<SettingsView> {
    const ini = await this.read(); const metadata = await this.getMetadataSettings();
    return { collectionPrefix: ini.library.collectionPrefix, showCollectionGames: ini.library.showCollectionGames === 'true', matchingThreshold: metadata.threshold, defaultSort: ini.view.defaultSort as 'title' | 'releaseDate', providerOrder: metadata.providerOrder,
      providers: { igdb: { enabled: metadata.igdb.enabled, configured: Boolean(metadata.igdb.clientId && metadata.igdb.clientSecret) }, thegamesdb: { enabled: metadata.thegamesdb.enabled, configured: Boolean(metadata.thegamesdb.apiKey) }, steamgriddb: { enabled: metadata.steamgriddb.enabled, configured: Boolean(metadata.steamgriddb.apiKey) } } };
  }
  async saveSettings(input: SettingsUpdate): Promise<SettingsView> {
    if (!input || typeof input !== 'object' || typeof input.collectionPrefix !== 'string' || !input.collectionPrefix || /[<>:"/\\|?*\x00-\x1f]/.test(input.collectionPrefix) || typeof input.showCollectionGames !== 'boolean' || !Number.isFinite(input.matchingThreshold) || input.matchingThreshold < 0 || input.matchingThreshold > 1 || !['title', 'releaseDate'].includes(input.defaultSort) || !Array.isArray(input.providerOrder) || input.providerOrder.some(id => !['igdb', 'thegamesdb', 'steamgriddb'].includes(id))) throw new Error('Invalid settings.');
    const ini = await this.read(); ini.library.collectionPrefix = input.collectionPrefix; ini.library.showCollectionGames = String(input.showCollectionGames); ini.metadata.matchingThreshold = input.matchingThreshold.toFixed(2); ini.metadata.providerOrder = [...new Set(input.providerOrder)].join(','); ini.view.defaultSort = input.defaultSort;
    for (const id of ['igdb', 'thegamesdb', 'steamgriddb'] as const) { const section = ini[`provider.${id}`] ??= {}; section.enabled = input.providers[id]?.enabled ? 'true' : 'false'; }
    if (input.credentials) { if (input.credentials.igdbClientId !== undefined) (ini['provider.igdb'] ??= {}).clientId = input.credentials.igdbClientId; if (input.credentials.igdbClientSecret !== undefined) (ini['provider.igdb'] ??= {}).clientSecret = input.credentials.igdbClientSecret; if (input.credentials.thegamesdbApiKey !== undefined) (ini['provider.thegamesdb'] ??= {}).apiKey = input.credentials.thegamesdbApiKey; if (input.credentials.steamgriddbApiKey !== undefined) (ini['provider.steamgriddb'] ??= {}).apiKey = input.credentials.steamgriddbApiKey; }
    await atomicWrite(this.file, writeIni(ini)); return this.getSettings();
  }

  async getState(): Promise<LibraryState> {
    let ini: Ini;
    try { ini = await this.read(); } catch {
      return { status: 'config-error', root: null, message: 'Cannot read valid config.ini. Correct the file and retry; it has not been replaced.' };
    }
    if (!ini.library.root) return { status: 'unconfigured', root: null, message: 'Choose the folder that contains your game folders.' };
    let root: string;
    try { root = resolveRoot(this.base, ini.library.root); } catch {
      return { status: 'config-error', root: null, message: 'The root in config.ini is not a supported relative library path. Correct it and retry.' };
    }
    try { await this.checkRoot(root); } catch {
      return { status: 'unavailable', root, message: 'The library folder is unavailable or overlaps app data. Reconnect the drive, retry, or choose a valid folder.' };
    }
    return { status: 'ready', root, message: 'Library folder ready. Scan when you want to update the catalog.' };
  }

  async chooseRoot(pick: () => Promise<string | undefined>): Promise<LibraryState> {
    if (this.busy) return this.getState();
    this.busy = true;
    try {
      const current = await this.getState();
      if (current.status === 'config-error') return current;
      const selected = await pick();
      if (!selected) return current;
      const ini = await this.read();
      try { await this.checkRoot(selected); } catch {
        return { ...current, message: 'Choose an available folder on the same drive, separate from GameShelf’s application and data folders.' };
      }
      const root = relativeRoot(this.base, selected);
      // Future catalogs must never be silently paired with another library.
      if (!ini.library.root || resolveRoot(this.base, root).toLowerCase() !== resolveRoot(this.base, ini.library.root).toLowerCase()) {
        try {
          await stat(join(this.base, 'data', 'library.db'));
          return { ...current, message: 'An existing catalog requires the explicit rebuild flow before changing libraries.' };
        } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      }
      ini.library.root = root;
      await atomicWrite(this.file, writeIni(ini));
      return this.getState();
    } catch {
      return { ...(await this.getState()), message: 'Could not save the library folder. Check config.ini and write access, then retry.' };
    } finally { this.busy = false; }
  }
}
