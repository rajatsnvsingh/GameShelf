import { contextBridge, ipcRenderer } from 'electron';
import { APP_INFO_CHANNEL, type GameShelfApi } from '../shared/api';

const api: GameShelfApi = {
  getAppInfo: () => ipcRenderer.invoke(APP_INFO_CHANNEL)
};

contextBridge.exposeInMainWorld('gameShelf', api);
