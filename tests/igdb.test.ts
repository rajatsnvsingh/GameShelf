import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  IgdbProvider,
  IgdbError,
  normalizeIgdbGame,
} from '../src/main/metadata/igdb.ts';
import { resolveMetadata } from '../src/main/metadata/resolver.ts';
import { ConfigService } from '../src/main/config/service.ts';
import { configuredProviders } from '../src/main/metadata/service.ts';

const settings = {
  enabled: true,
  clientId: 'fixture-client',
  clientSecret: 'fixture-secret',
};
const token = {
  access_token: 'fixturetoken',
  token_type: 'bearer',
  expires_in: 3600,
};
const game = { id: 1, name: 'Game A', first_release_date: 946684800 };
function json(
  value: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(value), { status, headers });
}
function fixture(responses: (Response | Error)[]) {
  let now = 0;
  const calls: { url: string; init: RequestInit; at: number }[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    calls.push({ url: String(input), init: init!, at: now });
    const next = responses.shift();
    if (!next) throw new Error('Unexpected request');
    if (next instanceof Error) throw next;
    return next;
  };
  const provider = new IgdbProvider(settings, {
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  return {
    provider,
    calls,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const code = (expected: string) => (error: unknown) =>
  error instanceof IgdbError && error.code === expected;

test('IGDB obtains a token in a POST body, reuses it and normalizes search/details', async () => {
  const f = fixture([
    json(token),
    json([
      {
        ...game,
        cover: { image_id: 'searchcover' },
        platforms: [{ name: 'PC (Microsoft Windows)' }],
      },
    ]),
    json([
      {
        ...game,
        summary: 'Summary',
        total_rating: 88,
        genres: [{ name: 'Adventure' }],
        platforms: [{ name: 'PC (Microsoft Windows)' }],
        involved_companies: [
          { developer: true, publisher: true, company: { name: 'Studio' } },
        ],
        cover: { image_id: 'cover123' },
        artworks: [{ image_id: 'art123' }],
      },
    ]),
  ]);
  assert.deepEqual(await f.provider.search('Game A'), [
    {
      recordId: '1',
      title: 'Game A',
      releaseYear: 2000,
      platforms: ['PC (Microsoft Windows)'],
      hasArtwork: true,
    },
  ]);
  const details = await f.provider.getGame('1');
  assert.deepEqual(details, {
    recordId: '1',
    title: 'Game A',
    releaseYear: 2000,
    hasArtwork: true,
    description: 'Summary',
    rating: 88,
    developers: ['Studio'],
    publishers: ['Studio'],
    genres: ['Adventure'],
    platforms: ['PC (Microsoft Windows)'],
    screenshots: [],
    artwork: [
      {
        kind: 'cover',
        url: 'https://images.igdb.com/igdb/image/upload/t_cover_big/cover123.jpg',
      },
      {
        kind: 'background',
        url: 'https://images.igdb.com/igdb/image/upload/t_1080p/art123.jpg',
      },
    ],
  });
  assert.equal(f.calls.length, 3);
  assert.equal(f.calls[0].url, 'https://id.twitch.tv/oauth2/token');
  assert.equal(
    new URLSearchParams(String(f.calls[0].init.body)).get('client_secret'),
    settings.clientSecret
  );
  assert.equal(
    (f.calls[1].init.headers as Record<string, string>).Authorization,
    'Bearer fixturetoken'
  );
  for (const call of f.calls) {
    assert.equal(call.init.redirect, 'error');
    assert.ok(!call.url.includes(settings.clientSecret));
  }
  assert.ok(f.calls[1].at - f.calls[0].at >= 300);
  assert.ok(f.calls[2].at - f.calls[1].at >= 300);
});

test('IGDB omits unavailable/invalid optional metadata and never trusts remote image URLs', () => {
  assert.deepEqual(
    normalizeIgdbGame({
      ...game,
      total_rating: 200,
      cover: { image_id: '../escape', url: 'https://bad.invalid' },
    }),
    {
      recordId: '1',
      title: 'Game A',
      releaseYear: 2000,
      artwork: [],
      screenshots: [],
    }
  );
  assert.ok(!('releaseDate' in normalizeIgdbGame(game)));
  assert.deepEqual(normalizeIgdbGame({ id: 2, name: 'Undated' }), {
    recordId: '2',
    title: 'Undated',
    artwork: [],
    screenshots: [],
  });
});

test('IGDB escapes search strings and rejects unsafe IDs/control characters before networking', async () => {
  const f = fixture([json(token), json([])]);
  await f.provider.search('Game "A" \\ Edition');
  assert.equal(
    f.calls[1].init.body,
    'search "Game \\"A\\" \\\\ Edition"; fields name,first_release_date,cover.image_id,platforms.name; limit 50;'
  );
  for (const id of [
    '0',
    '-1',
    '1; fields *;',
    '../1',
    '9007199254740992',
    '01',
  ])
    await assert.rejects(f.provider.getGame(id), code('invalid-record-id'));
  for (const query of ['', 'a\nb', 'x'.repeat(251)])
    await assert.rejects(f.provider.search(query), code('invalid-query'));
  assert.equal(f.calls.length, 2);
});

test('IGDB disabled and unconfigured adapters never request tokens', async () => {
  for (const config of [
    { ...settings, enabled: false },
    { ...settings, clientSecret: '' },
  ]) {
    let calls = 0;
    const provider = new IgdbProvider(config, {
      fetch: async () => {
        calls++;
        throw new Error();
      },
    });
    await assert.rejects(
      provider.search('Game A'),
      code(config.enabled ? 'unconfigured' : 'disabled')
    );
    assert.equal(calls, 0);
  }
});

test('IGDB refreshes expired tokens and retries a rejected token only once', async () => {
  const f = fixture([
    json(token),
    json([game]),
    json(token),
    json([game]),
    json({}, 401),
    json(token),
    json({}, 401),
  ]);
  await f.provider.search('Game A');
  f.advance(3600_000);
  await f.provider.search('Game A');
  await assert.rejects(f.provider.getGame('1'), code('unauthorized'));
  assert.equal(f.calls.filter((call) => call.url.includes('oauth2')).length, 3);
  assert.equal(f.calls.length, 7);
});

test('IGDB can recover after one expired-token rejection', async () => {
  const f = fixture([
    json(token),
    json({}, 401),
    json({ ...token, access_token: 'replacement' }),
    json([game]),
  ]);
  assert.equal((await f.provider.search('Game A'))[0].recordId, '1');
  assert.equal(
    (f.calls[3].init.headers as Record<string, string>).Authorization,
    'Bearer replacement'
  );
});

test('IGDB rate limits impose cooldown without unbounded retry or waiting', async () => {
  const f = fixture([
    json(token),
    json({}, 429, { 'retry-after': '5' }),
    json([game]),
  ]);
  await assert.rejects(f.provider.search('Game A'), code('rate-limited'));
  await assert.rejects(f.provider.search('Game A'), code('rate-limited'));
  assert.equal(f.calls.length, 2);
  f.advance(5000);
  assert.equal((await f.provider.search('Game A')).length, 1);
});

test('IGDB request errors, authentication failures and malformed responses expose only safe codes', async () => {
  for (const [response, expected] of [
    [new Error('fixture-secret https://bad.invalid'), 'request-failed'],
    [json({ secret: 'fixture-secret' }, 403), 'forbidden'],
    [json({}, 500), 'http-error'],
    [new Response('not-json'), 'invalid-response'],
    [json({ access_token: 'leaked' }), 'invalid-token-response'],
  ] as const) {
    const f = fixture([response]);
    await assert.rejects(f.provider.search('Game A'), (error) => {
      assert.ok(error instanceof IgdbError);
      assert.equal(error.code, expected);
      assert.ok(!String(error).includes('fixture-secret'));
      return true;
    });
  }
});

test('IGDB returns its bounded first search page while invalid records and mismatched details never become matches', async () => {
  const full = fixture([
    json(token),
    json(
      Array.from({ length: 50 }, (_, index) => ({ ...game, id: index + 1 }))
    ),
  ]);
  assert.equal((await full.provider.search('Game A')).length, 50);
  const invalid = fixture([json(token), json([{ id: '1', name: 'Game A' }])]);
  await assert.rejects(
    invalid.provider.search('Game A'),
    code('invalid-response')
  );
  const mismatch = fixture([json(token), json([{ ...game, id: 2 }])]);
  await assert.rejects(
    mismatch.provider.getGame('1'),
    code('invalid-response')
  );
  const missing = fixture([json(token), json([])]);
  assert.equal(await missing.provider.getGame('1'), null);
});

test('IGDB cancels oversized response bodies', async () => {
  const f = fixture([new Response('x'.repeat(2 * 1024 * 1024 + 1))]);
  await assert.rejects(f.provider.search('Game A'), code('response-too-large'));
});

test('IGDB aborts a stalled request and refuses overlapping operations', async () => {
  let calls = 0;
  const provider = new IgdbProvider(settings, {
    timeoutMs: 20,
    sleep: async () => {},
    fetch: async (_url, init) => {
      calls++;
      return new Promise((_resolve, reject) =>
        init!.signal!.addEventListener(
          'abort',
          () => reject(new Error('secret')),
          { once: true }
        )
      );
    },
  });
  const first = provider.search('Game A');
  await assert.rejects(provider.search('Game B'), code('busy'));
  await assert.rejects(first, code('timeout'));
  assert.equal(calls, 1);
});

test('IGDB integrates with the resolver while failures remain unresolved and existing bindings are preserved', async () => {
  const f = fixture([json(token), json([game]), json([game])]);
  const entry = { provider: f.provider, enabled: true, configured: true };
  assert.equal((await resolveMetadata('Game A', [entry])).status, 'matched');
  const binding = {
    providerId: 'igdb',
    providerRecordId: '1',
    source: 'manual' as const,
    confidence: null,
  };
  assert.deepEqual(await resolveMetadata('New name', [entry], { binding }), {
    status: 'preserved',
    binding,
  });
  assert.equal(f.calls.length, 3);
  const failed = fixture([new Error('offline')]);
  assert.deepEqual(
    await resolveMetadata('Game A', [{ ...entry, provider: failed.provider }]),
    {
      status: 'unresolved',
      attempts: [{ providerId: 'igdb', outcome: 'error' }],
    }
  );
});

test('INI credentials stay main-only, provider selection is explicit, invalid provider flags do not break local setup', async () => {
  const base = await mkdtemp(join(tmpdir(), 'gameshelf-igdb-'));
  try {
    const config = new ConfigService(base);
    assert.ok(
      (await configuredProviders(config)).providers.every(
        (entry) => !entry.enabled && !entry.configured
      )
    );
    const content =
      '[metadata]\nproviderOrder="igdb"\n[provider.igdb]\nenabled="true"\nclientId="fixture-client"\nclientSecret="fixture-secret"\n';
    await writeFile(join(base, 'config.ini'), content);
    const configured = await configuredProviders(config);
    assert.equal(configured.providers.length, 1);
    assert.equal(configured.providers[0].configured, true);
    assert.equal(configured.providers[0].enabled, true);
    assert.ok(
      !JSON.stringify(await config.getState()).includes('fixture-secret')
    );
    assert.equal(await readFile(join(base, 'config.ini'), 'utf8'), content);
    await writeFile(
      join(base, 'config.ini'),
      content.replace('enabled="true"', 'enabled="invalid"')
    );
    assert.equal((await config.getMetadataSettings()).igdb.enabled, false);
    assert.equal((await config.getState()).status, 'unconfigured');
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
