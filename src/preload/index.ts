import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, LIBRARY_STATE_CHANNEL, CHOOSE_ROOT_CHANNEL, CATALOG_CHANNEL, SCAN_CHANNEL, OPEN_INSTALL_FOLDER_CHANNEL, type GameShelfApi } from '../shared/api';

const api: GameShelfApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getLibraryState: () => ipcRenderer.invoke(LIBRARY_STATE_CHANNEL),
  chooseLibraryRoot: () => ipcRenderer.invoke(CHOOSE_ROOT_CHANNEL),
  getCatalog: () => ipcRenderer.invoke(CATALOG_CHANNEL),
  scanLibrary: () => ipcRenderer.invoke(SCAN_CHANNEL),
  openInstallFolder: (gameId) => ipcRenderer.invoke(OPEN_INSTALL_FOLDER_CHANNEL, gameId)
};

contextBridge.exposeInMainWorld('gameShelf', api);
