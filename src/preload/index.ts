import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, LIBRARY_STATE_CHANNEL, CHOOSE_ROOT_CHANNEL, type GameShelfApi } from '../shared/api';

const api: GameShelfApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL),
  getLibraryState: () => ipcRenderer.invoke(LIBRARY_STATE_CHANNEL),
  chooseLibraryRoot: () => ipcRenderer.invoke(CHOOSE_ROOT_CHANNEL)
};

contextBridge.exposeInMainWorld('gameShelf', api);
