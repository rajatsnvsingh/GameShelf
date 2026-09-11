/** Shared compile-time contracts for the renderer, preload bridge, and main process. */

export interface DisplayMetadata {
  title?: string;
  description?: string;
  releaseYear?: number;
  developers?: string[];
  publishers?: string[];
  genres?: string[];
  platforms?: string[];
  rating?: number;
}
export interface MatchCandidate {
  providerId: string;
  recordId: string;
  title: string;
  releaseYear?: number;
  platforms?: string[];
  hasArtwork?: boolean;
}
export interface MatchSearch {
  candidates: MatchCandidate[];
}
export interface MatchingStatus {
  phase: 'idle' | 'scanning' | 'matching' | 'complete';
  attempted: number;
  total: number;
  matched: number;
  gameName?: string;
  message?: string;
}
export interface ArtworkPreviewItem {
  kind: 'cover' | 'background';
  currentUrl?: string;
  currentSource?: 'manual' | 'provider';
  proposedUrl: string;
}
export interface ArtworkPreview {
  items: ArtworkPreviewItem[];
}

export type OperationResult<T> =
  | { ok: true; value: T; message?: string }
  | { ok: false; message: string };

export interface CatalogGame {
  id: number;
  folderName: string;
  displayName: string;
  relativePath: string;
  collectionId: number | null;
  addedAt: string;
  lastSeenAt: string;
  missing: boolean;
  matchStatus: 'unmatched' | 'matched';
  bindingSource: 'automatic' | 'manual' | null;
  providerId: string | null;
  providerRecordId: string | null;
  metadata: DisplayMetadata;
  coverUrl?: string;
  backgroundUrl?: string;
  screenshotUrls?: string[];
}

export interface CatalogCollection {
  id: number;
  folderName: string;
  displayName: string;
  missing: boolean;
}

export interface CatalogView {
  games: CatalogGame[];
  collections: CatalogCollection[];
}

export interface LibraryState {
  status: 'unconfigured' | 'ready' | 'unavailable' | 'config-error';
  root: string | null;
  message: string;
}

export interface AppInfo {
  name: string;
  version: string;
}
export interface SettingsView {
  collectionPrefix: string;
  showCollectionGames: boolean;
  matchingThreshold: number;
  greedyMatch: boolean;
  defaultSort: 'title' | 'releaseDate';
  providerOrder: string[];
  providers: Record<string, { enabled: boolean; configured: boolean }>;
}
export interface SettingsUpdate extends Omit<SettingsView, 'providers'> {
  providers: SettingsView['providers'];
  credentials?: Record<string, string>;
}

export interface GameShelfApi {
  getAppInfo(): Promise<AppInfo>;
  getLibraryState(): Promise<LibraryState>;
  chooseLibraryRoot(): Promise<LibraryState>;
  getCatalog(): Promise<OperationResult<CatalogView>>;
  scanLibrary(): Promise<OperationResult<CatalogView>>;
  openInstallFolder(gameId: number): Promise<OperationResult<null>>;
  openContainerFolder(gameId: number): Promise<OperationResult<null>>;
  autoMatch(gameId: number): Promise<OperationResult<CatalogView>>;
  getMatchingStatus(): Promise<MatchingStatus>;
  searchMatches(
    gameId: number,
    query: string,
    providerId?: string
  ): Promise<OperationResult<MatchSearch>>;
  selectMatch(
    gameId: number,
    providerId: string,
    recordId: string
  ): Promise<OperationResult<CatalogView>>;
  saveOverrides(
    gameId: number,
    overrides: DisplayMetadata
  ): Promise<OperationResult<CatalogView>>;
  pasteArtwork(
    gameId: number,
    kind: 'cover' | 'background'
  ): Promise<OperationResult<CatalogView>>;
  replaceAllRescrape(gameId: number): Promise<OperationResult<CatalogView>>;
  clearMetadata(gameId: number): Promise<OperationResult<CatalogView>>;
  fetchArtwork(
    gameId: number,
    steamGridDbId?: string
  ): Promise<OperationResult<ArtworkPreview>>;
  fetchScreenshots(gameId: number): Promise<OperationResult<CatalogView>>;
  fetchMissingMetadata(): Promise<OperationResult<CatalogView>>;
  confirmArtwork(gameId: number): Promise<OperationResult<CatalogView>>;
  getSettings(): Promise<OperationResult<SettingsView>>;
  saveSettings(
    settings: SettingsUpdate
  ): Promise<OperationResult<SettingsView>>;
  deleteMissing(): Promise<OperationResult<CatalogView>>;
  rebuildCatalog(): Promise<OperationResult<CatalogView>>;
  wipeLibrary(): Promise<OperationResult<null>>;
}
