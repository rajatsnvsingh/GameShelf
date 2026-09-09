import { app, BrowserWindow, dialog, ipcMain, session, type IpcMainInvokeEvent } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_INFO_CHANNEL, LIBRARY_STATE_CHANNEL, CHOOSE_ROOT_CHANNEL, type AppInfo } from '../shared/api';
import { validateNoArgumentRequest } from './ipc';
import { portableBase } from './config/paths';
import { ConfigService } from './config/service';

const directory = dirname(fileURLToPath(import.meta.url));
const rendererFile = join(directory, '../renderer/index.html');
const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const rendererUrl = developmentUrl ? new URL(developmentUrl).href : pathToFileURL(rendererFile).href;
let window: BrowserWindow | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const config = new ConfigService(portableBase(app.isPackaged, app.getAppPath(), process.env.PORTABLE_EXECUTABLE_DIR));
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const developmentRequest = developmentUrl &&
        (url.origin === new URL(developmentUrl).origin ||
         (url.protocol === 'ws:' && url.host === new URL(developmentUrl).host));
      callback({ cancel: !['file:', 'devtools:'].includes(url.protocol) && !developmentRequest });
    });

    window = new BrowserWindow({
      width: 1000, height: 700, minWidth: 640, minHeight: 480,
      title: 'GameShelf', backgroundColor: '#171b24', show: false,
      webPreferences: {
        preload: join(directory, '../preload/index.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        webviewTag: false
      }
    });
    window.removeMenu();
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (event) => event.preventDefault());
    window.webContents.on('will-attach-webview', (event) => event.preventDefault());
    function validate(event: IpcMainInvokeEvent, args: unknown[]): void {
      validateNoArgumentRequest(Boolean(window && event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererUrl), args);
    }
    ipcMain.handle(APP_INFO_CHANNEL, (event, ...args: unknown[]): AppInfo => {
      validate(event, args);
      return { name: 'GameShelf', version: app.getVersion() };
    });
    ipcMain.handle(LIBRARY_STATE_CHANNEL, (event, ...args: unknown[]) => {
      validate(event, args);
      return config.getState();
    });
    ipcMain.handle(CHOOSE_ROOT_CHANNEL, (event, ...args: unknown[]) => {
      validate(event, args);
      return config.chooseRoot(async () => {
        const result = await dialog.showOpenDialog(window!, {
          title: 'Choose your game library', properties: ['openDirectory', 'dontAddToRecent']
        });
        return result.canceled ? undefined : result.filePaths[0];
      });
    });
    window.once('ready-to-show', () => window?.show());
    window.on('closed', () => { window = null; });
    await window.loadURL(rendererUrl);
  }).catch((error: unknown) => {
    console.error('Unable to start GameShelf:', error);
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
}
