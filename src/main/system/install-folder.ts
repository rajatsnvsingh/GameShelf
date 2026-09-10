import { lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { within } from '../config/paths.ts';
import { catalogPath } from '../database/identity.ts';
import { isSupportedGameArchive } from '../library/scanner.ts';

/** Validates a discovered directory/archive without enumerating its contents. */
export async function resolveInstallFolder(root: string, relativePath: string): Promise<string> {
  const path = catalogPath(relativePath);
  if (path.parts.length > 2) throw new Error('Invalid game path depth.');
  const canonicalRoot = await realpath(root);
  let parent = canonicalRoot;
  for (const part of path.parts.slice(0, -1)) {
    parent = join(parent, part);
    const info = await lstat(parent);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Install folder is missing or is a link.');
    if (!within(canonicalRoot, await realpath(parent))) throw new Error('Install folder escapes the root.');
  }
  const target = join(parent, path.parts.at(-1)!);
  const info = await lstat(target);
  if (info.isSymbolicLink()) throw new Error('Install location is a link.');
  if (info.isDirectory()) {
    if (!within(canonicalRoot, await realpath(target))) throw new Error('Install folder escapes the root.');
  } else if (!info.isFile() || !isSupportedGameArchive(path.parts.at(-1)!)) {
    throw new Error('Install location is not a supported archive.');
  }
  if (await realpath(root) !== canonicalRoot) throw new Error('Library root changed.');
  return path.parts.at(-1)!.toLowerCase().endsWith('.iso') ? parent : target;
}
