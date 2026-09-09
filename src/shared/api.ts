export const APP_INFO_CHANNEL = 'app:get-info';
export const LIBRARY_STATE_CHANNEL = 'library:get-state';
export const CHOOSE_ROOT_CHANNEL = 'library:choose-root';
export const CATALOG_CHANNEL = 'library:get-catalog';
export const SCAN_CHANNEL = 'library:scan';
export const OPEN_INSTALL_FOLDER_CHANNEL = 'library:open-install-folder';

export type OperationResult<T> = { ok: true; value: T; message?: string } | { ok: false; message: string };

export interface CatalogGame {
  id: number;
  folderName: string;
  relativePath: string;
  collectionId: number | null;
  addedAt: string;
  lastSeenAt: string;
  missing: boolean;
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
}
