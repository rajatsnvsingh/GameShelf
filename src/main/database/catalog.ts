import Database from 'better-sqlite3';
import { lstatSync, mkdirSync, realpathSync } from 'node:fs';
import { join, win32 } from 'node:path';
import { resolveRoot, validateRootLayout } from '../config/paths.ts';
import { applyMigrations } from './migrations.ts';
import { CatalogRepository } from './repository.ts';

/** Called by main only, after acquiring the app's single-instance lock. */
export function openCatalog(portableBase: string, relativeLibraryRoot: string, allowCrossDriveRoots = false): CatalogRepository {
  if (!/^[a-z]:[\\/]/i.test(portableBase)) throw new Error('An absolute portable base is required.');
  const root = resolveRoot(portableBase, relativeLibraryRoot, allowCrossDriveRoots);
  const base = realpathSync(portableBase);
  // A disconnected library must not prevent opening an existing local catalog.
  try { validateRootLayout(base, realpathSync(root), join(base, 'data'), allowCrossDriveRoots); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const data = join(base, 'data');
  const filename = join(data, 'library.db');
  for (const target of [data, filename]) {
    try { if (lstatSync(target).isSymbolicLink()) throw new Error('Catalog storage cannot use links.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  mkdirSync(data, { recursive: true });
  const db = new Database(filename);
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('journal_mode = DELETE');
    db.pragma('synchronous = FULL');
    const rootKey = (win32.isAbsolute(relativeLibraryRoot) ? win32.normalize(relativeLibraryRoot) : win32.relative(portableBase, root)).replaceAll('\\', '/').toLowerCase();
    db.transaction(() => {
      applyMigrations(db);
      const existing = db.prepare('SELECT library_root AS root FROM catalog WHERE id = 1').get() as { root: string } | undefined;
      if (existing && existing.root !== rootKey) throw new Error('Catalog belongs to a different library; an explicit rebuild is required.');
      if (!existing) db.prepare('INSERT INTO catalog (id, library_root) VALUES (1, ?)').run(rootKey);
    })();
    return new CatalogRepository(db);
  } catch (error) {
    db.close();
    throw error;
  }
}
