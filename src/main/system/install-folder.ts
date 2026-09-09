import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { within } from '../config/paths.ts';
import { catalogPath } from '../database/identity.ts';

/** Checks directory metadata only; never enumerates a game's contents. */
export async function resolveInstallFolder(root: string, relativePath: string): Promise<string> {
  const path = catalogPath(relativePath);
  if (path.parts.length > 2) throw new Error('Invalid game path depth.');
  const canonicalRoot = await realpath(root);
  let target = canonicalRoot;
  for (const part of path.parts) {
    target = join(target, part);
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Install folder is missing or is a link.');
    if (!within(canonicalRoot, await realpath(target))) throw new Error('Install folder escapes the root.');
  }
  if (await realpath(root) !== canonicalRoot) throw new Error('Library root changed.');
  return target;
}
