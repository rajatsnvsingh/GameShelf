/** Defines runtime IPC channel names and re-exports their compile-time contracts. */
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

/** Re-export the bridge contracts beside their runtime IPC channel constants. */
export type {
  AppInfo,
  ArtworkPreview,
  ArtworkPreviewItem,
  CatalogCollection,
  CatalogGame,
  CatalogView,
  DisplayMetadata,
  GameShelfApi,
  LibraryState,
  MatchCandidate,
  MatchingStatus,
  MatchSearch,
  OperationResult,
  SettingsUpdate,
  SettingsView,
} from './api.types';
