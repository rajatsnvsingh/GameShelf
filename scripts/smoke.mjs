import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { cp, mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const fixture = await mkdtemp(join(tmpdir(), 'gameshelf-smoke-'));
let appDirectory = join(fixture, 'Portable 日本語');
await mkdir(appDirectory);
await cp('out', join(appDirectory, 'out'), { recursive: true });
await writeFile(join(appDirectory, 'package.json'), await readFile('package.json'));
const gamesName = 'Games 日本語';
await mkdir(join(appDirectory, gamesName));
const server = process.argv.includes('--dev') ? await createServer({
  configFile: false, root: 'src/renderer', plugins: [svelte()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true }
}) : undefined;
if (server) {
  await server.listen();
  // Deliberately omit the trailing slash to exercise Electron URL normalization.
  env.ELECTRON_RENDERER_URL = 'http://127.0.0.1:5173';
}
try {
  const application = await electron.launch({ args: [appDirectory], cwd: tmpdir(), env });
  try {
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: 'GameShelf', exact: true }).waitFor();
    await page.getByText('Version 0.1.0', { exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: 'Choose the folder' }).waitFor();
    const state = await page.evaluate(async () => ({
      require: typeof window.require,
      process: typeof window.process,
      apiKeys: Object.keys(window.gameShelf),
      info: await window.gameShelf.getAppInfo()
    }));
    assert.equal(state.require, 'undefined');
    assert.equal(state.process, 'undefined');
    assert.deepEqual(state.apiKeys, ['getAppInfo', 'getLibraryState', 'chooseLibraryRoot']);
    assert.deepEqual(state.info, { name: 'GameShelf', version: '0.1.0' });
    const preferences = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window.isVisible()) await new Promise(resolve => window.once('show', resolve));
      const prefs = window.webContents.getLastWebPreferences();
      return { isolated: prefs.contextIsolation, sandbox: prefs.sandbox, node: prefs.nodeIntegration, visible: window.isVisible() };
    });
    assert.deepEqual(preferences, { isolated: true, sandbox: true, node: false, visible: true });

    // Exercise the real IPC and UI while replacing only the native dialog result.
    await application.evaluate(({ dialog }) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await page.getByRole('button', { name: 'Choose library folder' }).click();
    await page.getByRole('button', { name: 'Choose library folder' }).waitFor({ state: 'visible' });
    await assert.rejects(readFile(join(appDirectory, 'config.ini')), { code: 'ENOENT' });
    await application.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, join(appDirectory, gamesName));
    await page.getByRole('button', { name: 'Choose library folder' }).click();
    await page.getByRole('heading', { name: 'Library ready', exact: true }).waitFor();
    const saved = await readFile(join(appDirectory, 'config.ini'), 'utf8');
    assert.ok(saved.includes(`root="${gamesName}"`));
    assert.ok(!saved.includes(appDirectory));

    const executable = await application.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].minimize();
      return app.getPath('exe');
    });
    const secondEvent = application.evaluate(({ app }) => new Promise(resolve => {
      app.once('second-instance', () => resolve(true));
      setTimeout(() => resolve(false), 10000);
    }));
    const child = spawn(executable, [appDirectory], { env, cwd: tmpdir(), windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 15000);
    try {
      const [code] = await once(child, 'exit');
      assert.equal(code, 0);
      assert.equal(await secondEvent, true);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
    } finally { clearTimeout(timer); }

    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve('test-results/portable-config.png') });
  } finally {
    await application.close();
  }
  const relocated = join(fixture, 'Relocated 日本語');
  await rename(appDirectory, relocated);
  appDirectory = relocated;
  const restarted = await electron.launch({ args: [appDirectory], cwd: tmpdir(), env });
  try {
    const page = await restarted.firstWindow();
    await page.getByRole('heading', { name: 'Library ready', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.gameShelf.getLibraryState())).root, join(appDirectory, gamesName));
    await rename(join(appDirectory, gamesName), join(appDirectory, 'Disconnected'));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'unavailable' }).waitFor();
    console.log('PASS: isolated window, picker/cancel, relative INI, restart/relocation, unavailable root, and single instance.');
  } finally { await restarted.close(); }
} finally {
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}
