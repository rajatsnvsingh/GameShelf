import { lstat, readdir, realpath } from 'node:fs/promises';
import type { Stats } from 'node:fs';
import { join } from 'node:path';
import { catalogPath } from '../database/identity.ts';
import type { ListDirectory } from './scanner.ts';

export interface ScanReader {
  listDirectory: ListDirectory;
  verifyUnchanged(): Promise<void>;
}

function sameDirectory(before: Stats, after: Stats): boolean {
  return after.isDirectory() && !after.isSymbolicLink() && before.dev === after.dev &&
    before.ino === after.ino && before.mtimeMs === after.mtimeMs;
}

/** Lists only the root and single child collection directories. Never follows entry links. */
export async function createScanReader(root: string): Promise<ScanReader> {
  const canonicalRoot = await realpath(root);
  const observed = new Map<string, Stats>();
  return {
    async listDirectory(requestRoot, relativeDirectory) {
      if (requestRoot !== root) throw new Error('Unexpected scan root.');
      if (relativeDirectory && catalogPath(relativeDirectory).parts.length !== 1) throw new Error('Scan depth exceeded.');
      const directory = relativeDirectory ? join(canonicalRoot, relativeDirectory) : canonicalRoot;
      const before = await lstat(directory);
      if (!before.isDirectory() || before.isSymbolicLink()) throw new Error('Not a regular scan directory.');
      const entries = await readdir(directory, { withFileTypes: true });
      if (!sameDirectory(before, await lstat(directory))) throw new Error('Directory changed while scanning.');
      observed.set(directory, before);
      return entries.map(entry => ({ name: entry.name,
        kind: entry.isSymbolicLink() ? 'link' : entry.isDirectory() ? 'directory' : entry.isFile() ? 'file' : 'other' }));
    },
    async verifyUnchanged() {
      if (await realpath(root) !== canonicalRoot) throw new Error('Scan root changed.');
      for (const [directory, before] of observed) {
        if (!sameDirectory(before, await lstat(directory))) throw new Error('Directory changed while scanning.');
      }
    }
  };
}
