/** Compile-time records exchanged between repository clients and SQLite persistence. */
export interface CollectionRecord {
  id: number;
  relativePath: string;
  folderName: string;
  displayName: string;
  addedAt: string;
  lastSeenAt: string;
  missing: boolean;
}

export interface GameRecord {
  id: number;
  relativePath: string;
  folderName: string;
  collectionId: number | null;
  addedAt: string;
  lastSeenAt: string;
  missing: boolean;
  matchStatus: 'unmatched' | 'matched';
  bindingSource: 'automatic' | 'manual' | null;
  providerId: string | null;
  providerRecordId: string | null;
  confidence: number | null;
  providerMetadata: Record<string, unknown>;
  manualOverrides: Record<string, unknown>;
}

export interface ArtworkRecord {
  kind: 'cover' | 'background';
  source: 'provider' | 'manual';
  localPath: string;
}
