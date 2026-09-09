export const APP_INFO_CHANNEL = 'app:get-info';
export const LIBRARY_STATE_CHANNEL = 'library:get-state';
export const CHOOSE_ROOT_CHANNEL = 'library:choose-root';
export const CATALOG_CHANNEL = 'library:get-catalog';
export const SCAN_CHANNEL = 'library:scan';
export const OPEN_INSTALL_FOLDER_CHANNEL = 'library:open-install-folder';
export const AUTO_MATCH_CHANNEL = 'metadata:auto-match';
export const SEARCH_MATCHES_CHANNEL = 'metadata:search';
export const SELECT_MATCH_CHANNEL = 'metadata:select';

export interface DisplayMetadata {
  title?: string;
  description?: string;
  releaseYear?: number;
  developers?: string[];
  publishers?: string[];
  genres?: string[];
  rating?: number;
}
export interface MatchCandidate { providerId: string; recordId: string; title: string; releaseYear?: number; }
export interface MatchSearch { candidates: MatchCandidate[]; }

export type OperationResult<T> = { ok: true; value: T; message?: string } | { ok: false; message: string };

export interface CatalogGame {
  id: number;
  folderName: string;
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

export interface GameShelfApi {
  getAppInfo(): Promise<AppInfo>;
  getLibraryState(): Promise<LibraryState>;
  chooseLibraryRoot(): Promise<LibraryState>;
  getCatalog(): Promise<OperationResult<CatalogView>>;
  scanLibrary(): Promise<OperationResult<CatalogView>>;
  openInstallFolder(gameId: number): Promise<OperationResult<null>>;
  autoMatch(gameId: number): Promise<OperationResult<CatalogView>>;
  searchMatches(gameId: number, query: string): Promise<OperationResult<MatchSearch>>;
  selectMatch(gameId: number, providerId: string, recordId: string): Promise<OperationResult<CatalogView>>;
}
