import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyMigrations, migrations } from '../src/main/database/migrations.ts';
import { CatalogRepository } from '../src/main/database/repository.ts';
import { openCatalog } from '../src/main/database/catalog.ts';
import { catalogPath } from '../src/main/database/identity.ts';
import { scanLibrary, type ScanResult } from '../src/main/library/scanner.ts';

const first = '2026-09-09T10:00:00.000Z';
const later = '2026-09-10T10:00:00.000Z';
const last = '2026-09-11T10:00:00.000Z';
const empty: ScanResult = { status: 'complete', games: [], collections: [] };

function snapshot(paths: string[] = ['Game A', 'Collection_One/Game B'], collectionNames = ['Collection_One']): ScanResult {
  return {
    status: 'complete',
    collections: collectionNames.map(name => ({ folderName: name, displayName: name.slice('Collection_'.length), relativePath: name })),
    games: paths.map(path => {
      const parts = path.replaceAll('\\', '/').split('/');
      return { folderName: parts.at(-1)!, relativePath: path, collectionPath: parts.length === 1 ? null : parts[0] };
    })
  };
}

function memory(t: { after: (fn: () => void) => void }) {
  const db = new Database(':memory:');
  t.after(() => db.close());
  db.pragma('foreign_keys = ON');
  applyMigrations(db);
  return { db, repo: new CatalogRepository(db) };
}

test('catalog identity normalizes separators and case while preserving literal path spelling', () => {
  assert.deepEqual(catalogPath('Collection_One\\日本語 Game'), {
    path: 'Collection_One/日本語 Game', key: 'collection_one/日本語 game', parts: ['Collection_One', '日本語 Game']
  });
  for (const path of ['', '.', '..', '../Game', '/Game', 'E:\\Game', 'A//B', 'A/../B', 'Game.', 'Game ']) {
    assert.throws(() => catalogPath(path), path);
  }
});

test('migrations initialize once and apply a later version in order', t => {
  const { db } = memory(t);
  const before = db.prepare('SELECT * FROM schema_migrations').all();
  applyMigrations(db);
  assert.deepEqual(db.prepare('SELECT * FROM schema_migrations').all(), before);
  const next = [...migrations, { version: 2, name: 'fixture-extension', sql: 'CREATE TABLE fixture_extension (value TEXT)' }];
  applyMigrations(db, next);
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations ORDER BY version').all(), [{ version: 1 }, { version: 2 }]);
  db.prepare('INSERT INTO fixture_extension VALUES (?)').run('usable');
});

test('failed migration batch rolls back schema and history while preserving existing data', t => {
  const { db, repo } = memory(t);
  repo.reconcile(snapshot(), first);
  const before = repo.listGames();
  assert.throws(() => applyMigrations(db, [...migrations,
    { version: 2, name: 'fixture-extension', sql: 'CREATE TABLE fixture_extension (value TEXT)' },
    { version: 3, name: 'broken', sql: 'INSERT INTO nonexistent_table VALUES (1)' }
  ]));
  assert.deepEqual(repo.listGames(), before);
  assert.deepEqual(db.prepare('SELECT version FROM schema_migrations').all(), [{ version: 1 }]);
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name = 'fixture_extension'").get(), undefined);
});

test('failed initial migration leaves no partial schema', t => {
  const db = new Database(':memory:');
  t.after(() => db.close());
  assert.throws(() => applyMigrations(db, [{ version: 1, name: 'broken', sql: 'CREATE TABLE partial (id INTEGER); invalid SQL;' }]));
  assert.deepEqual(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all(), []);
});

test('future, inconsistent, or nonconsecutive migrations are refused', t => {
  const { db } = memory(t);
  assert.throws(() => applyMigrations(db, [{ version: 2, name: 'gap', sql: '' }]), /consecutive/);
  db.prepare('UPDATE schema_migrations SET name = ? WHERE version = 1').run('changed');
  assert.throws(() => applyMigrations(db), /history/);
  db.prepare('UPDATE schema_migrations SET name = ? WHERE version = 1').run(migrations[0].name);
  db.prepare('INSERT INTO schema_migrations VALUES (2, ?, ?)').run('future', first);
  assert.throws(() => applyMigrations(db), /history/);
});

test('complete scans add collections and games, with valid membership and unmatched defaults', t => {
  const { repo } = memory(t);
  assert.equal(repo.reconcile(snapshot(), first), 'applied');
  const collections = repo.listCollections();
  const games = repo.listGames();
  assert.equal(collections.length, 1);
  assert.equal(games.length, 2);
  assert.equal(games.find(game => game.folderName === 'Game B')!.collectionId, collections[0].id);
  assert.equal(games.find(game => game.folderName === 'Game A')!.collectionId, null);
  for (const game of games) {
    assert.equal(game.missing, false);
    assert.equal(game.addedAt, first);
    assert.equal(game.lastSeenAt, first);
    assert.equal(game.matchStatus, 'unmatched');
    assert.equal(game.providerId, null);
    assert.deepEqual(game.providerMetadata, {});
    assert.deepEqual(game.manualOverrides, {});
  }
});

test('repeat scans preserve IDs and added dates, update last seen, and do not duplicate records', t => {
  const { repo } = memory(t);
  repo.reconcile(snapshot(), first);
  const beforeGames = repo.listGames();
  const beforeCollections = repo.listCollections();
  repo.reconcile(snapshot(), first);
  assert.deepEqual(repo.listGames(), beforeGames);
  assert.deepEqual(repo.listCollections(), beforeCollections);
  repo.reconcile(snapshot(), later);
  assert.deepEqual(repo.listGames(), beforeGames.map(game => ({ ...game, lastSeenAt: later })));
  assert.deepEqual(repo.listCollections(), beforeCollections.map(collection => ({ ...collection, lastSeenAt: later })));
});

test('absent games and collections become missing without deletion and reappear with the same IDs', t => {
  const { repo } = memory(t);
  repo.reconcile(snapshot(), first);
  const beforeGames = repo.listGames();
  const beforeCollections = repo.listCollections();
  repo.reconcile(snapshot(['Game A'], []), later);
  const missing = repo.listGames().find(game => game.folderName === 'Game B')!;
  assert.equal(missing.missing, true);
  assert.equal(missing.lastSeenAt, first);
  assert.equal(repo.listCollections()[0].missing, true);
  repo.reconcile(snapshot(), last);
  assert.deepEqual(repo.listGames(), beforeGames.map(game => ({ ...game, lastSeenAt: last })));
  assert.deepEqual(repo.listCollections(), beforeCollections.map(collection => ({ ...collection, lastSeenAt: last })));
});

test('a successful empty scan marks all absent while empty collections remain present when discovered', t => {
  const { repo } = memory(t);
  repo.reconcile(snapshot(), first);
  repo.reconcile(snapshot([]), later);
  assert.ok(repo.listGames().every(game => game.missing));
  assert.equal(repo.listCollections()[0].missing, false);
  repo.reconcile(empty, last);
  assert.ok(repo.listCollections().every(collection => collection.missing));
  assert.equal(repo.listGames().length, 2);
});

test('scans preserve provider bindings, metadata, overrides and explicit manual clearing', t => {
  const { db, repo } = memory(t);
  repo.reconcile(snapshot(), first);
  db.prepare(`UPDATE games SET match_status = 'matched', binding_source = 'manual', provider_id = ?,
    provider_record_id = ?, confidence = ?, provider_metadata = ?, manual_overrides = ?`).run(
    'fixture-provider', 'fixture-record', 0.97,
    JSON.stringify({ title: 'Provider title', description: 'Provided description', releaseDate: '2001-01-01' }),
    JSON.stringify({ title: 'My title', description: null, cover: 'custom/fixture.png' })
  );
  const before = repo.listGames();
  repo.reconcile(empty, later);
  repo.reconcile(snapshot(), last);
  assert.deepEqual(repo.listGames(), before.map(game => ({ ...game, lastSeenAt: last })));
});

test('case/separator changes preserve identity; moves and renames create new entries', t => {
  const { repo } = memory(t);
  repo.reconcile(snapshot(), first);
  const original = repo.listGames().find(game => game.folderName === 'Game B')!;
  repo.reconcile(snapshot(['GAME A', 'collection_one\\GAME B'], ['collection_one']), later);
  assert.equal(repo.listGames().find(game => game.folderName === 'GAME B')!.id, original.id);
  assert.equal(repo.listGames().find(game => game.id === original.id)!.relativePath, 'collection_one/GAME B');
  repo.reconcile(snapshot(['Game B', 'Renamed A'], []), last);
  assert.equal(repo.listGames().length, 4);
  assert.equal(repo.listGames().find(game => game.id === original.id)!.missing, true);
  assert.notEqual(repo.listGames().find(game => game.relativePath === 'Game B')!.id, original.id);
});

test('same folder names in different collections remain distinct', t => {
  const { repo } = memory(t);
  repo.reconcile(snapshot(['Collection_A/Game', 'Collection_B/Game'], ['Collection_A', 'Collection_B']), first);
  const games = repo.listGames();
  assert.equal(games.length, 2);
  assert.notEqual(games[0].id, games[1].id);
  assert.notEqual(games[0].collectionId, games[1].collectionId);
});

test('failed root or collection scans make no changes to any catalog record', async t => {
  const { repo } = memory(t);
  repo.reconcile(snapshot(), first);
  const before = { games: repo.listGames(), collections: repo.listCollections() };
  for (const failAt of ['', 'Collection_One']) {
    const result = await scanLibrary({ root: 'E:\\Games', collectionPrefix: 'Collection_' }, async (_root, relative) => {
      if (relative === failAt) throw new Error('unavailable');
      return [{ name: 'New Game', kind: 'directory' }, { name: 'Collection_One', kind: 'directory' }];
    });
    assert.equal(repo.reconcile(result, later), 'skipped');
    assert.deepEqual({ games: repo.listGames(), collections: repo.listCollections() }, before);
  }
});

test('malformed complete snapshots fail before changing presence', t => {
  const { repo } = memory(t);
  repo.reconcile(snapshot(), first);
  const before = repo.listGames();
  for (const invalid of [
    snapshot(['Game', 'game'], []), snapshot(['../Game'], []), snapshot(['Collection_Missing/Game'], []),
    snapshot(['Collection_One']), snapshot(['Collection_One/Nested/Game']),
    { status: 'complete', games: [] }, { status: 'incomplete', games: [], collections: [] }
  ]) {
    assert.throws(() => repo.reconcile(invalid as ScanResult, later));
    assert.deepEqual(repo.listGames(), before);
  }
  assert.throws(() => repo.reconcile(empty, 'bad date'));
  assert.deepEqual(repo.listGames(), before);
});

test('a mid-transaction SQL failure rolls back new entries and missing/last-seen changes', t => {
  const { db, repo } = memory(t);
  repo.reconcile(snapshot(), first);
  const before = { games: repo.listGames(), collections: repo.listCollections() };
  db.exec(`CREATE TRIGGER fixture_failure BEFORE INSERT ON games WHEN NEW.folder_name = 'Fail'
    BEGIN SELECT RAISE(ABORT, 'fixture failure'); END;`);
  assert.throws(() => repo.reconcile(snapshot(['New Game', 'Fail'], ['Collection_New']), later), /fixture failure/);
  assert.deepEqual({ games: repo.listGames(), collections: repo.listCollections() }, before);
});

async function portableFixture(t: { after: (fn: () => Promise<void>) => void }) {
  const directory = await mkdtemp(join(tmpdir(), 'gameshelf-database-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const base = join(directory, 'Portable 日本語');
  await mkdir(join(base, 'Games'), { recursive: true });
  return { directory, base };
}

test('file catalog lives outside the scan tree, survives restart and portable-base relocation', async t => {
  const { directory, base } = await portableFixture(t);
  const repo = openCatalog(base, 'Games');
  repo.reconcile(snapshot(), first);
  const seed = new Database(join(base, 'data', 'library.db'));
  try {
    seed.prepare('UPDATE games SET manual_overrides = ?').run(JSON.stringify({ title: 'Personal title', description: null }));
  } finally { seed.close(); }
  const before = repo.listGames();
  repo.close();
  assert.deepEqual(await readdir(join(base, 'Games')), []);
  assert.deepEqual(await readdir(join(base, 'data')), ['library.db']);
  const moved = join(directory, 'Relocated 日本語');
  await rename(base, moved);
  const reopened = openCatalog(moved, 'Games');
  try { assert.deepEqual(reopened.listGames(), before); } finally { reopened.close(); }
});

test('catalog opens offline but refuses another library root and leaves original catalog usable', async t => {
  const { base } = await portableFixture(t);
  const repo = openCatalog(base, 'Games');
  repo.reconcile(snapshot(), first);
  const before = repo.listGames();
  repo.close();
  await rename(join(base, 'Games'), join(base, 'Unavailable'));
  assert.throws(() => openCatalog(base, 'Other'), /different library/);
  const reopened = openCatalog(base, 'games');
  try { assert.deepEqual(reopened.listGames(), before); } finally { reopened.close(); }
});

test('opening a corrupt database fails without replacing its bytes', async t => {
  const { base } = await portableFixture(t);
  await mkdir(join(base, 'data'));
  const file = join(base, 'data', 'library.db');
  await writeFile(file, 'corrupt fixture');
  assert.throws(() => openCatalog(base, 'Games'));
  assert.equal(await readFile(file, 'utf8'), 'corrupt fixture');
});

test('catalog storage rejects root overlap and junctions instead of writing into game folders', async t => {
  const { base } = await portableFixture(t);
  assert.throws(() => openCatalog(base, '.'), /separate/);
  assert.throws(() => openCatalog(base, 'data'), /separate/);
  await symlink(join(base, 'Games'), join(base, 'data'), 'junction');
  assert.throws(() => openCatalog(base, 'Games'), /links/);
  assert.deepEqual(await readdir(join(base, 'Games')), []);
});

test('read-only database rejects reconciliation without losing existing entries', async t => {
  const { base } = await portableFixture(t);
  const repo = openCatalog(base, 'Games');
  repo.reconcile(snapshot(), first);
  const before = repo.listGames();
  repo.close();
  const readonly = new CatalogRepository(new Database(join(base, 'data', 'library.db'), { readonly: true }));
  try {
    assert.throws(() => readonly.reconcile(empty, later), /readonly/);
    assert.deepEqual(readonly.listGames(), before);
  } finally { readonly.close(); }
});
