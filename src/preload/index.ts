import { contextBridge, ipcRenderer } from 'electron';
import {
  APP_INFO_CHANNEL,
  AUTO_MATCH_CHANNEL,
  CATALOG_CHANNEL,
  CHOOSE_ROOT_CHANNEL,
  CLEAR_METADATA_CHANNEL,
  CONFIRM_ARTWORK_CHANNEL,
  DELETE_MISSING_CHANNEL,
  FETCH_ARTWORK_CHANNEL,
  FETCH_SCREENSHOTS_CHANNEL,
  FETCH_MISSING_METADATA_CHANNEL,
  LIBRARY_STATE_CHANNEL,
  MATCHING_STATUS_CHANNEL,
  OPEN_CONTAINER_FOLDER_CHANNEL,
  OPEN_INSTALL_FOLDER_CHANNEL,
  PASTE_ARTWORK_CHANNEL,
  REBUILD_CHANNEL,
  RESCRAPE_CHANNEL,
  SAVE_OVERRIDES_CHANNEL,
  SAVE_SETTINGS_CHANNEL,
  SCAN_CHANNEL,
  SEARCH_MATCHES_CHANNEL,
  SELECT_MATCH_CHANNEL,
  SETTINGS_CHANNEL,
  type GameShelfApi,
  WIPE_LIBRARY_CHANNEL
} from '../shared/api';

// The renderer receives named application actions only. It never receives raw IPC access.
const api: GameShelfApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getLibraryState: () => ipcRenderer.invoke(LIBRARY_STATE_CHANNEL),
  chooseLibraryRoot: () => ipcRenderer.invoke(CHOOSE_ROOT_CHANNEL),
  getCatalog: () => ipcRenderer.invoke(CATALOG_CHANNEL),
  scanLibrary: () => ipcRenderer.invoke(SCAN_CHANNEL),
  openInstallFolder: (gameId) => ipcRenderer.invoke(OPEN_INSTALL_FOLDER_CHANNEL, gameId),
  openContainerFolder: (gameId) => ipcRenderer.invoke(OPEN_CONTAINER_FOLDER_CHANNEL, gameId),
  autoMatch: gameId => ipcRenderer.invoke(AUTO_MATCH_CHANNEL, gameId),
  getMatchingStatus: () => ipcRenderer.invoke(MATCHING_STATUS_CHANNEL),
  searchMatches: (gameId, query, providerId) => ipcRenderer.invoke(SEARCH_MATCHES_CHANNEL, gameId, query, providerId),
  selectMatch: (gameId, providerId, recordId) => ipcRenderer.invoke(SELECT_MATCH_CHANNEL, gameId, providerId, recordId),
  saveOverrides: (gameId, overrides) => ipcRenderer.invoke(SAVE_OVERRIDES_CHANNEL, gameId, overrides),
  pasteArtwork: (gameId, kind) => ipcRenderer.invoke(PASTE_ARTWORK_CHANNEL, gameId, kind),
  replaceAllRescrape: gameId => ipcRenderer.invoke(RESCRAPE_CHANNEL, gameId),
  clearMetadata: gameId => ipcRenderer.invoke(CLEAR_METADATA_CHANNEL, gameId),
  fetchArtwork: (gameId, steamGridDbId) => ipcRenderer.invoke(FETCH_ARTWORK_CHANNEL, gameId, steamGridDbId),
  fetchScreenshots: gameId => ipcRenderer.invoke(FETCH_SCREENSHOTS_CHANNEL, gameId),
  fetchMissingMetadata: () => ipcRenderer.invoke(FETCH_MISSING_METADATA_CHANNEL),
  confirmArtwork: gameId => ipcRenderer.invoke(CONFIRM_ARTWORK_CHANNEL, gameId),
  getSettings: () => ipcRenderer.invoke(SETTINGS_CHANNEL),
  saveSettings: settings => ipcRenderer.invoke(SAVE_SETTINGS_CHANNEL, settings),
  deleteMissing: () => ipcRenderer.invoke(DELETE_MISSING_CHANNEL),
  rebuildCatalog: () => ipcRenderer.invoke(REBUILD_CHANNEL),
  wipeLibrary: () => ipcRenderer.invoke(WIPE_LIBRARY_CHANNEL)
};

contextBridge.exposeInMainWorld('gameShelf', api);
