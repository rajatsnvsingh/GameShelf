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
const profileArgument = `--user-data-dir=${join(fixture, 'chromium-profile')}`;
let appDirectory = join(fixture, 'Portable 日本語');
await mkdir(appDirectory);
await cp('out', join(appDirectory, 'out'), { recursive: true });
await writeFile(join(appDirectory, 'package.json'), await readFile('package.json'));
for (const dependency of ['better-sqlite3', 'node-addon-api']) {
  await cp(join('node_modules', dependency), join(appDirectory, 'node_modules', dependency), { recursive: true });
}
const gamesName = 'Games 日本語';
await mkdir(join(appDirectory, gamesName, 'Game A', 'Never Visit'), { recursive: true });
await mkdir(join(appDirectory, gamesName, 'Collection_Favorites', 'Game B 日本語'), { recursive: true });
await mkdir(join(appDirectory, gamesName, 'Collection_Empty'));
await writeFile(join(appDirectory, gamesName, 'setup.exe'), 'fixture only');
let savedCatalog;
const server = process.argv.includes('--dev') ? await createServer({
  configFile: false, root: 'src/renderer', plugins: [svelte()],
  server: { host: '127.0.0.1', port: 0 }
}) : undefined;
if (server) {
  await server.listen();
  // Deliberately omit the trailing slash to exercise Electron URL normalization.
  env.ELECTRON_RENDERER_URL = server.resolvedUrls.local[0].replace(/\/$/, '');
}
try {
  const application = await electron.launch({ args: [appDirectory, profileArgument], cwd: tmpdir(), env });
  try {
    const page = await application.firstWindow();
    const errors = [];
    const externalRequests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => {
      if (/^https?:/.test(request.url()) && !(env.ELECTRON_RENDERER_URL && request.url().startsWith(`${env.ELECTRON_RENDERER_URL}/`))) externalRequests.push(request.url());
    });
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
    assert.deepEqual(state.apiKeys, ['getAppInfo', 'getLibraryState', 'chooseLibraryRoot', 'getCatalog', 'scanLibrary', 'openInstallFolder', 'autoMatch', 'searchMatches', 'selectMatch']);
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
    let saved = await readFile(join(appDirectory, 'config.ini'), 'utf8');
    assert.ok(saved.includes(`root="${gamesName}"`));
    assert.ok(!saved.includes(appDirectory));
    await assert.rejects(readFile(join(appDirectory, 'data', 'library.db')), { code: 'ENOENT' });
    saved += '\n[provider.igdb]\nenabled="true"\nclientId="fixture-client"\nclientSecret="fixture-secret"\n[provider.thegamesdb]\nenabled="true"\napiKey="fixture-key"\n';
    await writeFile(join(appDirectory, 'config.ini'), saved);
    // Fake only the main-process HTTP transport: exercise the real IGDB adapter/resolver/IPC.
    await application.evaluate(() => {
      globalThis.fixtureProviderCalls = [];
      globalThis.fetch = async (url, init) => {
        globalThis.fixtureProviderCalls.push(String(url));
        if (globalThis.fixtureProviderOffline) throw new Error('fixture-secret');
        if (String(url) === 'https://id.twitch.tv/oauth2/token') return new Response(JSON.stringify({ access_token: 'fixturetoken', expires_in: 3600, token_type: 'bearer' }));
        const target = new URL(String(url));
        if (target.hostname === 'api.thegamesdb.net') {
          const game = id => ({ id, game_title: 'Game B 日本語', release_date: '2000-01-01', overview: 'Fixture metadata description' });
          const games = target.searchParams.has('id') ? [game(7)] : target.searchParams.get('name') === 'Corrected title' ? [game(7)] : [game(7), game(8)];
          return new Response(JSON.stringify({ code: 200, data: { count: games.length, games }, pages: { next: null } }));
        }
        if (String(url) !== 'https://api.igdb.com/v4/games') throw new Error('Unexpected fixture request');
        const body = String(init.body);
        const game = id => ({ id, name: id === 1 ? 'Game A' : 'Game B 日本語', summary: 'Fixture metadata description', first_release_date: 946684800 });
        const id = /where id = (\d+)/.exec(body)?.[1];
        const results = id ? [game(Number(id))] : body.includes('Game A') ? [game(1)] : body.includes('Corrected title') ? [game(3)] : [game(2), game(3)];
        return new Response(JSON.stringify(results));
      };
    });
    await page.getByRole('button', { name: 'Scan library', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Scan complete: 2 games and 2 collections' }).waitFor();
    const firstCatalog = await page.evaluate(() => window.gameShelf.getCatalog());
    assert.equal(firstCatalog.ok, true);
    assert.equal(firstCatalog.value.games.length, 2);
    assert.equal(firstCatalog.value.games.find(game => game.folderName === 'Game A').bindingSource, 'automatic');
    const originalMember = firstCatalog.value.games.find(game => game.folderName === 'Game B 日本語');
    assert.equal(originalMember.matchStatus, 'unmatched');
    await page.getByRole('navigation', { name: 'Collections' }).getByRole('button', { name: /Favorites/ }).click();
    await page.getByRole('region', { name: 'Games', exact: true }).getByRole('button', { name: /Game B 日本語/ }).click();
    await page.getByRole('region', { name: 'Game details' }).getByText('Collection_Favorites/Game B 日本語', { exact: true }).waitFor();
    await application.evaluate(({ shell }) => {
      globalThis.fixtureOpenedPaths = [];
      shell.openPath = async path => { globalThis.fixtureOpenedPaths.push(path); return ''; };
    });
    await page.getByRole('button', { name: 'Open Install Folder', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Install folder opened.' }).waitFor();
    const memberPath = join(appDirectory, gamesName, 'Collection_Favorites', 'Game B 日本語');
    assert.deepEqual(await application.evaluate(() => globalThis.fixtureOpenedPaths), [memberPath]);
    await rename(memberPath, join(fixture, 'Absent Member'));
    await page.getByRole('button', { name: 'Open Install Folder', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'missing' }).waitFor();
    assert.equal(await application.evaluate(() => globalThis.fixtureOpenedPaths.length), 1);
    await page.getByRole('button', { name: 'Scan library', exact: true }).click();
    await page.getByRole('region', { name: 'Game details' }).getByText('Missing at last scan', { exact: true }).waitFor();
    await rename(join(fixture, 'Absent Member'), memberPath);
    await page.getByRole('button', { name: 'Scan library', exact: true }).click();
    await page.getByRole('region', { name: 'Game details' }).getByText('Present at last scan', { exact: true }).waitFor();
    await page.getByRole('navigation', { name: 'Collections' }).getByRole('button', { name: /Needs Matching/ }).click();
    await page.getByRole('region', { name: 'Games', exact: true }).getByRole('button', { name: /Game B 日本語/ }).click();
    await page.getByRole('button', { name: 'Match automatically', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'No confident unique match' }).waitFor();
    await page.getByLabel('Search title', { exact: true }).fill('Corrected title');
    await page.getByRole('button', { name: 'Search candidates', exact: true }).click();
    const secondProviderCandidate = page.getByRole('list', { name: 'Match candidates' }).getByRole('listitem').filter({ hasText: 'thegamesdb' });
    await secondProviderCandidate.getByRole('button', { name: 'Use this match', exact: true }).waitFor();
    await page.screenshot({ path: resolve('test-results/matching.png'), fullPage: true });
    await secondProviderCandidate.getByRole('button', { name: 'Use this match', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Manual match saved' }).waitFor();
    await page.getByText('Fixture metadata description', { exact: true }).waitFor();
    await page.getByRole('region', { name: 'Games', exact: true }).getByText('No games need matching.', { exact: true }).waitFor();
    const matched = await page.evaluate(() => window.gameShelf.getCatalog());
    assert.equal(matched.value.games.find(game => game.id === originalMember.id).bindingSource, 'manual');
    assert.equal(matched.value.games.find(game => game.id === originalMember.id).providerRecordId, '7');
    assert.equal(matched.value.games.find(game => game.id === originalMember.id).providerId, 'thegamesdb');
    assert.ok(!JSON.stringify(matched).includes('fixture-secret'));
    assert.ok(!JSON.stringify(matched).includes('https://'));
    await application.evaluate(() => { globalThis.fixtureProviderOffline = true; });
    await page.getByRole('button', { name: 'Search candidates', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'provider requests failed' }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.gameShelf.getCatalog()), matched);
    const callCount = await application.evaluate(() => globalThis.fixtureProviderCalls.length);
    await page.getByRole('button', { name: 'Scan library', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'Scan complete:' }).waitFor();
    assert.equal(await application.evaluate(() => globalThis.fixtureProviderCalls.length), callCount);
    savedCatalog = await page.evaluate(() => window.gameShelf.getCatalog());
    assert.equal(savedCatalog.value.games.find(game => game.id === originalMember.id).addedAt, originalMember.addedAt);
    assert.equal(await readFile(join(appDirectory, 'config.ini'), 'utf8'), saved);

    const executable = await application.evaluate(({ app, BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0].minimize();
      return app.getPath('exe');
    });
    const secondEvent = application.evaluate(({ app }) => new Promise(resolve => {
      app.once('second-instance', () => resolve(true));
      setTimeout(() => resolve(false), 10000);
    }));
    const child = spawn(executable, [appDirectory, profileArgument], { env, cwd: tmpdir(), windowsHide: true, stdio: 'ignore' });
    const timer = setTimeout(() => child.kill(), 15000);
    try {
      const [code] = await once(child, 'exit');
      assert.equal(code, 0);
      assert.equal(await secondEvent, true);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
      assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized()), false);
    } finally { clearTimeout(timer); }

    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    await page.screenshot({ path: resolve('test-results/catalog.png') });
  } finally {
    await application.close();
  }
  const relocated = join(fixture, 'Relocated 日本語');
  await rename(appDirectory, relocated);
  appDirectory = relocated;
  const restarted = await electron.launch({ args: [appDirectory, profileArgument], cwd: tmpdir(), env });
  try {
    const page = await restarted.firstWindow();
    await page.getByRole('heading', { name: 'Library ready', exact: true }).waitFor();
    assert.equal((await page.evaluate(() => window.gameShelf.getLibraryState())).root, join(appDirectory, gamesName));
    // Refresh waits for the initial catalog request to finish, without scanning.
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('region', { name: 'Games', exact: true }).getByRole('button', { name: /Game B 日本語/ }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.gameShelf.getCatalog()), savedCatalog);
    await rename(join(appDirectory, gamesName), join(appDirectory, 'Disconnected'));
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await page.getByRole('status').filter({ hasText: 'unavailable' }).waitFor();
    const failedScan = await page.evaluate(() => window.gameShelf.scanLibrary());
    assert.equal(failedScan.ok, false);
    assert.deepEqual(await page.evaluate(() => window.gameShelf.getCatalog()), savedCatalog);
    assert.equal(savedCatalog.value.games.find(game => game.folderName === 'Game B 日本語').bindingSource, 'manual');
    console.log('PASS: two-provider automatic/manual matching, ambiguity, provider failure, local scan, folder action, offline restart/relocation, isolation, and single instance.');
  } finally { await restarted.close(); }
} finally {
  await server?.close();
  await rm(fixture, { recursive: true, force: true });
}
