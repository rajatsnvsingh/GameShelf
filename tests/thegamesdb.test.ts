import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  TheGamesDbProvider,
  TheGamesDbError,
} from '../src/main/metadata/thegamesdb.ts';
import { ConfigService } from '../src/main/config/service.ts';
import {
  configuredProviders,
  providerSession,
} from '../src/main/metadata/service.ts';
import { LibraryService } from '../src/main/library/service.ts';
import type { OperationResult } from '../src/shared/api.ts';

const game = {
  id: 7,
  game_title: 'Game A',
  release_date: '2000-01-01',
  overview: 'Fixture overview',
};
const json = (
  value: unknown,
  status = 200,
  headers: Record<string, string> = {}
) => new Response(JSON.stringify(value), { status, headers });
const result = (games: unknown[], next: string | null = null) => ({
  code: 200,
  data: { count: games.length, games },
  pages: { next },
});
const errorCode = (code: string) => (error: unknown) =>
  error instanceof TheGamesDbError && error.code === code;
const value = <T>(result: OperationResult<T>): T => {
  if (!result.ok) assert.fail(result.message);
  return result.value;
};

function fixture(responses: (Response | Error)[]) {
  let now = 0;
  const calls: { url: URL; init: RequestInit; at: number }[] = [];
  const provider = new TheGamesDbProvider(
    { enabled: true, apiKey: 'fixture-key &+#' },
    {
      now: () => now,
      sleep: async (ms) => {
        now += ms;
      },
      fetch: async (url, init) => {
        calls.push({ url: new URL(String(url)), init: init!, at: now });
        const response = responses.shift();
        if (!response || response instanceof Error)
          throw response ?? new Error('Unexpected request');
        return response;
      },
    }
  );
  return {
    provider,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

test('TheGamesDB encodes key/query and normalizes details with cached company/genre names', async () => {
  const detail = {
    ...game,
    developers: [1],
    publishers: [2],
    genres: [3],
    rating: 'E - Everyone',
  };
  const f = fixture([
    json(result([game])),
    json(result([detail])),
    json({
      code: 200,
      data: { developers: { '1': { id: 1, name: 'Studio' } } },
    }),
    json({
      code: 200,
      data: { publishers: { '2': { id: 2, name: 'Publisher' } } },
    }),
    json({
      code: 200,
      data: { genres: { '3': { id: 3, name: 'Adventure' } } },
    }),
    json(result([detail])),
  ]);
  assert.deepEqual(await f.provider.search('Game A & 日本語'), [
    { recordId: '7', title: 'Game A', releaseYear: 2000 },
  ]);
  const details = await f.provider.getGame('7');
  assert.deepEqual(details, {
    recordId: '7',
    title: 'Game A',
    releaseYear: 2000,
    description: 'Fixture overview',
    developers: ['Studio'],
    publishers: ['Publisher'],
    genres: ['Adventure'],
    artwork: [],
  });
  assert.deepEqual(await f.provider.getGame('7'), details);
  assert.equal(f.calls.length, 6);
  assert.equal(f.calls[0].url.pathname, '/v1.1/Games/ByGameName');
  assert.equal(f.calls[0].url.searchParams.get('name'), 'Game A & 日本語');
  for (const call of f.calls) {
    assert.equal(call.url.origin, 'https://api.thegamesdb.net');
    assert.equal(call.url.searchParams.get('apikey'), 'fixture-key &+#');
    assert.equal(call.init.redirect, 'error');
    assert.equal(call.init.method, 'GET');
  }
  assert.ok(
    f.calls.slice(1).every((call, index) => call.at - f.calls[index].at >= 300)
  );
});

test('TheGamesDB omits missing values, returns empty search/null details, and validates inputs', async () => {
  const f = fixture([
    json(result([])),
    json(result([])),
    json(
      result([{ id: 7, game_title: 'Undated', release_date: '0000-00-00' }])
    ),
  ]);
  assert.deepEqual(await f.provider.search('Absent'), []);
  assert.equal(await f.provider.getGame('7'), null);
  assert.deepEqual(await f.provider.getGame('7'), {
    recordId: '7',
    title: 'Undated',
    artwork: [],
  });
  for (const id of ['0', '01', '../7', '7&apikey=other', '9007199254740992'])
    await assert.rejects(
      f.provider.getGame(id),
      errorCode('invalid-record-id')
    );
  for (const query of ['', 'a\nb', 'x'.repeat(251)])
    await assert.rejects(f.provider.search(query), errorCode('invalid-query'));
  assert.equal(f.calls.length, 3);
});

test('TheGamesDB skips paginated searches and rejects malformed results without following response URLs', async () => {
  const broad = fixture([
    json(result([game], 'https://untrusted.invalid/?apikey=fixture-key')),
  ]);
  assert.deepEqual(await broad.provider.search('Game A'), []);
  assert.equal(broad.calls.length, 1);
  for (const body of [
    { code: 200, data: { count: 2, games: [game] }, pages: { next: null } },
    { code: 200, data: { count: 1, games: [game] } },
    result([{ id: '7', game_title: 'Game A' }]),
  ]) {
    const f = fixture([json(body)]);
    await assert.rejects(
      f.provider.search('Game A'),
      (error) => error instanceof TheGamesDbError
    );
    assert.equal(f.calls.length, 1);
  }
  const mismatch = fixture([json(result([{ ...game, id: 8 }]))]);
  await assert.rejects(
    mismatch.provider.getGame('7'),
    errorCode('invalid-response')
  );
});

test('TheGamesDB failures expose no key, URL, response body or transport error', async () => {
  for (const response of [
    json({ message: 'fixture-key' }, 403),
    new Error('https://api.thegamesdb.net?apikey=fixture-key'),
    new Response('fixture-key'),
    json({ code: 403, status: 'fixture-key' }),
    json({}, 500),
  ]) {
    const f = fixture([response]);
    await assert.rejects(f.provider.search('Game A'), (error) => {
      assert.ok(error instanceof TheGamesDbError);
      assert.ok(!String(error).includes('fixture-key'));
      assert.ok(!String(error).includes('https://'));
      return true;
    });
  }
});

test('TheGamesDB respects rate-limit and allowance cooldown without automatic retries', async () => {
  const f = fixture([
    json({}, 429, { 'retry-after': '5' }),
    json(result([game])),
  ]);
  await assert.rejects(f.provider.search('Game A'), errorCode('rate-limited'));
  await assert.rejects(f.provider.search('Game A'), errorCode('rate-limited'));
  assert.equal(f.calls.length, 1);
  f.advance(5000);
  assert.equal((await f.provider.search('Game A')).length, 1);
  const quota = fixture([
    json({
      ...result([game]),
      remaining_monthly_allowance: 0,
      extra_allowance: 0,
      allowance_refresh_timer: 60,
    }),
  ]);
  await quota.provider.search('Game A');
  await assert.rejects(quota.provider.getGame('7'), errorCode('rate-limited'));
  assert.equal(quota.calls.length, 1);
});

test('TheGamesDB rejects disabled/unconfigured calls and oversized responses', async () => {
  for (const settings of [
    { enabled: false, apiKey: 'fixture-key' },
    { enabled: true, apiKey: '' },
  ]) {
    let calls = 0;
    const provider = new TheGamesDbProvider(settings, {
      fetch: async () => {
        calls++;
        throw new Error();
      },
    });
    await assert.rejects(
      provider.search('Game A'),
      errorCode(settings.enabled ? 'unconfigured' : 'disabled')
    );
    assert.equal(calls, 0);
  }
  const f = fixture([new Response('x'.repeat(2 * 1024 * 1024 + 1))]);
  await assert.rejects(
    f.provider.search('Game A'),
    errorCode('response-too-large')
  );
});

test('TheGamesDB times out stalled requests and rejects overlapping work', async () => {
  const provider = new TheGamesDbProvider(
    { enabled: true, apiKey: 'fixture-key' },
    {
      timeoutMs: 20,
      sleep: async () => {},
      fetch: async (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            'abort',
            () => reject(new Error('fixture-key')),
            { once: true }
          );
        }),
    }
  );
  const first = provider.search('Game A');
  await assert.rejects(provider.search('Game B'), errorCode('busy'));
  await assert.rejects(first, errorCode('timeout'));
});

async function libraryFixture(
  t: { after: (fn: () => Promise<void>) => void },
  igdbFailure = false
) {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-priority-'));
  await mkdir(join(base, 'Games', 'Game A'), { recursive: true });
  const config = new ConfigService(base);
  await config.chooseRoot(async () => join(base, 'Games'));
  const ini =
    (await readFile(join(base, 'config.ini'), 'utf8')) +
    '\n[provider.igdb]\nenabled="true"\nclientId="fixture-client"\nclientSecret="fixture-secret"\n[provider.thegamesdb]\nenabled="true"\napiKey="fixture-key"\n';
  await writeFile(join(base, 'config.ini'), ini);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    const target = new URL(String(url));
    calls.push(target.hostname);
    if (target.hostname === 'id.twitch.tv') {
      if (igdbFailure) throw new Error('fixture-secret');
      return json({
        access_token: 'fixturetoken',
        expires_in: 3600,
        token_type: 'bearer',
      });
    }
    if (target.hostname === 'api.igdb.com')
      return json([{ id: 1, name: 'Game A', summary: 'IGDB description' }]);
    if (target.hostname === 'api.thegamesdb.net') return json(result([game]));
    throw new Error('Unexpected request');
  };
  const service = new LibraryService(base, config, async () => '');
  t.after(async () => {
    service.close();
    globalThis.fetch = originalFetch;
    await rm(base, { recursive: true, force: true });
  });
  return { base, config, service, calls, ini };
}

test('configured order selects first match and preserves manual binding after reordering/rescanning', async (t) => {
  const f = await libraryFixture(t);
  const scanned = value(await f.service.scan());
  assert.equal(scanned.games[0].providerId, 'igdb');
  assert.ok(!f.calls.includes('api.thegamesdb.net'));
  const id = scanned.games[0].id;
  const candidates = value(
    await f.service.searchMatches(id, 'Game A')
  ).candidates;
  assert.deepEqual(
    candidates.map((candidate) => candidate.providerId),
    ['igdb']
  );
  const alternateCandidates = value(
    await f.service.searchMatches(id, 'Game A', 'thegamesdb')
  ).candidates;
  assert.deepEqual(
    alternateCandidates.map((candidate) => candidate.providerId),
    ['thegamesdb']
  );
  const manual = value(await f.service.selectMatch(id, 'thegamesdb', '7'))
    .games[0];
  assert.equal(manual.bindingSource, 'manual');
  assert.equal(manual.providerId, 'thegamesdb');
  await writeFile(
    join(f.base, 'config.ini'),
    f.ini.replace('igdb,thegamesdb', 'thegamesdb,igdb')
  );
  f.calls.length = 0;
  value(await f.service.autoMatch(id));
  assert.equal(value(await f.service.scan()).games[0].providerId, 'thegamesdb');
  assert.deepEqual(f.calls, []);
});

test('actual adapter failure falls through to TheGamesDB and persists usable local metadata', async (t) => {
  const f = await libraryFixture(t, true);
  const scanned = value(await f.service.scan());
  assert.equal(scanned.games[0].providerId, 'thegamesdb');
  assert.equal(scanned.games[0].metadata.description, 'Fixture overview');
  assert.ok(!scanned.games[0].missing);
  assert.deepEqual(f.calls, [
    'id.twitch.tv',
    'api.thegamesdb.net',
    'api.thegamesdb.net',
  ]);
});

test('reversed order, duplicate/unknown IDs and misconfigured first provider are independent', async (t) => {
  const f = await libraryFixture(t);
  await writeFile(
    join(f.base, 'config.ini'),
    f.ini.replace('igdb,thegamesdb', 'thegamesdb,igdb,thegamesdb,unknown')
  );
  assert.deepEqual(
    (await configuredProviders(f.config)).providers.map(
      (entry) => entry.provider.id
    ),
    ['thegamesdb', 'igdb', 'steamgriddb']
  );
  assert.equal(value(await f.service.scan()).games[0].providerId, 'thegamesdb');
  assert.ok(!f.calls.includes('id.twitch.tv'));
  await writeFile(
    join(f.base, 'config.ini'),
    f.ini.replace('enabled="true"', 'enabled="invalid"')
  );
  const providers = (await configuredProviders(f.config)).providers;
  assert.equal(providers[0].enabled, false);
  assert.equal(providers[1].enabled, true);
  assert.equal((await f.config.getState()).status, 'ready');
  const load = providerSession(f.config);
  assert.equal(
    (await load()).providers[1].provider,
    (await load()).providers[1].provider
  );
  await writeFile(
    join(f.base, 'config.ini'),
    f.ini.replace('igdb,thegamesdb', 'thegamesdb')
  );
  assert.deepEqual(
    (await load()).providers.map((entry) => entry.provider.id),
    ['thegamesdb', 'steamgriddb']
  );
});
