/** Compile-time contracts for deterministic shallow library discovery. */
export interface DirectoryEntry {
  readonly name: string;
  // The adapter must identify links/junctions without following their targets.
  readonly kind: 'directory' | 'file' | 'link' | 'other';
}

// Each call must return a complete immediate listing or throw. '' denotes the root.
// Other paths are root-relative, use '/', and never name a game folder.
export type ListDirectory = (
  root: string,
  relativeDirectory: string
) => Promise<readonly DirectoryEntry[]>;

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
  | {
      readonly status: 'complete';
      readonly games: readonly DiscoveredGame[];
      readonly collections: readonly DiscoveredCollection[];
    }
  | {
      readonly status: 'failed';
      readonly error: {
        readonly code: 'invalid-input' | 'invalid-entry' | 'listing-failed';
        readonly relativePath: string;
      };
    };
