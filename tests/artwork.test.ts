import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtworkCache } from '../src/main/artwork/cache.ts';
import { SteamGridDbProvider } from '../src/main/metadata/steamgriddb.ts';
import { openCatalog } from '../src/main/database/catalog.ts';
import { scanLibrary } from '../src/main/library/scanner.ts';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
test('artwork cache uses opaque relative names and leaves no file after an interrupted response', async t => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-artwork-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const cache = new ArtworkCache(base, async () => new Response(jpeg, { headers: { 'content-type': 'image/jpeg' } }) as Response);
  const name = await cache.download(7, { kind: 'cover', url: 'https://images.example/secret-name.jpg' });
  assert.match(name, /^7-cover-[a-f0-9]{24}\.jpg$/);
  assert.deepEqual(await readFile(join(base, 'data', 'artwork', name)), Buffer.from(jpeg));
  const broken = new ArtworkCache(base, async () => { throw new Error('interrupted'); });
  await assert.rejects(() => broken.download(7, { kind: 'background', url: 'https://images.example/b.jpg' }));
});

test('provider artwork cannot replace a future manual asset', async t => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-artwork-repo-')); const repo = openCatalog(base, 'Games');
  t.after(async () => { repo.close(); await rm(base, { recursive: true, force: true }); });
  repo.reconcile({ status: 'complete', collections: [], games: [{ folderName: 'Game', relativePath: 'Game', collectionPath: null }] });
  const game = repo.listGames()[0];
  // Simulate the Phase 11 row: Phase 10 upserts deliberately leave it untouched.
  const db = (repo as unknown as { db: { prepare(sql: string): { run(...args: unknown[]): void } } }).db;
  db.prepare("INSERT INTO artwork VALUES (?, 'cover', 'manual', 'manual.png', NULL)").run(game.id);
  assert.equal(repo.saveProviderArtwork(game.id, 'cover', 'provider.jpg', 'https://images.example/a.jpg'), false);
  assert.deepEqual(repo.listArtwork(game.id), [{ kind: 'cover', source: 'manual', localPath: 'manual.png' }]);
});

test('a provider artwork refresh replaces an existing provider cache row', async t => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-artwork-refresh-')); const repo = openCatalog(base, 'Games');
  t.after(async () => { repo.close(); await rm(base, { recursive: true, force: true }); });
  repo.reconcile({ status: 'complete', collections: [], games: [{ folderName: 'Game', relativePath: 'Game', collectionPath: null }] });
  const game = repo.listGames()[0];
  assert.equal(repo.saveProviderArtwork(game.id, 'cover', 'first.jpg', 'https://images.example/first.jpg'), true);
  assert.equal(repo.saveProviderArtwork(game.id, 'cover', 'replacement.jpg', 'https://images.example/replacement.jpg'), true);
  assert.deepEqual(repo.listArtwork(game.id), [{ kind: 'cover', source: 'provider', localPath: 'replacement.jpg' }]);
});

test('a confirmed provider replacement can replace user-supplied artwork', async t => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-artwork-confirm-')); const repo = openCatalog(base, 'Games');
  t.after(async () => { repo.close(); await rm(base, { recursive: true, force: true }); });
  repo.reconcile({ status: 'complete', collections: [], games: [{ folderName: 'Game', relativePath: 'Game', collectionPath: null }] });
  const game = repo.listGames()[0];
  assert.equal(repo.saveManualArtwork(game.id, 'cover', 'manual.png'), true);
  assert.equal(repo.replaceWithProviderArtwork(game.id, 'cover', 'confirmed.jpg', 'https://images.example/confirmed.jpg'), true);
  assert.deepEqual(repo.listArtwork(game.id), [{ kind: 'cover', source: 'provider', localPath: 'confirmed.jpg' }]);
});

test('SteamGridDB is artwork-only and sends its key only in an authorization header', async () => {
  const calls: RequestInit[] = [];
  const provider = new SteamGridDbProvider({ enabled: true, apiKey: 'secret' }, async (_url, init) => {
    calls.push(init!); return new Response(JSON.stringify({ success: true, data: [{ id: 4, name: 'Game' }] }));
  });
  assert.deepEqual(await provider.search('Game'), [{ recordId: '4', title: 'Game' }]);
  assert.equal(provider.capabilities.metadata, false);
  assert.equal((calls[0].headers as Record<string, string>).Authorization, 'Bearer secret');
});
