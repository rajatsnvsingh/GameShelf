import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rename, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConfigService, atomicWrite } from '../src/main/config/service.ts';
import { parseIni, writeIni, withDefaults } from '../src/main/config/ini.ts';
import { portableBase, relativeRoot, resolveRoot } from '../src/main/config/paths.ts';

test('portable base uses the app location in development and launcher directory in a package', () => {
  assert.equal(portableBase(false, 'C:\\Apps\\GameShelf', 'Z:\\ignored'), 'C:\\Apps\\GameShelf');
  assert.equal(portableBase(true, 'C:\\Temp\\extracted', 'E:\\GameShelf'), 'E:\\GameShelf');
  for (const value of [undefined, '', 'relative', '\\\\server\\share']) {
    assert.throws(() => portableBase(true, 'C:\\Temp\\extracted', value));
  }
});

test('relative roots relocate across drive letters and preserve spaces and Unicode', () => {
  const relative = relativeRoot('E:\\GameShelf', 'E:\\GameShelf\\Jeux 日本語');
  assert.equal(relative, 'Jeux 日本語');
  assert.equal(resolveRoot('G:\\GameShelf', relative), 'G:\\GameShelf\\Jeux 日本語');
  assert.equal(resolveRoot('G:\\GameShelf', '../Games'), 'G:\\Games');
  assert.equal(relativeRoot('E:\\GameShelf', 'e:\\Games'), '../Games');
});

test('rejects cross-drive, drive-qualified, UNC, app-containing and data-overlapping roots', () => {
  for (const relative of ['E:\\Games', 'E:Games', '\\\\server\\Games', '/Games', '.', '..', 'data', 'data/artwork', 'Games/../../..']) {
    assert.throws(() => resolveRoot('E:\\GameShelf', relative), relative);
  }
  assert.throws(() => relativeRoot('E:\\GameShelf', 'G:\\Games'));
  assert.equal(resolveRoot('E:\\GameShelf', 'database-games'), 'E:\\GameShelf\\database-games');
});

test('INI defaults and string round trips preserve punctuation and future secrets', () => {
  const ini = withDefaults(parseIni('\uFEFF; comment\n[library]\nroot=Jeux 日本語\n[provider.future]\nkey="fake;#=token"\n'));
  assert.equal(ini.library.collectionPrefix, 'Collection_');
  assert.equal(ini.library.showCollectionGames, 'true');
  assert.equal(ini.metadata.providerOrder, 'igdb,thegamesdb,steamgriddb');
  assert.equal(ini.metadata.matchingThreshold, '0.90');
  assert.deepEqual(parseIni(writeIni(ini)), ini);
});

test('settings persist durable values while returning only redacted provider status', async t => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-settings-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const service = new ConfigService(base);
  const before = await service.getSettings();
  await service.saveSettings({ collectionPrefix: 'Set_', showCollectionGames: false, matchingThreshold: 0.75, defaultSort: 'releaseDate', providerOrder: ['thegamesdb', 'igdb'], providers: { igdb: { enabled: true, configured: false }, thegamesdb: { enabled: true, configured: false }, steamgriddb: { enabled: false, configured: false } }, credentials: { igdbClientId: 'id', igdbClientSecret: 'secret', thegamesdbApiKey: 'key' } });
  const after = await service.getSettings();
  assert.equal(before.providers.igdb.configured, false); assert.equal(after.collectionPrefix, 'Set_'); assert.equal(after.showCollectionGames, false); assert.equal(after.matchingThreshold, 0.75); assert.deepEqual(after.providerOrder, ['thegamesdb', 'igdb']); assert.equal(after.providers.igdb.configured, true); assert.ok(!JSON.stringify(after).includes('secret'));
  await assert.rejects(() => service.saveSettings({ ...after, collectionPrefix: '../bad', providers: after.providers }));
});

test('malformed INI and invalid settings are rejected without including values in errors', () => {
  for (const text of ['junk', '[bad', '[x]\na=1\na=2', '[x]\n[x]', '[x]\na="fake-secret',
    '[app]\nversion=2', '[library]\ncollectionPrefix=', '[library]\nshowCollectionGames=yes',
    '[metadata]\nmatchingThreshold=2', '[view]\ndefaultSort=unknown']) {
    assert.throws(() => withDefaults(parseIni(text)), error => error instanceof Error && !error.message.includes('fake-secret'));
  }
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-config-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const games = join(base, 'Jeux 日本語');
  await mkdir(games);
  return { base, games, file: join(base, 'config.ini'), service: new ConfigService(base) };
}

test('missing config uses defaults, cancel writes nothing, selection persists a relative root', async t => {
  const { base, games, file, service } = await fixture(t);
  assert.equal((await service.getState()).status, 'unconfigured');
  assert.equal((await service.chooseRoot(async () => undefined)).status, 'unconfigured');
  await assert.rejects(readFile(file), { code: 'ENOENT' });
  assert.equal((await service.chooseRoot(async () => games)).status, 'ready');
  const ini = parseIni(await readFile(file, 'utf8'));
  assert.equal(ini.library.root, 'Jeux 日本語');
  assert.equal((await new ConfigService(base).getState()).root, games);
  assert.deepEqual(await readdir(games), []);
  assert.deepEqual((await readdir(base)).sort(), ['Jeux 日本語', 'config.ini'].sort());
});

test('invalid config is preserved and picker is not invoked', async t => {
  const { file, service } = await fixture(t);
  const invalid = '[provider.future]\nkey="fake-secret\n';
  await writeFile(file, invalid);
  assert.equal((await service.getState()).status, 'config-error');
  let picked = false;
  assert.equal((await service.chooseRoot(async () => { picked = true; return undefined; })).status, 'config-error');
  assert.equal(picked, false);
  assert.equal(await readFile(file, 'utf8'), invalid);
});

test('unavailable and invalid persisted roots stay distinguishable and are never reset', async t => {
  const { file, service } = await fixture(t);
  await writeFile(file, '[library]\nroot=Missing\n');
  assert.equal((await service.getState()).status, 'unavailable');
  assert.equal(await readFile(file, 'utf8'), '[library]\nroot=Missing\n');
  await writeFile(file, '[library]\nroot=../..\n');
  assert.equal((await service.getState()).status, 'config-error');
});

test('selection rejects app/data roots, missing folders, files and junctions into data', async t => {
  const { base, file, service } = await fixture(t);
  const data = join(base, 'data');
  await mkdir(data);
  const link = join(base, 'linked-data');
  await symlink(data, link, 'junction');
  const plainFile = join(base, 'not-a-folder');
  await writeFile(plainFile, 'fixture');
  for (const candidate of [base, data, link, plainFile, join(base, 'missing')]) {
    assert.equal((await service.chooseRoot(async () => candidate)).status, 'unconfigured');
    await assert.rejects(readFile(file), { code: 'ENOENT' });
  }
});

test('root updates preserve unknown future provider values and expose no credentials', async t => {
  const { games, file, service } = await fixture(t);
  await writeFile(file, '[provider.future]\nkey="fake-secret"\n');
  const state = await service.chooseRoot(async () => games);
  assert.equal(state.status, 'ready');
  assert.equal(parseIni(await readFile(file, 'utf8'))['provider.future'].key, 'fake-secret');
  assert.equal(JSON.stringify(state).includes('fake-secret'), false);
});

test('relocating the entire portable folder keeps the saved library usable', async t => {
  const { base, games, service } = await fixture(t);
  await service.chooseRoot(async () => games);
  const relocated = `${base}-moved`;
  t.after(() => rm(relocated, { recursive: true, force: true }));
  await rename(base, relocated);
  const state = await new ConfigService(relocated).getState();
  assert.equal(state.status, 'ready');
  assert.equal(state.root, join(relocated, 'Jeux 日本語'));
});

test('existing catalog prevents switching libraries and preserves config', async t => {
  const { base, games, file, service } = await fixture(t);
  await service.chooseRoot(async () => games);
  const original = await readFile(file, 'utf8');
  await mkdir(join(base, 'data'));
  await writeFile(join(base, 'data', 'library.db'), 'fixture');
  const other = join(base, 'Other');
  await mkdir(other);
  assert.match((await service.chooseRoot(async () => other)).message, /rebuild/);
  assert.equal(await readFile(file, 'utf8'), original);
  assert.equal((await service.chooseRoot(async () => games.toUpperCase())).status, 'ready');
});

test('overlapping picker requests open only one dialog', async t => {
  const { service } = await fixture(t);
  let release!: () => void;
  const entered = new Promise<void>(resolve => { release = resolve; });
  let finish!: (value: undefined) => void;
  const first = service.chooseRoot(() => { release(); return new Promise(resolve => { finish = resolve; }); });
  await entered;
  await service.chooseRoot(async () => { assert.fail('Second picker must not open'); });
  finish(undefined);
  await first;
});

test('failed atomic replacement keeps the destination and cleans its temporary file', async t => {
  const { base } = await fixture(t);
  const destination = join(base, 'existing');
  await mkdir(destination);
  await writeFile(join(destination, 'keep'), 'original');
  await assert.rejects(atomicWrite(destination, 'replacement'));
  assert.equal(await readFile(join(destination, 'keep'), 'utf8'), 'original');
  assert.equal((await readdir(base)).some(name => name.endsWith('.tmp')), false);
});
