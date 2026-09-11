import { contextBridge, ipcRenderer } from 'electron';
import { AUTO_MATCH_CHANNEL, SEARCH_MATCHES_CHANNEL, SELECT_MATCH_CHANNEL, SAVE_OVERRIDES_CHANNEL, PASTE_ARTWORK_CHANNEL, RESCRAPE_CHANNEL, CLEAR_METADATA_CHANNEL, SETTINGS_CHANNEL, SAVE_SETTINGS_CHANNEL, DELETE_MISSING_CHANNEL, REBUILD_CHANNEL, WIPE_LIBRARY_CHANNEL, MATCHING_STATUS_CHANNEL, FETCH_ARTWORK_CHANNEL, CONFIRM_ARTWORK_CHANNEL } from '../shared/api';
import { APP_INFO_CHANNEL, LIBRARY_STATE_CHANNEL, CHOOSE_ROOT_CHANNEL, CATALOG_CHANNEL, SCAN_CHANNEL, OPEN_INSTALL_FOLDER_CHANNEL, OPEN_CONTAINER_FOLDER_CHANNEL, type GameShelfApi } from '../shared/api';

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
  selectMatch: (gameId, providerId, recordId) => ipcRenderer.invoke(SELECT_MATCH_CHANNEL, gameId, providerId, recordId), saveOverrides: (gameId, overrides) => ipcRenderer.invoke(SAVE_OVERRIDES_CHANNEL, gameId, overrides), pasteArtwork: (gameId, kind) => ipcRenderer.invoke(PASTE_ARTWORK_CHANNEL, gameId, kind), replaceAllRescrape: gameId => ipcRenderer.invoke(RESCRAPE_CHANNEL, gameId), clearMetadata: gameId => ipcRenderer.invoke(CLEAR_METADATA_CHANNEL, gameId), fetchArtwork: (gameId, steamGridDbId) => ipcRenderer.invoke(FETCH_ARTWORK_CHANNEL, gameId, steamGridDbId), confirmArtwork: gameId => ipcRenderer.invoke(CONFIRM_ARTWORK_CHANNEL, gameId), getSettings: () => ipcRenderer.invoke(SETTINGS_CHANNEL), saveSettings: settings => ipcRenderer.invoke(SAVE_SETTINGS_CHANNEL, settings), deleteMissing: () => ipcRenderer.invoke(DELETE_MISSING_CHANNEL), rebuildCatalog: () => ipcRenderer.invoke(REBUILD_CHANNEL), wipeLibrary: () => ipcRenderer.invoke(WIPE_LIBRARY_CHANNEL)
};

contextBridge.exposeInMainWorld('gameShelf', api);
