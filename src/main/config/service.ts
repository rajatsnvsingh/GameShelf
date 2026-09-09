import { constants } from 'node:fs';
import { access, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { LibraryState } from '../../shared/api.ts';
import { parseIni, withDefaults, writeIni, type Ini } from './ini.ts';
import { relativeRoot, resolveRoot, validateRootLayout } from './paths.ts';
import type { IgdbSettings } from '../metadata/igdb.ts';

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
  async getMetadataSettings(): Promise<{ igdb: IgdbSettings; threshold: number; providerOrder: string[] }> {
    const ini = await this.read();
    const provider = ini['provider.igdb'] ?? {};
    if (provider.enabled !== undefined && !['true', 'false'].includes(provider.enabled)) throw new Error('Invalid IGDB enabled setting.');
    return { igdb: { enabled: provider.enabled === 'true', clientId: provider.clientId ?? '', clientSecret: provider.clientSecret ?? '' },
      threshold: Number(ini.metadata.matchingThreshold),
      providerOrder: ini.metadata.providerOrder.split(',').map(id => id.trim()).filter(Boolean) };
  }

  async getLibrarySettings(): Promise<{ root: string; relativeRoot: string; collectionPrefix: string } | null> {
    const ini = await this.read();
    if (!ini.library.root) return null;
    return { root: resolveRoot(this.base, ini.library.root), relativeRoot: ini.library.root, collectionPrefix: ini.library.collectionPrefix };
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
