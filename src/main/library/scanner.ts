export interface DirectoryEntry {
  readonly name: string;
  // The adapter must identify links/junctions without following their targets.
  readonly kind: 'directory' | 'file' | 'link' | 'other';
}

// Each call must return a complete immediate listing or throw. '' denotes the root.
// Other paths are root-relative, use '/', and never name a game folder.
export type ListDirectory = (root: string, relativeDirectory: string) => Promise<readonly DirectoryEntry[]>;

export interface DiscoveredGame {
  readonly folderName: string;
  readonly relativePath: string;
  readonly collectionPath: string | null;
}

export interface DiscoveredCollection {
  readonly folderName: string;
  readonly displayName: string;
  readonly relativePath: string;
}

export type ScanResult =
  | { readonly status: 'complete'; readonly games: readonly DiscoveredGame[]; readonly collections: readonly DiscoveredCollection[] }
  | { readonly status: 'failed'; readonly error: {
    readonly code: 'invalid-input' | 'invalid-entry' | 'listing-failed';
    readonly relativePath: string;
  } };

const archiveExtensions = new Set(['.zip', '.rar', '.iso']);

export function isSupportedGameArchive(name: string): boolean {
  const extension = name.slice(name.lastIndexOf('.')).toLowerCase();
  return archiveExtensions.has(extension);
}

function compare(a: string, b: string): number { return a < b ? -1 : a > b ? 1 : 0; }

function validName(name: string): boolean {
  return name.length > 0 && name !== '.' && name !== '..' && !/[<>:"/\\|?*\x00-\x1f]/.test(name);
}

function validEntries(entries: readonly DirectoryEntry[]): boolean {
  const seen = new Set<string>();
  return entries.every(entry => {
    const identity = entry.name.toLowerCase();
    if (!validName(entry.name) || seen.has(identity)) return false;
    seen.add(identity);
    return ['directory', 'file', 'link', 'other'].includes(entry.kind);
  });
}

/** Pure discovery orchestration: the injected listing function is its only effect. */
export async function scanLibrary(
  input: { readonly root: string; readonly collectionPrefix: string },
  listDirectory: ListDirectory
): Promise<ScanResult> {
  if (!/^[a-z]:[\\/]/i.test(input.root) || !validName(input.collectionPrefix)) {
    return { status: 'failed', error: { code: 'invalid-input', relativePath: '' } };
  }

  const games: DiscoveredGame[] = [];
  const collections: DiscoveredCollection[] = [];
  let listingPath = '';
  try {
    const rootEntries = await listDirectory(input.root, '');
    if (!validEntries(rootEntries)) return { status: 'failed', error: { code: 'invalid-entry', relativePath: '' } };
    for (const entry of [...rootEntries].sort((a, b) => compare(a.name, b.name))) {
      if (entry.kind === 'file' && isSupportedGameArchive(entry.name)) {
        games.push({ folderName: entry.name, relativePath: entry.name, collectionPath: null });
        continue;
      }
      if (entry.kind !== 'directory' || entry.name.startsWith('_')) continue;
      if (!entry.name.startsWith(input.collectionPrefix)) {
        games.push({ folderName: entry.name, relativePath: entry.name, collectionPath: null });
        continue;
      }

      collections.push({ folderName: entry.name, displayName: entry.name.slice(input.collectionPrefix.length).trimStart(), relativePath: entry.name });
      listingPath = entry.name;
      const children = await listDirectory(input.root, listingPath);
      if (!validEntries(children)) return { status: 'failed', error: { code: 'invalid-entry', relativePath: listingPath } };
      for (const child of children) {
        if (child.kind === 'file' && isSupportedGameArchive(child.name)) {
          games.push({ folderName: child.name, relativePath: `${entry.name}/${child.name}`, collectionPath: entry.name });
        } else if (child.kind === 'directory' && !child.name.startsWith('_')) {
          games.push({ folderName: child.name, relativePath: `${entry.name}/${child.name}`, collectionPath: entry.name });
        }
      }
    }
  } catch {
    // Do not return partial discoveries or leak raw filesystem error text.
    return { status: 'failed', error: { code: 'listing-failed', relativePath: listingPath } };
  }

  return {
    status: 'complete',
    games: games.sort((a, b) => compare(a.relativePath, b.relativePath)),
    collections
  };
}
