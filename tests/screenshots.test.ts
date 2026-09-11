import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import {
  applyMigrations,
  migrations,
} from '../src/main/database/migrations.ts';
import { CatalogRepository } from '../src/main/database/repository.ts';
import { normalizeIgdbGame } from '../src/main/metadata/igdb.ts';
import { ArtworkCache } from '../src/main/artwork/cache.ts';
import { ConfigService } from '../src/main/config/service.ts';
import { LibraryService } from '../src/main/library/service.ts';
import type {
  GameDetails,
  MetadataProvider,
} from '../src/main/metadata/provider.ts';
import type { OperationResult } from '../src/shared/api.ts';

const url = (id: number) =>
  `https://images.igdb.com/igdb/image/upload/t_1080p/shot${id}.jpg`;
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0x00]);
const scan = {
  status: 'complete' as const,
  collections: [],
  games: [{ folderName: 'Game', relativePath: 'Game', collectionPath: null }],
};
function value<T>(result: OperationResult<T>): T {
  if (!result.ok) assert.fail(result.message);
  return result.value;
}

test('IGDB screenshots are separate, deduplicated, validated and capped at five', () => {
  const details = normalizeIgdbGame({
    id: 1,
    name: 'Game',
    screenshots: [
      null,
      { image_id: '../bad' },
      { image_id: 'shot1', url: 'https://evil.invalid' },
      ...Array.from({ length: 8 }, (_, i) => ({ image_id: `shot${i + 1}` })),
    ],
  });
  assert.deepEqual(
    details.screenshots,
    Array.from({ length: 5 }, (_, i) => ({ url: url(i + 1) }))
  );
  assert.deepEqual(details.artwork, []);
  assert.deepEqual(normalizeIgdbGame({ id: 1, name: 'Game' }).screenshots, []);
  assert.equal(
    normalizeIgdbGame({ id: 1, name: 'Game', screenshots: 'invalid' })
      .screenshots,
    undefined
  );
});

test('v2 catalogs upgrade with empty galleries and enforce binding, limits and cascade deletion', () => {
  const db = new Database(':memory:');
  try {
    db.pragma('foreign_keys = ON');
    applyMigrations(db, migrations.slice(0, 2));
    const repo = new CatalogRepository(db);
    repo.reconcile(scan);
    repo.saveMatch(
      1,
      {
        providerId: 'igdb',
        providerRecordId: '1',
        source: 'manual',
        confidence: null,
      },
      { recordId: '1', title: 'Game', artwork: [] }
    );
    repo.saveManualOverrides(1, { title: 'My title' });
    applyMigrations(db);
    assert.deepEqual(repo.listScreenshots(1), []);
    const items = [{ localPath: 'shot.jpg', remoteUrl: url(1) }];
    repo.replaceScreenshots(1, '1', items);
    repo.reconcile(scan);
    assert.deepEqual(repo.listScreenshots(1), items);
    assert.throws(() =>
      repo.replaceScreenshots(1, '1', Array(6).fill(items[0]))
    );
    assert.throws(() =>
      repo.replaceScreenshots(1, '1', [
        { ...items[0], localPath: '../escape.jpg' },
      ])
    );
    assert.throws(() => repo.replaceScreenshots(1, '2', items));
    assert.deepEqual(repo.listScreenshots(1), items);
    assert.deepEqual(repo.listGames()[0].manualOverrides, {
      title: 'My title',
    });
    repo.saveMatch(
      1,
      {
        providerId: 'igdb',
        providerRecordId: '2',
        source: 'manual',
        confidence: null,
      },
      { recordId: '2', title: 'Other', artwork: [] }
    );
    assert.deepEqual(
      repo.listScreenshots(1),
      [],
      'old match screenshots must never show for another game'
    );
    repo.replaceScreenshots(1, '2', items);
    repo.clearMetadata(1);
    assert.deepEqual(db.prepare('SELECT * FROM screenshots').all(), []);
    repo.saveMatch(
      1,
      {
        providerId: 'igdb',
        providerRecordId: '2',
        source: 'manual',
        confidence: null,
      },
      { recordId: '2', title: 'Other', artwork: [] }
    );
    repo.replaceScreenshots(1, '2', items);
    repo.reconcile({ status: 'complete', collections: [], games: [] });
    repo.deleteMissing();
    assert.deepEqual(db.prepare('SELECT * FROM screenshots').all(), []);
  } finally {
    db.close();
  }
});

test('screenshots cache on matching, survive failures/offline restart, and fetch without replacing manual work', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-screenshots-'));
  await mkdir(join(base, 'Games', 'Game'), { recursive: true });
  let offline = false;
  let brokenImage = '';
  const downloads: string[] = [];
  let details: GameDetails = {
    recordId: '1',
    title: 'Game',
    artwork: [],
    screenshots: Array.from({ length: 7 }, (_, i) => ({ url: url(i + 1) })),
  };
  const provider: MetadataProvider = {
    id: 'igdb',
    capabilities: { artwork: [] },
    async search() {
      return [{ recordId: '1', title: 'Game' }];
    },
    async getGame() {
      if (offline) throw new Error('offline');
      return details;
    },
  };
  const entry = { provider, enabled: true, configured: true };
  const cache = new ArtworkCache(base, async (input) => {
    downloads.push(String(input));
    if (offline || String(input) === brokenImage) throw new Error('offline');
    return new Response(jpeg);
  });
  const config = new ConfigService(base);
  const make = () =>
    new LibraryService(
      base,
      config,
      async () => '',
      undefined,
      async () => ({ providers: [entry], threshold: 0.75, greedyMatch: false }),
      cache
    );
  let service = make();
  t.after(async () => {
    service.close();
    await rm(base, { recursive: true, force: true });
  });
  await service.chooseRoot(async () => join(base, 'Games'));
  const game = value(await service.scan()).games[0];
  assert.equal(downloads.length, 5);
  assert.equal(game.screenshotUrls?.length, 5);
  assert.ok(!JSON.stringify(game).includes('https://'));
  for (const local of game.screenshotUrls!)
    assert.deepEqual(
      await readFile(
        join(base, 'data', 'artwork', new URL(local).pathname.slice(1))
      ),
      Buffer.from(jpeg)
    );
  value(await service.saveOverrides(game.id, { title: 'My title' }));
  value(
    await service.pasteArtwork(
      game.id,
      'cover',
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    )
  );
  downloads.length = 0;
  value(await service.scan());
  const before = value(await service.getCatalog()).games[0];
  assert.equal(
    downloads.length,
    0,
    'normal scans preserve existing bindings and gallery'
  );
  offline = true;
  assert.equal((await service.fetchScreenshots(game.id)).ok, false);
  service.close();
  service = make();
  assert.deepEqual(value(await service.getCatalog()).games[0], before);
  offline = false;
  brokenImage = url(1);
  details = { ...details, screenshots: [{ url: url(1) }, { url: url(9) }] };
  const partial = await service.fetchScreenshots(game.id);
  assert.match(partial.message!, /2 screenshots cached/);
  const refreshed = value(partial).games[0];
  assert.equal(refreshed.screenshotUrls?.length, 2);
  assert.equal(refreshed.metadata.title, 'My title');
  assert.equal(refreshed.coverUrl, before.coverUrl);
  assert.equal(refreshed.providerRecordId, before.providerRecordId);
  entry.enabled = false;
  downloads.length = 0;
  assert.equal((await service.fetchScreenshots(game.id)).ok, false);
  assert.equal(downloads.length, 0);
  entry.enabled = true;
  details = { ...details, screenshots: [] };
  assert.deepEqual(
    value(await service.fetchScreenshots(game.id)).games[0].screenshotUrls,
    []
  );
  assert.equal((await service.fetchScreenshots(-1)).ok, false);
  value(await service.clearMetadata(game.id));
  assert.equal((await service.fetchScreenshots(game.id)).ok, false);
});

test('screenshot cache rejects unapproved origins and invalid image bytes', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-screenshot-cache-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  let calls = 0;
  const cache = new ArtworkCache(base, async () => {
    calls++;
    return new Response('not an image');
  });
  await assert.rejects(
    cache.download(1, {
      kind: 'screenshot',
      url: 'https://evil.invalid/shot.jpg',
    })
  );
  assert.equal(calls, 0);
  await assert.rejects(cache.download(1, { kind: 'screenshot', url: url(1) }));
});

test('bulk missing-metadata fetch preserves bindings and manual work while continuing after provider failures', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-metadata-backfill-'));
  await mkdir(join(base, 'Games', 'Game A'), { recursive: true });
  await mkdir(join(base, 'Games', 'Game B'));
  let failB = false;
  const calls: string[] = [];
  const provider: MetadataProvider = {
    id: 'igdb',
    capabilities: { artwork: [] },
    async search(query) {
      return [{ recordId: query === 'Game A' ? '1' : '2', title: query }];
    },
    async getGame(recordId) {
      calls.push(recordId);
      if (recordId === '2' && failB) throw new Error('offline');
      return {
        recordId,
        title: recordId === '1' ? 'Game A' : 'Game B',
        description: `Provider ${recordId}`,
        artwork: [],
        screenshots: [{ url: url(Number(recordId)) }],
      };
    },
  };
  const entry = { provider, enabled: true, configured: true };
  const config = new ConfigService(base);
  const cache = new ArtworkCache(base, async () => new Response(jpeg));
  const service = new LibraryService(
    base,
    config,
    async () => '',
    undefined,
    async () => ({ providers: [entry], threshold: 0.75, greedyMatch: false }),
    cache
  );
  t.after(async () => {
    service.close();
    await rm(base, { recursive: true, force: true });
  });
  await service.chooseRoot(async () => join(base, 'Games'));
  const matched = value(await service.scan());
  const a = matched.games.find((game) => game.folderName === 'Game A')!;
  value(await service.saveOverrides(a.id, { title: 'My Game A' }));
  value(
    await service.pasteArtwork(
      a.id,
      'cover',
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    )
  );
  const db = new Database(join(base, 'data', 'library.db'));
  db.prepare("UPDATE games SET provider_metadata = '{}' ").run();
  db.close();
  calls.length = 0;
  failB = true;
  const result = await service.fetchMissingMetadata();
  assert.match(
    result.message!,
    /Fetched missing data for 1 of 2 matched games/
  );
  assert.match(result.message!, /1 provider request failed/);
  assert.deepEqual(calls, ['1', '2']);
  const restoredA = value(result).games.find((game) => game.id === a.id)!;
  assert.equal(restoredA.metadata.title, 'My Game A');
  assert.equal(restoredA.metadata.description, 'Provider 1');
  assert.equal(restoredA.bindingSource, 'automatic');
  assert.equal(restoredA.providerId, 'igdb');
  assert.equal(restoredA.providerRecordId, '1');
  assert.equal(restoredA.screenshotUrls?.length, 1);
  assert.match(restoredA.coverUrl!, /manual/);
  entry.enabled = false;
  calls.length = 0;
  const skipped = await service.fetchMissingMetadata();
  assert.match(skipped.message!, /2 skipped because its provider is disabled/);
  assert.deepEqual(calls, []);
});
