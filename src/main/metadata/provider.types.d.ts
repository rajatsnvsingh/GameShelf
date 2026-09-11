/**
 * Compile-time contracts for normalized metadata-provider data.
 *
 * Providers translate external responses into these shapes. They do not expose
 * credentials, transport details, or renderer-facing remote URLs.
 */
export interface SearchCandidate {
  recordId: string;
  title: string;
  releaseYear?: number;
  platforms?: readonly string[];
  hasArtwork?: boolean;
}

export interface ArtworkReference {
  kind: 'cover' | 'background';
  url: string;
}

export interface GameDetails extends SearchCandidate {
  description?: string;
  releaseDate?: string;
  developers?: readonly string[];
  publishers?: readonly string[];
  genres?: readonly string[];
  platforms?: readonly string[];
  rating?: number;
  artwork: readonly ArtworkReference[];
  screenshots?: readonly { url: string }[];
}

export interface MetadataProvider {
  readonly id: string;
  readonly capabilities: {
    readonly artwork: readonly ArtworkReference['kind'][];
    readonly metadata?: boolean;
  };
  search(query: string): Promise<readonly SearchCandidate[]>;
  getGame(recordId: string): Promise<GameDetails | null>;
}

/** Describes a configured provider without disclosing its credentials. */
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
