import { app, BrowserWindow, clipboard, dialog, ipcMain, protocol, session, shell, type IpcMainInvokeEvent } from 'electron';
import { dirname, extname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { APP_INFO_CHANNEL, LIBRARY_STATE_CHANNEL, CHOOSE_ROOT_CHANNEL, CATALOG_CHANNEL, SCAN_CHANNEL, OPEN_INSTALL_FOLDER_CHANNEL, type AppInfo } from '../shared/api';
import { validateNoArgumentRequest, validateGameIdRequest } from './ipc';
import { portableBase } from './config/paths';
import { ConfigService } from './config/service';
import { LibraryService } from './library/service';
import { AUTO_MATCH_CHANNEL, SEARCH_MATCHES_CHANNEL, SELECT_MATCH_CHANNEL } from '../shared/api';
import { validateSearchRequest, validateSelectionRequest } from './ipc';
import { SAVE_OVERRIDES_CHANNEL, PASTE_ARTWORK_CHANNEL, RESCRAPE_CHANNEL } from '../shared/api';
import { SETTINGS_CHANNEL, SAVE_SETTINGS_CHANNEL } from '../shared/api';
import { DELETE_MISSING_CHANNEL, REBUILD_CHANNEL } from '../shared/api';

const directory = dirname(fileURLToPath(import.meta.url));
const rendererFile = join(directory, '../renderer/index.html');
const developmentUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
const rendererUrl = developmentUrl ? new URL(developmentUrl).href : pathToFileURL(rendererFile).href;
let window: BrowserWindow | null = null;
protocol.registerSchemesAsPrivileged([{ scheme: 'gameshelf-artwork', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.whenReady().then(async () => {
    const base = portableBase(app.isPackaged, app.getAppPath(), process.env.PORTABLE_EXECUTABLE_DIR);
    const config = new ConfigService(base);
    const library = new LibraryService(base, config, path => shell.openPath(path));
    protocol.handle('gameshelf-artwork', async request => {
      const name = new URL(request.url).pathname.slice(1);
      if (!/^[a-z0-9][a-z0-9._-]{0,127}$/i.test(name)) return new Response('', { status: 404 });
      try {
        const bytes = await readFile(join(base, 'data', 'artwork', name));
        const type = { '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }[extname(name).toLowerCase()] ?? 'application/octet-stream';
        return new Response(bytes, { headers: { 'Content-Type': type, 'Cache-Control': 'no-store' } });
      } catch { return new Response('', { status: 404 }); }
    });
    app.on('before-quit', () => library.close());
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      const url = new URL(details.url);
      const developmentRequest = developmentUrl &&
        (url.origin === new URL(developmentUrl).origin ||
         (url.protocol === 'ws:' && url.host === new URL(developmentUrl).host));
      callback({ cancel: !['file:', 'devtools:', 'gameshelf-artwork:'].includes(url.protocol) && !developmentRequest });
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
    function trusted(event: IpcMainInvokeEvent): boolean {
      return Boolean(window && event.sender === window.webContents &&
        event.senderFrame === window.webContents.mainFrame && event.senderFrame.url === rendererUrl);
    }
    function validate(event: IpcMainInvokeEvent, args: unknown[]): void {
      validateNoArgumentRequest(trusted(event), args);
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
      return library.chooseRoot(async () => {
        const result = await dialog.showOpenDialog(window!, {
          title: 'Choose your game library', properties: ['openDirectory', 'dontAddToRecent']
        });
        return result.canceled ? undefined : result.filePaths[0];
      });
    });
    ipcMain.handle(CATALOG_CHANNEL, (event, ...args: unknown[]) => {
      validate(event, args);
      return library.getCatalog();
    });
    ipcMain.handle(SCAN_CHANNEL, (event, ...args: unknown[]) => {
      validate(event, args);
      return library.scan();
    });
    ipcMain.handle(OPEN_INSTALL_FOLDER_CHANNEL, (event, ...args: unknown[]) =>
      library.openInstallFolder(validateGameIdRequest(trusted(event), args)));
    ipcMain.handle(AUTO_MATCH_CHANNEL, (event, ...args: unknown[]) =>
      library.autoMatch(validateGameIdRequest(trusted(event), args)));
    ipcMain.handle(SEARCH_MATCHES_CHANNEL, (event, ...args: unknown[]) =>
      library.searchMatches(...validateSearchRequest(trusted(event), args)));
    ipcMain.handle(SELECT_MATCH_CHANNEL, (event, ...args: unknown[]) =>
      library.selectMatch(...validateSelectionRequest(trusted(event), args)));
    ipcMain.handle(SAVE_OVERRIDES_CHANNEL, (event, ...args: unknown[]) => { const id = validateGameIdRequest(trusted(event), [args[0]]); if (args.length !== 2 || !args[1] || typeof args[1] !== 'object' || Array.isArray(args[1])) throw new Error('Invalid overrides'); return library.saveOverrides(id, args[1] as Record<string, unknown>); });
    ipcMain.handle(PASTE_ARTWORK_CHANNEL, (event, ...args: unknown[]) => { const id = validateGameIdRequest(trusted(event), [args[0]]); if (args.length !== 2 || !['cover', 'background'].includes(args[1] as string)) throw new Error('Invalid artwork kind'); const image = (clipboard as unknown as { readImage(): { toPNG(): Buffer } }).readImage(); return library.pasteArtwork(id, args[1] as 'cover' | 'background', image.toPNG()); });
    ipcMain.handle(RESCRAPE_CHANNEL, (event, ...args: unknown[]) => library.replaceAllRescrape(validateGameIdRequest(trusted(event), args)));
    ipcMain.handle(SETTINGS_CHANNEL, (event, ...args: unknown[]) => { validate(event, args); return config.getSettings().then(value => ({ ok: true as const, value })); });
    ipcMain.handle(SAVE_SETTINGS_CHANNEL, (event, ...args: unknown[]) => { if (args.length !== 1 || !args[0] || typeof args[0] !== 'object' || Array.isArray(args[0])) throw new Error('Invalid settings'); validateGameIdRequest(trusted(event), [1]); return config.saveSettings(args[0] as import('../shared/api').SettingsUpdate).then(value => ({ ok: true as const, value })).catch(() => ({ ok: false as const, message: 'Could not save settings.' })); });
    ipcMain.handle(DELETE_MISSING_CHANNEL, (event, ...args: unknown[]) => { validate(event, args); return library.deleteMissing(); });
    ipcMain.handle(REBUILD_CHANNEL, (event, ...args: unknown[]) => { validate(event, args); return library.rebuildCatalog(); });
    window.once('ready-to-show', () => window?.show());
    window.on('closed', () => { window = null; });
    await window.loadURL(rendererUrl);
  }).catch((error: unknown) => {
    console.error('Unable to start GameShelf:', error);
    app.exit(1);
  });

  app.on('window-all-closed', () => app.quit());
}
