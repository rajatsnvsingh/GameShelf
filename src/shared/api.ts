export const APP_INFO_CHANNEL = 'app:get-info';
export const LIBRARY_STATE_CHANNEL = 'library:get-state';
export const CHOOSE_ROOT_CHANNEL = 'library:choose-root';
export const CATALOG_CHANNEL = 'library:get-catalog';
export const SCAN_CHANNEL = 'library:scan';
export const OPEN_INSTALL_FOLDER_CHANNEL = 'library:open-install-folder';
export const OPEN_CONTAINER_FOLDER_CHANNEL = 'library:open-container-folder';
export const AUTO_MATCH_CHANNEL = 'metadata:auto-match';
export const SEARCH_MATCHES_CHANNEL = 'metadata:search';
export const SELECT_MATCH_CHANNEL = 'metadata:select';
export const SAVE_OVERRIDES_CHANNEL = 'catalog:save-overrides';
export const PASTE_ARTWORK_CHANNEL = 'catalog:paste-artwork';
export const RESCRAPE_CHANNEL = 'metadata:replace-all-rescrape';
export const CLEAR_METADATA_CHANNEL = 'metadata:clear';
export const SETTINGS_CHANNEL = 'settings:get';
export const SAVE_SETTINGS_CHANNEL = 'settings:save';
export const DELETE_MISSING_CHANNEL = 'maintenance:delete-missing';
export const REBUILD_CHANNEL = 'maintenance:rebuild';
export const WIPE_LIBRARY_CHANNEL = 'maintenance:wipe-library';
export const MATCHING_STATUS_CHANNEL = 'metadata:get-status';
export const FETCH_ARTWORK_CHANNEL = 'artwork:fetch';
export const FETCH_SCREENSHOTS_CHANNEL = 'screenshots:fetch';
export const FETCH_MISSING_METADATA_CHANNEL = 'metadata:fetch-missing';
export const CONFIRM_ARTWORK_CHANNEL = 'artwork:confirm';

export interface DisplayMetadata {
  title?: string;
  description?: string;
  releaseYear?: number;
  developers?: string[];
  publishers?: string[];
  genres?: string[];
  rating?: number;
}
export interface MatchCandidate { providerId: string; recordId: string; title: string; releaseYear?: number; hasArtwork?: boolean; }
export interface MatchSearch { candidates: MatchCandidate[]; }
export interface MatchingStatus { phase: 'idle' | 'scanning' | 'matching' | 'complete'; attempted: number; total: number; matched: number; gameName?: string; message?: string; }
export interface ArtworkPreviewItem { kind: 'cover' | 'background'; currentUrl?: string; currentSource?: 'manual' | 'provider'; proposedUrl: string; }
export interface ArtworkPreview { items: ArtworkPreviewItem[]; }

export type OperationResult<T> = { ok: true; value: T; message?: string } | { ok: false; message: string };

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

export interface CatalogView { games: CatalogGame[]; collections: CatalogCollection[]; }

export interface LibraryState {
  status: 'unconfigured' | 'ready' | 'unavailable' | 'config-error';
  root: string | null;
  message: string;
}

export interface AppInfo {
  name: string;
  version: string;
}
export interface SettingsView { collectionPrefix: string; showCollectionGames: boolean; matchingThreshold: number; greedyMatch: boolean; defaultSort: 'title' | 'releaseDate'; providerOrder: string[]; providers: Record<string, { enabled: boolean; configured: boolean }>; }
export interface SettingsUpdate extends Omit<SettingsView, 'providers'> { providers: SettingsView['providers']; credentials?: Record<string, string>; }

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
  searchMatches(gameId: number, query: string, providerId?: string): Promise<OperationResult<MatchSearch>>;
  selectMatch(gameId: number, providerId: string, recordId: string): Promise<OperationResult<CatalogView>>;
  saveOverrides(gameId: number, overrides: DisplayMetadata): Promise<OperationResult<CatalogView>>;
  pasteArtwork(gameId: number, kind: 'cover' | 'background'): Promise<OperationResult<CatalogView>>;
  replaceAllRescrape(gameId: number): Promise<OperationResult<CatalogView>>;
  clearMetadata(gameId: number): Promise<OperationResult<CatalogView>>;
  fetchArtwork(gameId: number, steamGridDbId?: string): Promise<OperationResult<ArtworkPreview>>;
  fetchScreenshots(gameId: number): Promise<OperationResult<CatalogView>>;
  fetchMissingMetadata(): Promise<OperationResult<CatalogView>>;
  confirmArtwork(gameId: number): Promise<OperationResult<CatalogView>>;
  getSettings(): Promise<OperationResult<SettingsView>>;
  saveSettings(settings: SettingsUpdate): Promise<OperationResult<SettingsView>>;
  deleteMissing(): Promise<OperationResult<CatalogView>>;
  rebuildCatalog(): Promise<OperationResult<CatalogView>>;
  wipeLibrary(): Promise<OperationResult<null>>;
}
