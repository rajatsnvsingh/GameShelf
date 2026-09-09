import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
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
  const application = await electron.launch({ args: ['.'], env });
  try {
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.getByRole('heading', { name: 'GameShelf', exact: true }).waitFor();
    await page.getByRole('status').filter({ hasText: 'Version 0.1.0' }).waitFor();
    const state = await page.evaluate(async () => ({
      require: typeof window.require,
      process: typeof window.process,
      apiKeys: Object.keys(window.gameShelf),
      info: await window.gameShelf.getAppInfo()
    }));
    assert.equal(state.require, 'undefined');
    assert.equal(state.process, 'undefined');
    assert.deepEqual(state.apiKeys, ['getAppInfo']);
    assert.deepEqual(state.info, { name: 'GameShelf', version: '0.1.0' });
    const preferences = await application.evaluate(async ({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      if (!window.isVisible()) await new Promise(resolve => window.once('show', resolve));
      const prefs = window.webContents.getLastWebPreferences();
      return { isolated: prefs.contextIsolation, sandbox: prefs.sandbox, node: prefs.nodeIntegration, visible: window.isVisible() };
    });
    assert.deepEqual(preferences, { isolated: true, sandbox: true, node: false, visible: true });
    assert.deepEqual(errors, []);
    await page.screenshot({ path: 'test-results/foundation.png' });
    console.log('PASS: visible Svelte window, typed IPC round trip, isolated sandbox, no renderer Node access.');
  } finally {
    await application.close();
  }
} finally {
  await server?.close();
}
