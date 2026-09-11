/** Main-process contracts. Adapters own credentials, transport, and response normalization. */
export interface SearchCandidate {
  recordId: string;
  title: string;
  releaseYear?: number;
  hasArtwork?: boolean;
}

export interface ArtworkReference {
  kind: 'cover' | 'background';
  url: string; // Remote provenance for a future main-process cache, never a renderer asset.
}

export interface GameDetails extends SearchCandidate {
  description?: string;
  releaseDate?: string; // ISO calendar date YYYY-MM-DD; omit when precision is unavailable.
  developers?: readonly string[];
  publishers?: readonly string[];
  genres?: readonly string[];
  rating?: number; // Normalized 0–100; omit when unavailable.
  artwork: readonly ArtworkReference[];
  screenshots?: readonly { url: string }[];
}

export interface MetadataProvider {
  readonly id: string;
  readonly capabilities: { readonly artwork: readonly ArtworkReference['kind'][]; readonly metadata?: boolean };
  search(query: string): Promise<readonly SearchCandidate[]>;
  getGame(recordId: string): Promise<GameDetails | null>;
}

/** Supplied in configured priority order. No credentials belong in this descriptor. */
export interface ProviderEntry {
  provider: MetadataProvider;
  enabled: boolean;
  configured: boolean;
}

export interface ProviderBinding {
  providerId: string;
  providerRecordId: string;
  source: 'automatic' | 'manual';
  confidence: number | null;
}
