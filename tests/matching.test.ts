import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { LibraryService } from '../src/main/library/service.ts';
import { ConfigService } from '../src/main/config/service.ts';
import type { MetadataProvider } from '../src/main/metadata/provider.ts';
import type { OperationResult } from '../src/shared/api.ts';
import { validateArtworkRequest, validateSearchRequest, validateSelectionRequest } from '../src/main/ipc.ts';
import { openCatalog } from '../src/main/database/catalog.ts';

function value<T>(result: OperationResult<T>): T { if (!result.ok) assert.fail(result.message); return result.value; }
async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-matching-'));
  const root = join(base, 'Games');
  await mkdir(join(root, 'Game A'), { recursive: true });
  await mkdir(join(root, 'Game B'));
  const calls: string[] = [];
  const provider: MetadataProvider = {
    id: 'fixture', capabilities: { artwork: [] },
    async search(query) {
      calls.push(`search:${query}`);
      if (query === 'Game A') return [{ recordId: '1', title: 'Game A' }];
      return [{ recordId: '2', title: 'Game B Deluxe', releaseYear: 1999, hasArtwork: true }, { recordId: '3', title: 'Game B Classic', releaseYear: 2024 }];
    },
    async getGame(recordId) {
      calls.push(`detail:${recordId}`);
      return { recordId, title: recordId === '1' ? 'Game A' : recordId === '2' ? 'Game B Deluxe' : 'Game B Classic', description: 'Fixture description',
        artwork: [{ kind: 'cover', url: 'https://fixture.invalid/image.jpg' }] };
    }
  };
  const entry = { provider, enabled: true, configured: true };
  const artworkOnlyProvider: MetadataProvider = {
    id: 'artwork-only', capabilities: { artwork: [], metadata: false },
    async search(query) { calls.push(`artwork:${query}`); return [{ recordId: 'art', title: query }]; },
    async getGame(recordId) { return { recordId, title: 'Game A', artwork: [] }; }
  };
  const artworkOnlyEntry = { provider: artworkOnlyProvider, enabled: false, configured: true };
  const config = new ConfigService(base);
  const makeService = () => new LibraryService(base, config, async () => '', undefined, async () => ({ providers: [entry, artworkOnlyEntry], threshold: 0.9, greedyMatch: false }));
  const service = makeService();
  await service.chooseRoot(async () => root);
  t.after(async () => { service.close(); await rm(base, { recursive: true, force: true }); });
  return { base, root, config, provider, entry, artworkOnlyEntry, calls, service, makeService };
}

test('scan persists exact matches and retries every unresolved game without rematching saved bindings', async t => {
  const f = await fixture(t);
  const firstScan = await f.service.scan();
  assert.match(firstScan.message ?? '', /1 of 2 unresolved games matched/);
  const first = value(firstScan);
  assert.equal(first.games[0].bindingSource, 'automatic');
  assert.equal(first.games[0].providerRecordId, '1');
  assert.equal(first.games[1].matchStatus, 'unmatched');
  assert.ok(!JSON.stringify(first).includes('https://'));
  assert.equal(first.games[0].metadata.description, 'Fixture description');
  assert.deepEqual(f.service.getMatchingStatus(), { phase: 'complete', attempted: 2, total: 2, matched: 1, gameName: 'Game B', message: '1 of 2 unresolved games matched.' });
  f.artworkOnlyEntry.enabled = true;
  f.calls.length = 0;
  value(await f.service.scan());
  assert.deepEqual(f.calls, ['search:Game B']);
  value(await f.service.autoMatch(first.games[0].id));
  assert.deepEqual(f.calls, ['search:Game B']);
  await mkdir(join(f.root, 'New game'));
  value(await f.service.scan());
  assert.deepEqual(f.calls, ['search:Game B', 'search:Game B', 'search:New game']);
});

test('manual search/selection persists binding, respects overrides, and survives rescan and restart', async t => {
  const f = await fixture(t);
  const catalog = value(await f.service.scan());
  const game = catalog.games[1];
  const db = new Database(join(f.base, 'data', 'library.db'));
  db.prepare('UPDATE games SET manual_overrides = ? WHERE id = ?').run(JSON.stringify({ title: 'My title', description: null, cover: 'custom.png' }), game.id);
  db.close();
  const candidates = value(await f.service.searchMatches(game.id, 'Corrected title', 'fixture')).candidates;
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].hasArtwork, true);
  assert.equal(value(await f.service.getCatalog()).games[1].matchStatus, 'unmatched');
  const saved = value(await f.service.selectMatch(game.id, 'fixture', '3')).games[1];
  assert.equal(saved.bindingSource, 'manual');
  assert.equal(saved.providerRecordId, '3');
  assert.equal(saved.metadata.title, 'My title');
  assert.equal(saved.metadata.description, undefined);
  f.calls.length = 0;
  const scanned = value(await f.service.scan()).games[1];
  assert.equal(scanned.providerRecordId, '3');
  assert.deepEqual(f.calls, []);
  f.service.close();
  const restarted = f.makeService();
  try { assert.deepEqual(value(await restarted.getCatalog()).games[1], scanned); }
  finally { restarted.close(); }
  const check = new Database(join(f.base, 'data', 'library.db'));
  assert.deepEqual(JSON.parse((check.prepare('SELECT manual_overrides FROM games WHERE id=?').get(game.id) as { manual_overrides: string }).manual_overrides),
    { title: 'My title', description: null, cover: 'custom.png' });
  check.close();
});

test('provider outages after local reconciliation preserve discoveries and continue matching later games', async t => {
  const f = await fixture(t);
  f.provider.search = async () => { f.calls.push('offline'); throw new Error('fixture-secret'); };
  const result = await f.service.scan();
  const catalog = value(result);
  assert.equal(catalog.games.length, 2);
  assert.ok(catalog.games.every(game => !game.missing && game.matchStatus === 'unmatched'));
  assert.deepEqual(f.calls, ['offline', 'offline']);
  assert.ok(result.message?.includes('Some provider requests failed'));
  assert.ok(!JSON.stringify(result).includes('fixture-secret'));
});

test('a provider failure for one game does not prevent a later game from matching', async t => {
  const f = await fixture(t);
  f.provider.search = async query => {
    f.calls.push(`search:${query}`);
    if (query === 'Game A') throw new Error('fixture-secret');
    return [{ recordId: '2', title: 'Game B' }];
  };
  f.provider.getGame = async recordId => ({ recordId, title: 'Game B', artwork: [] });
  const catalog = value(await f.service.scan());
  assert.equal(catalog.games.find(game => game.folderName === 'Game A')?.matchStatus, 'unmatched');
  assert.equal(catalog.games.find(game => game.folderName === 'Game B')?.matchStatus, 'matched');
  assert.deepEqual(f.calls, ['search:Game A', 'search:Game B']);
});

test('existing unresolved games can retry automatic matching without a rescan', async t => {
  const f = await fixture(t);
  f.entry.enabled = false;
  const catalog = value(await f.service.scan());
  assert.deepEqual(f.calls, []);
  assert.equal((await f.service.autoMatch(catalog.games[0].id)).ok, false);
  f.entry.enabled = true;
  const matched = value(await f.service.autoMatch(catalog.games[0].id));
  assert.equal(matched.games[0].bindingSource, 'automatic');
  assert.equal(matched.games[0].lastSeenAt, catalog.games[0].lastSeenAt);
});

test('candidate selections require the latest search for that game and current settings', async t => {
  const f = await fixture(t);
  const catalog = value(await f.service.scan());
  const id = catalog.games[1].id;
  assert.equal((await f.service.selectMatch(id, 'fixture', '3')).ok, false);
  value(await f.service.searchMatches(id, 'Game B'));
  assert.equal((await f.service.selectMatch(catalog.games[0].id, 'fixture', '3')).ok, false);
  assert.equal((await f.service.selectMatch(id, 'other', '3')).ok, false);
  assert.equal((await f.service.selectMatch(id, 'fixture', '999')).ok, false);
  const ini = await readFile(join(f.base, 'config.ini'), 'utf8');
  await writeFile(join(f.base, 'config.ini'), ini.replace('0.75', '0.80'));
  assert.equal((await f.service.selectMatch(id, 'fixture', '3')).ok, false);
  assert.equal(value(await f.service.getCatalog()).games[1].matchStatus, 'unmatched');
});

test('failed or changed detail retrieval preserves the prior match and metadata', async t => {
  const f = await fixture(t);
  const catalog = value(await f.service.scan());
  const id = catalog.games[0].id;
  value(await f.service.searchMatches(id, 'Game B'));
  f.provider.getGame = async () => { throw new Error('fixture-secret'); };
  const failed = await f.service.selectMatch(id, 'fixture', '3');
  assert.equal(failed.ok, false);
  assert.ok(!JSON.stringify(failed).includes('fixture-secret'));
  assert.deepEqual(value(await f.service.getCatalog()), catalog);
  f.provider.getGame = async recordId => ({ recordId, title: 'Changed title', artwork: [] });
  assert.equal((await f.service.selectMatch(id, 'fixture', '3')).ok, false);
  assert.deepEqual(value(await f.service.getCatalog()), catalog);
});

test('shutdown during retrieval prevents late match writes', async t => {
  const f = await fixture(t);
  const catalog = value(await f.service.scan());
  const id = catalog.games[1].id;
  value(await f.service.searchMatches(id, 'Game B'));
  f.provider.getGame = async recordId => {
    f.service.close();
    return { recordId, title: 'Game B', artwork: [] };
  };
  assert.equal((await f.service.selectMatch(id, 'fixture', '3')).ok, false);
  const reopened = f.makeService();
  try { assert.equal(value(await reopened.getCatalog()).games[1].matchStatus, 'unmatched'); }
  finally { reopened.close(); }
});

test('metadata settings changed during detail retrieval discard the result', async t => {
  const f = await fixture(t);
  const catalog = value(await f.service.scan());
  const id = catalog.games[1].id;
  value(await f.service.searchMatches(id, 'Game B'));
  f.provider.getGame = async recordId => {
    const path = join(f.base, 'config.ini');
    await writeFile(path, (await readFile(path, 'utf8')).replace('0.75', '0.80'));
    return { recordId, title: 'Game B', artwork: [] };
  };
  assert.equal((await f.service.selectMatch(id, 'fixture', '3')).ok, false);
  assert.deepEqual(value(await f.service.getCatalog()), catalog);
});

test('repository automatic saves cannot overwrite a manual binding; invalid saves are rejected', async t => {
  const f = await fixture(t);
  const catalog = value(await f.service.scan());
  f.service.close();
  const repo = openCatalog(f.base, 'Games');
  try {
    const id = catalog.games[1].id;
    const details = { recordId: '3', title: 'Game B', artwork: [] };
    assert.equal(repo.saveMatch(id, { providerId: 'fixture', providerRecordId: '3', source: 'manual', confidence: null }, details), true);
    assert.equal(repo.saveMatch(id, { providerId: 'fixture', providerRecordId: '3', source: 'automatic', confidence: 1 }, details), false);
    assert.throws(() => repo.saveMatch(id, { providerId: 'fixture', providerRecordId: 'wrong', source: 'manual', confidence: null }, details));
    assert.equal(repo.listGames()[1].bindingSource, 'manual');
  } finally { repo.close(); }
});

test('manual metadata and pasted artwork override provider data and survive restart', async t => {
  const f = await fixture(t); const game = value(await f.service.scan()).games[0];
  const overridden = value(await f.service.saveOverrides(game.id, { title: 'Personal title', description: null, genres: ['Custom'] })).games[0];
  assert.equal(overridden.metadata.title, 'Personal title'); assert.equal(overridden.metadata.description, undefined); assert.deepEqual(overridden.metadata.genres, ['Custom']);
  const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  const pasted = value(await f.service.pasteArtwork(game.id, 'cover', png)).games[0]; assert.match(pasted.coverUrl!, /^gameshelf-artwork:\/\/local\/1-manual-/);
  assert.equal((await f.service.pasteArtwork(game.id, 'cover', new Uint8Array([1]))).ok, false);
  f.service.close(); const restarted = f.makeService(); try { const saved = value(await restarted.getCatalog()).games[0]; assert.equal(saved.metadata.title, 'Personal title'); assert.match(saved.coverUrl!, /^gameshelf-artwork:/); } finally { restarted.close(); }
});

test('artwork preview leaves the saved metadata binding untouched when no provider artwork is available', async t => {
  const f = await fixture(t);
  const game = value(await f.service.scan()).games[0];
  f.calls.length = 0;
  const preview = await f.service.fetchArtwork(game.id);
  assert.equal(preview.ok, false);
  const refreshed = value(await f.service.getCatalog()).games[0];
  assert.equal(refreshed.providerId, 'fixture');
  assert.equal(refreshed.providerRecordId, '1');
  assert.deepEqual(f.calls, ['detail:1']);
});

test('replace-all rescrape clears manual work only after successful bound-provider retrieval', async t => {
  const f = await fixture(t); const game = value(await f.service.scan()).games[0]; const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  value(await f.service.saveOverrides(game.id, { title: 'Keep me' })); value(await f.service.pasteArtwork(game.id, 'cover', png));
  f.provider.getGame = async () => { throw new Error('offline'); };
  const failed = await f.service.replaceAllRescrape(game.id); assert.equal(failed.ok, false); assert.equal(value(await f.service.getCatalog()).games[0].metadata.title, 'Keep me');
  f.provider.getGame = async recordId => ({ recordId, title: 'Game A', description: 'Fresh provider text', artwork: [] });
  const refreshed = value(await f.service.replaceAllRescrape(game.id)).games[0]; assert.equal(refreshed.metadata.title, 'Game A'); assert.equal(refreshed.metadata.description, 'Fresh provider text'); assert.equal(refreshed.coverUrl, undefined);
});

test('maintenance removes only missing records and rebuild failure restores the original catalog', async t => {
  const f = await fixture(t); const first = value(await f.service.scan());
  await rm(join(f.root, 'Game B'), { recursive: true, force: true }); value(await f.service.scan());
  const removed = value(await f.service.deleteMissing()); assert.equal(removed.games.length, 1); assert.equal(removed.games[0].id, first.games[0].id);
  const original = value(await f.service.getCatalog());
  await rm(f.root, { recursive: true, force: true }); const failed = await f.service.rebuildCatalog(); assert.equal(failed.ok, false);
  assert.deepEqual(value(await f.service.getCatalog()), original);
});

test('wipe library clears catalog data but preserves configuration and installer folders', async t => {
  const f = await fixture(t); value(await f.service.scan());
  await mkdir(join(f.base, 'data', 'artwork'), { recursive: true });
  await writeFile(join(f.base, 'data', 'artwork', 'cached.png'), 'cache');
  const wiped = await f.service.wipeLibrary();
  assert.equal(wiped.ok, true);
  assert.equal((await f.config.getState()).status, 'ready');
  assert.ok((await readFile(join(f.base, 'config.ini'), 'utf8')).includes('root'));
  await assert.rejects(readdir(join(f.base, 'data')), { code: 'ENOENT' });
  assert.deepEqual((await readdir(f.root)).sort(), ['Game A', 'Game B']);
});

test('matching IPC rejects untrusted frames, arbitrary payloads, malformed IDs and oversized queries', () => {
  assert.deepEqual(validateSearchRequest(true, [1, 'Game A']), [1, 'Game A']);
  assert.deepEqual(validateSearchRequest(true, [1, 'Game A', 'igdb']), [1, 'Game A', 'igdb']);
  assert.deepEqual(validateSelectionRequest(true, [1, 'igdb', '123']), [1, 'igdb', '123']);
  assert.deepEqual(validateArtworkRequest(true, [1]), [1, undefined]);
  assert.deepEqual(validateArtworkRequest(true, [1, '123']), [1, '123']);
  assert.throws(() => validateSearchRequest(false, [1, 'Game A']));
  assert.throws(() => validateSelectionRequest(false, [1, 'igdb', '123']));
  for (const args of [[], [1], [1, 'x', 'extra', 'more'], ['1', 'x'], [1, ''], [1, 'x'.repeat(251)], [1, 'a\nb'], [1, 'x', '../provider']]) assert.throws(() => validateSearchRequest(true, args));
  for (const args of [[], [1, 'igdb'], [1, 'igdb', '1', {}], [0, 'igdb', '1'], [1, '../igdb', '1'], [1, 'igdb', {}]]) assert.throws(() => validateSelectionRequest(true, args));
  for (const args of [[], [1, '0'], [1, '-1'], [1, 1], [1, '1', 'extra']]) assert.throws(() => validateArtworkRequest(true, args));
  assert.throws(() => validateArtworkRequest(false, [1]));
});
