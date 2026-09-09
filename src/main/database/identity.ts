import type { ScanResult } from '../library/scanner.ts';

export function catalogPath(value: string): { path: string; key: string; parts: string[] } {
  const path = value.replaceAll('\\', '/');
  const parts = path.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*\x00-\x1f]/.test(part) || /[ .]$/.test(part))) {
    throw new Error('Invalid relative catalog path.');
  }
  return { path, key: path.toLowerCase(), parts };
}

/** Validate the complete snapshot before any presence changes can be made. */
export function validateDiscoveries(scan: Extract<ScanResult, { status: 'complete' }>): void {
  if (!Array.isArray(scan.games) || !Array.isArray(scan.collections)) throw new Error('Incomplete scan result.');
  const collections = new Set<string>();
  for (const collection of scan.collections) {
    const path = catalogPath(collection.relativePath);
    if (path.parts.length !== 1 || path.path !== collection.folderName || typeof collection.displayName !== 'string' || collections.has(path.key)) {
      throw new Error('Invalid or duplicate collection discovery.');
    }
    collections.add(path.key);
  }
  const games = new Set<string>();
  for (const game of scan.games) {
    const path = catalogPath(game.relativePath);
    const parent = game.collectionPath === null ? null : catalogPath(game.collectionPath);
    if (path.parts.at(-1) !== game.folderName || games.has(path.key) || collections.has(path.key) ||
      (parent === null ? path.parts.length !== 1 :
        path.parts.length !== 2 || parent.parts.length !== 1 || path.parts[0].toLowerCase() !== parent.key || !collections.has(parent.key))) {
      throw new Error('Invalid or duplicate game discovery.');
    }
    games.add(path.key);
  }
}
