import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import {
  cp,
  mkdtemp,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const fixture = await mkdtemp(join(tmpdir(), 'gameshelf-gallery-'));
let base = join(fixture, 'Portable');
let application;
const launch = () =>
  electron.launch({
    args: [base, `--user-data-dir=${join(fixture, 'profile')}`],
    cwd: tmpdir(),
    env,
  });
try {
  await mkdir(join(base, 'Games', 'Gallery Game'), { recursive: true });
  await mkdir(join(base, 'Games', 'Empty Game'));
  await cp('out', join(base, 'out'), { recursive: true });
  await writeFile(join(base, 'package.json'), await readFile('package.json'));
  for (const dependency of ['better-sqlite3', 'node-addon-api']) {
    await cp(
      join('node_modules', dependency),
      join(base, 'node_modules', dependency),
      { recursive: true }
    );
  }
  application = await launch();
  let page = await application.firstWindow();
  await page.getByRole('heading', { name: 'GameShelf', exact: true }).waitFor();
  await application.evaluate(
    ({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    },
    join(base, 'Games')
  );
  assert.equal(
    (await page.evaluate(() => window.gameShelf.chooseLibraryRoot())).status,
    'ready'
  );
  const ini = await readFile(join(base, 'config.ini'), 'utf8');
  await writeFile(
    join(base, 'config.ini'),
    `${ini}\n[provider.igdb]\nenabled="true"\nclientId="fixture"\nclientSecret="fixture"\n`
  );
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 960;
    canvas.height = 540;
    const ctx = canvas.getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 960, 540);
    gradient.addColorStop(0, '#244b77');
    gradient.addColorStop(1, '#96ad85');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 960, 540);
    ctx.fillStyle = '#ffffff';
    ctx.font = '40px sans-serif';
    ctx.fillText('GameShelf gallery fixture', 70, 280);
    return canvas.toDataURL('image/png').split(',')[1];
  });
  await application.evaluate((_electron, image) => {
    globalThis.galleryCalls = [];
    globalThis.fetch = async (url, init) => {
      globalThis.galleryCalls.push(String(url));
      if (globalThis.galleryOffline) throw new Error('fixture offline');
      if (String(url).startsWith('https://images.igdb.com/'))
        return new Response(Buffer.from(image, 'base64'));
      if (String(url).startsWith('https://id.twitch.tv/'))
        return new Response(
          JSON.stringify({
            access_token: 'fixture',
            expires_in: 3600,
            token_type: 'bearer',
          })
        );
      if (String(url) !== 'https://api.igdb.com/v4/games')
        throw new Error('Unexpected provider');
      const body = String(init.body);
      const id =
        body.includes('Gallery Game') || body.includes('where id = 1;') ? 1 : 2;
      return new Response(
        JSON.stringify([
          {
            id,
            name: id === 1 ? 'Gallery Game' : 'Empty Game',
            summary: 'A temporary game used to verify the screenshot gallery.',
            ...(body.includes('screenshots.image_id')
              ? {
                  screenshots:
                    id === 1
                      ? Array.from(
                          { length: globalThis.galleryCount ?? 7 },
                          (_, i) => ({ image_id: `shot${i}` })
                        )
                      : [],
                }
              : {}),
          },
        ])
      );
    };
  }, png);
  const scanned = await page.evaluate(() => window.gameShelf.scanLibrary());
  assert.equal(scanned.ok, true);
  const game = scanned.value.games.find(
    (game) => game.folderName === 'Gallery Game'
  );
  assert.equal(game.screenshotUrls.length, 5);
  assert.equal(
    (await application.evaluate(() => globalThis.galleryCalls)).filter((url) =>
      url.startsWith('https://images.igdb.com/')
    ).length,
    5
  );
  await page.reload();
  await page.getByRole('button', { name: /All Games/ }).click();
  await page.getByRole('button', { name: /Gallery Game/ }).click();
  const gallery = page.getByRole('region', {
    name: 'Screenshots',
    exact: true,
  });
  await gallery.waitFor();
  assert.equal(
    await gallery.getByRole('button', { name: /Enlarge/ }).count(),
    5
  );
  await gallery
    .getByRole('button', { name: 'Enlarge screenshot 1', exact: true })
    .click();
  const viewer = page.getByRole('dialog', { name: 'Gallery Game screenshots' });
  await viewer.waitFor();
  await page.keyboard.press('ArrowRight');
  await viewer.getByText('Screenshot 2 of 5', { exact: true }).waitFor();
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowLeft');
  await viewer.getByText('Screenshot 5 of 5', { exact: true }).waitFor();
  await page.keyboard.press('ArrowDown');
  await viewer.getByText('Screenshot 5 of 5', { exact: true }).waitFor();
  await page.keyboard.press('Tab');
  assert.equal(
    await page.evaluate(() =>
      document.querySelector('dialog').contains(document.activeElement)
    ),
    true
  );
  await page.keyboard.press('Escape');
  await viewer.waitFor({ state: 'hidden' });
  assert.equal(
    await gallery
      .getByRole('button', { name: 'Enlarge screenshot 1', exact: true })
      .evaluate((node) => document.activeElement === node),
    true
  );
  await gallery
    .getByRole('button', { name: 'Enlarge screenshot 3', exact: true })
    .click();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({
    path: resolve('test-results/screenshot-viewer.png'),
  });
  await viewer.getByRole('button', { name: 'Close screenshot viewer' }).click();
  await viewer.waitFor({ state: 'hidden' });
  await page.screenshot({
    path: resolve('test-results/screenshot-gallery.png'),
  });
  await page.getByRole('button', { name: /Empty Game/ }).click();
  assert.equal(await gallery.count(), 0);
  await page.getByRole('button', { name: /Gallery Game/ }).click();
  await page
    .getByRole('button', { name: /Edit/, exact: false })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: 'Fetch screenshots', exact: true })
    .click();
  await page.getByText('5 screenshots cached.', { exact: true }).waitFor();
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.gameShelf.fetchScreenshots(0);
        return false;
      } catch {
        return true;
      }
    }),
    true,
    'IPC rejects invalid game IDs'
  );
  await application.evaluate(() => {
    globalThis.galleryCount = 1;
  });
  assert.equal(
    (
      await page.evaluate(
        (id) => window.gameShelf.fetchScreenshots(id),
        game.id
      )
    ).ok,
    true
  );
  await page.reload();
  await page.getByRole('button', { name: /All Games/ }).click();
  await page.getByRole('button', { name: /Gallery Game/ }).click();
  await gallery
    .getByRole('button', { name: 'Enlarge screenshot 1', exact: true })
    .click();
  assert.equal(
    await viewer.getByRole('button', { name: 'Next screenshot' }).isDisabled(),
    true
  );
  assert.equal(
    await viewer
      .getByRole('button', { name: 'Previous screenshot' })
      .isDisabled(),
    true
  );
  await page.keyboard.press('ArrowRight');
  await viewer.getByText('Screenshot 1 of 1', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  const cachedFile = new URL(game.screenshotUrls[0]).pathname.slice(1);
  assert.match(cachedFile, /^[a-z0-9._-]+$/i);
  await rm(join(base, 'data', 'artwork', cachedFile));
  await page.reload();
  await page.getByRole('button', { name: /All Games/ }).click();
  await page.getByRole('button', { name: /Gallery Game/ }).click();
  await page.getByRole('region', { name: 'Game details' }).waitFor();
  await gallery.waitFor({ state: 'detached' });
  await application.evaluate(() => {
    globalThis.galleryCount = 7;
  });
  await page
    .getByRole('button', { name: /Edit/, exact: false })
    .first()
    .click();
  await page
    .getByRole('menuitem', { name: 'Fetch screenshots', exact: true })
    .click();
  await gallery
    .getByRole('button', { name: 'Enlarge screenshot 5', exact: true })
    .waitFor();
  await application.close();
  application = undefined;
  const relocated = join(fixture, 'Relocated');
  await rename(base, relocated);
  base = relocated;
  application = await launch();
  await application.evaluate(() => {
    globalThis.fetch = async () => {
      throw new Error('offline');
    };
  });
  page = await application.firstWindow();
  const remoteRequests = [];
  page.on('request', (request) => {
    if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
  });
  await page.getByRole('button', { name: /All Games/ }).click();
  await page.getByRole('button', { name: /Gallery Game/ }).click();
  const offlineGallery = page.getByRole('region', {
    name: 'Screenshots',
    exact: true,
  });
  await offlineGallery
    .getByRole('button', { name: 'Enlarge screenshot 1', exact: true })
    .click();
  await page.waitForFunction(() => {
    const image = document.querySelector('dialog[open] img');
    return image?.complete && image.naturalWidth === 960;
  });
  assert.deepEqual(remoteRequests, []);
  assert.equal(
    (
      await page.evaluate(
        (id) => window.gameShelf.fetchScreenshots(id),
        game.id
      )
    ).ok,
    false
  );
  assert.equal(
    (await page.evaluate(() => window.gameShelf.getCatalog())).value.games.find(
      (item) => item.id === game.id
    ).screenshotUrls.length,
    5
  );
  console.log(
    'PASS: five screenshots, hidden empty gallery, enlarge, arrows, Escape, Close, focus, explicit fetch, offline restart/relocation, and local-only image loads.'
  );
} finally {
  await application?.close();
  await rm(fixture, { recursive: true, force: true });
}
