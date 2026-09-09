import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { ConfigService } from '../src/main/config/service.ts';
import { LibraryService } from '../src/main/library/service.ts';
import { createScanReader } from '../src/main/library/directory-reader.ts';
import { resolveInstallFolder } from '../src/main/system/install-folder.ts';
import type { CatalogView, OperationResult } from '../src/shared/api.ts';

function value(result: OperationResult<CatalogView>): CatalogView {
  if (!result.ok) assert.fail(result.message);
  return result.value;
}

async function fixture(t: { after: (fn: () => Promise<void>) => void }, reader = createScanReader, shellError = '') {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-library-'));
  const root = join(base, 'Games 日本語');
  await mkdir(join(root, 'Game A', 'Never Visit'), { recursive: true });
  await mkdir(join(root, 'Collection_One', 'Game B'), { recursive: true });
  await mkdir(join(root, 'Collection_Empty'));
  await writeFile(join(root, 'setup.exe'), 'fixture only');
  await writeFile(join(root, 'Game A', 'sentinel.txt'), 'untouched fixture');
  const config = new ConfigService(base);
  const opened: string[] = [];
  const service = new LibraryService(base, config, async path => { opened.push(path); return shellError; }, reader);
  t.after(async () => { service.close(); await rm(base, { recursive: true, force: true }); });
  return { base, root, config, service, opened };
}

test('startup and root selection do not scan or create a catalog', async t => {
  let calls = 0;
  const { base, root, service } = await fixture(t, async path => { calls++; return createScanReader(path); });
  assert.deepEqual(value(await service.getCatalog()), { games: [], collections: [] });
  await service.chooseRoot(async () => root);
  assert.deepEqual(value(await service.getCatalog()), { games: [], collections: [] });
  assert.equal(calls, 0);
  await assert.rejects(readFile(join(base, 'data', 'library.db')), { code: 'ENOENT' });
});

test('manual scan uses real shallow listings, persists membership, and opens the collection game by ID', async t => {
  const visits: string[] = [];
  const { base, root, service, opened } = await fixture(t, async path => {
    const reader = await createScanReader(path);
    return { ...reader, listDirectory: (requestRoot, relative) => { visits.push(relative); return reader.listDirectory(requestRoot, relative); } };
  });
  await service.chooseRoot(async () => root);
  const catalog = value(await service.scan());
  assert.deepEqual(visits, ['', 'Collection_Empty', 'Collection_One']);
  assert.equal(catalog.games.length, 2);
  assert.equal(catalog.collections.length, 2);
  const member = catalog.games.find(game => game.folderName === 'Game B')!;
  assert.equal(member.collectionId, catalog.collections.find(collection => collection.displayName === 'One')!.id);
  assert.equal((await service.openInstallFolder(member.id)).ok, true);
  assert.deepEqual(opened, [await realpath(join(root, 'Collection_One', 'Game B'))]);
  assert.equal(await readFile(join(root, 'Game A', 'sentinel.txt'), 'utf8'), 'untouched fixture');
  assert.ok((await readFile(join(base, 'data', 'library.db'))).length > 0);
});

test('missing folders fail opening before a rescan and reappear with the same catalog identity', async t => {
  const { base, root, service, opened } = await fixture(t);
  await service.chooseRoot(async () => root);
  const original = value(await service.scan()).games.find(game => game.folderName === 'Game B')!;
  const folder = join(root, 'Collection_One', 'Game B');
  await rename(folder, join(base, 'Absent'));
  assert.equal((await service.openInstallFolder(original.id)).ok, false);
  assert.deepEqual(opened, []);
  assert.equal(value(await service.getCatalog()).games.find(game => game.id === original.id)!.missing, false);
  assert.equal(value(await service.scan()).games.find(game => game.id === original.id)!.missing, true);
  await rename(join(base, 'Absent'), folder);
  const returned = value(await service.scan()).games.find(game => game.id === original.id)!;
  assert.equal(returned.missing, false);
  assert.equal(returned.addedAt, original.addedAt);
});

test('unavailable root preserves cached browsing across restart and cannot mark games missing', async t => {
  const { base, root, config, service, opened } = await fixture(t);
  await service.chooseRoot(async () => root);
  const before = value(await service.scan());
  await rename(root, join(base, 'Disconnected'));
  assert.equal((await service.scan()).ok, false);
  assert.deepEqual(value(await service.getCatalog()), before);
  assert.equal((await service.openInstallFolder(before.games[0].id)).ok, false);
  assert.deepEqual(opened, []);
  service.close();
  const restarted = new LibraryService(base, config, async () => '');
  try { assert.deepEqual(value(await restarted.getCatalog()), before); } finally { restarted.close(); }
});

test('a collection-listing failure after discoveries leaves all persisted records unchanged', async t => {
  let fail = false;
  const { root, service } = await fixture(t, async path => {
    const reader = await createScanReader(path);
    return { ...reader, async listDirectory(requestRoot, relative) {
      if (fail && relative === 'Collection_One') throw new Error('fixture listing failure');
      return reader.listDirectory(requestRoot, relative);
    } };
  });
  await service.chooseRoot(async () => root);
  const before = value(await service.scan());
  await mkdir(join(root, 'New Game'));
  fail = true;
  assert.equal((await service.scan()).ok, false);
  assert.deepEqual(value(await service.getCatalog()), before);
});

test('detected directory changes before reconciliation discard the entire scan', async t => {
  let change = false;
  const { root, service } = await fixture(t, async path => {
    const reader = await createScanReader(path);
    return { ...reader, async verifyUnchanged() {
      if (change) await rename(join(path, 'Collection_One'), join(path, 'Changed'));
      await reader.verifyUnchanged();
    } };
  });
  await service.chooseRoot(async () => root);
  const before = value(await service.scan());
  change = true;
  assert.equal((await service.scan()).ok, false);
  assert.deepEqual(value(await service.getCatalog()), before);
});

test('real listing skips junctions and rejects paths beyond its allowed depth', async t => {
  const { base, root, service } = await fixture(t);
  await mkdir(join(base, 'Outside', 'Not a game'), { recursive: true });
  await symlink(join(base, 'Outside'), join(root, 'Collection_Link'), 'junction');
  await symlink(join(base, 'Outside'), join(root, 'Collection_One', 'Linked Game'), 'junction');
  await service.chooseRoot(async () => root);
  const catalog = value(await service.scan());
  assert.equal(catalog.games.length, 2);
  assert.equal(catalog.collections.length, 2);
  const reader = await createScanReader(root);
  for (const path of ['..', '../Outside', 'Collection_One/Game B', 'Collection_Link']) {
    await assert.rejects(reader.listDirectory(root, path));
  }
  await assert.rejects(reader.listDirectory(join(base, 'Other'), ''));
});

test('folder resolution rejects traversal, files, deeper paths, and changed collection junctions', async t => {
  const { base, root, service, opened } = await fixture(t);
  await service.chooseRoot(async () => root);
  const member = value(await service.scan()).games.find(game => game.folderName === 'Game B')!;
  for (const path of ['../Outside', root, 'setup.exe', 'Game A/sentinel.txt', 'Game A/Never Visit/Deeper']) {
    await assert.rejects(resolveInstallFolder(root, path));
  }
  await rename(join(root, 'Collection_One'), join(base, 'Moved Collection'));
  await symlink(join(base, 'Moved Collection'), join(root, 'Collection_One'), 'junction');
  assert.equal((await service.openInstallFolder(member.id)).ok, false);
  assert.deepEqual(opened, []);
});

test('unknown or invalid IDs never invoke Explorer; OS errors are reported without raw details', async t => {
  const { root, service, opened } = await fixture(t, createScanReader, 'raw OS detail');
  await service.chooseRoot(async () => root);
  const catalog = value(await service.scan());
  for (const id of [-1, 0, 1.5, NaN, 9999]) assert.equal((await service.openInstallFolder(id)).ok, false);
  assert.deepEqual(opened, []);
  const result = await service.openInstallFolder(catalog.games[0].id);
  assert.equal(result.ok, false);
  assert.equal(result.message?.includes('raw OS detail'), false);
  assert.equal(opened.length, 1);
});

test('concurrent requests cannot change the root or scan twice; shutdown prevents late writes', async t => {
  let started!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const wait = new Promise<void>(resolve => { release = resolve; });
  const { base, root, service } = await fixture(t, async path => { started(); await wait; return createScanReader(path); });
  await service.chooseRoot(async () => root);
  const scan = service.scan();
  await entered;
  let picked = false;
  await service.chooseRoot(async () => { picked = true; return root; });
  assert.equal(picked, false);
  assert.equal((await service.scan()).ok, false);
  service.close();
  release();
  assert.equal((await scan).ok, false);
  await assert.rejects(readFile(join(base, 'data', 'library.db')), { code: 'ENOENT' });
});

test('external configuration changes during a scan prevent reconciliation', async t => {
  let configFile = '';
  const { base, root, service } = await fixture(t, async path => {
    const reader = await createScanReader(path);
    return { ...reader, async verifyUnchanged() {
      await reader.verifyUnchanged();
      await writeFile(configFile, '[library]\nroot=Other\n');
    } };
  });
  configFile = join(base, 'config.ini');
  await service.chooseRoot(async () => root);
  assert.equal((await service.scan()).ok, false);
  await assert.rejects(readFile(join(base, 'data', 'library.db')), { code: 'ENOENT' });
});

test('custom collection prefix is read from INI and raw provider data never enters view responses', async t => {
  const { base, root, service } = await fixture(t);
  await service.chooseRoot(async () => root);
  await mkdir(join(root, 'Set_Test', 'Member'), { recursive: true });
  await writeFile(join(base, 'config.ini'), '[library]\nroot=Games 日本語\ncollectionPrefix=Set_\n[provider.fixture]\nkey=fake-secret\n');
  const catalog = value(await service.scan());
  assert.equal(catalog.collections.length, 1);
  assert.equal(catalog.collections[0].displayName, 'Test');
  const db = new Database(join(base, 'data', 'library.db'));
  try { db.prepare('UPDATE games SET provider_metadata = ?').run('{"fixture":"private provider data"}'); } finally { db.close(); }
  const serialized = JSON.stringify(await service.getCatalog());
  assert.equal(serialized.includes('private provider data'), false);
  assert.equal(serialized.includes('fake-secret'), false);
});

test('corrupt database returns an error without replacing catalog data', async t => {
  const { base, root, service } = await fixture(t);
  await service.chooseRoot(async () => root);
  await mkdir(join(base, 'data'));
  const file = join(base, 'data', 'library.db');
  await writeFile(file, 'corrupt fixture');
  assert.equal((await service.getCatalog()).ok, false);
  assert.equal((await service.scan()).ok, false);
  assert.equal(await readFile(file, 'utf8'), 'corrupt fixture');
});

test('editing the root in INI cannot reconcile or open another library using cached IDs', async t => {
  const { base, root, service, opened } = await fixture(t);
  await service.chooseRoot(async () => root);
  const before = value(await service.scan());
  const ini = await readFile(join(base, 'config.ini'), 'utf8');
  await mkdir(join(base, 'Other', 'Game'), { recursive: true });
  await writeFile(join(base, 'config.ini'), '[library]\nroot=Other\n');
  assert.equal((await service.getCatalog()).ok, false);
  assert.equal((await service.scan()).ok, false);
  assert.equal((await service.openInstallFolder(before.games[0].id)).ok, false);
  assert.deepEqual(opened, []);
  await writeFile(join(base, 'config.ini'), ini);
  assert.deepEqual(value(await service.getCatalog()), before);
});
