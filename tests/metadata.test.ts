import assert from 'node:assert/strict';
import test from 'node:test';
import type { GameDetails, MetadataProvider, ProviderBinding, ProviderEntry, SearchCandidate } from '../src/main/metadata/provider.ts';
import { resolveMetadata, titleConfidence } from '../src/main/metadata/resolver.ts';

function fake(id = 'fixture', candidates: readonly SearchCandidate[] = [{ recordId: '1', title: 'Game A' }]) {
  const calls: string[] = [];
  const provider: MetadataProvider = {
    id, capabilities: { artwork: ['cover', 'background'] },
    async search(query) { calls.push(`search:${query}`); return candidates; },
    async getGame(recordId) {
      calls.push(`detail:${recordId}`);
      const candidate = candidates.find(item => item.recordId === recordId);
      return candidate ? { ...candidate, artwork: [] } : null;
    }
  };
  const entry: ProviderEntry = { provider, enabled: true, configured: true };
  return { provider, entry, calls };
}

test('confidence preserves editions, punctuation and sequels; only case, whitespace and Unicode composition normalize', () => {
  assert.equal(titleConfidence('  GAME   A ', 'Game A'), 1);
  assert.equal(titleConfidence('Cafe\u0301 日本語', 'Café 日本語'), 1);
  for (const title of ['Game A 2', 'Game A Deluxe', 'Game-A', 'A Game']) {
    assert.ok(titleConfidence('Game A', title) < 0.90);
  }
  assert.equal(titleConfidence('', ''), 0);
  assert.equal(titleConfidence('Game A', 'Unrelated'), 0);
});

test('selects highest confidence independent of provider result order and fetches only its details', async () => {
  for (const candidates of [
    [{ recordId: '2', title: 'Game A Deluxe' }, { recordId: '1', title: 'Game A' }],
    [{ recordId: '1', title: 'Game A' }, { recordId: '2', title: 'Game A Deluxe' }]
  ]) {
    const f = fake('fixture', candidates);
    const result = await resolveMetadata('Game A', [f.entry]);
    assert.equal(result.status, 'matched');
    if (result.status !== 'matched') assert.fail();
    assert.deepEqual(result.binding, { providerId: 'fixture', providerRecordId: '1', source: 'automatic', confidence: 1 });
    assert.deepEqual(f.calls, ['search:Game A', 'detail:1']);
  }
});

test('equal exact titles use the provider-ranked first record', async () => {
  const f = fake('fixture', [{ recordId: 'old', title: 'Game A', releaseYear: 1999 }, { recordId: 'new', title: 'Game A', releaseYear: 2024 }]);
  const result = await resolveMetadata('Game A', [f.entry]);
  assert.equal(result.status, 'matched');
  if (result.status !== 'matched') assert.fail();
  assert.equal(result.binding.providerRecordId, 'old');
  assert.deepEqual(f.calls, ['search:Game A', 'detail:old']);
});

test('threshold is configurable and a close runner-up blocks matching even below threshold', async () => {
  const one = fake('fixture', [{ recordId: '1', title: 'Game A Deluxe' }]);
  assert.equal((await resolveMetadata('Game A', [one.entry])).status, 'matched');
  assert.equal((await resolveMetadata('Game A', [one.entry], { threshold: 0.9 })).status, 'unresolved');
  assert.equal((await resolveMetadata('Game A', [one.entry], { threshold: 0.8 })).status, 'matched');
  const close = fake('fixture', [{ recordId: '1', title: 'Game A Deluxe' }, { recordId: '2', title: 'Game A Deluxe Edition' }]);
  const result = await resolveMetadata('Game A', [close.entry], { threshold: 0.8 });
  // 0.80 versus 0.667 is separated enough; two 0.80 candidates are not.
  assert.equal(result.status, 'matched');
  const near = fake('fixture', [{ recordId: '1', title: 'One Two Three Four Extra' }, { recordId: '2', title: 'One Two Three Four Extra Edition' }]);
  assert.deepEqual((await resolveMetadata('One Two Three Four', [near.entry], { threshold: 0.88 })),
    { status: 'unresolved', attempts: [{ providerId: 'fixture', outcome: 'ambiguous' }] });
});

test('greedy matching accepts the first provider-ranked result without threshold or ambiguity checks', async () => {
  const f = fake('fixture', [{ recordId: 'first', title: 'Unrelated' }, { recordId: 'exact', title: 'Game A' }]);
  const result = await resolveMetadata('Game A', [f.entry], { greedyMatch: true });
  assert.equal(result.status, 'matched');
  if (result.status !== 'matched') assert.fail();
  assert.equal(result.binding.providerRecordId, 'first');
  assert.equal(result.binding.confidence, 0);
  assert.deepEqual(f.calls, ['search:Game A', 'detail:first']);
});

test('zero confidence never matches even with a zero threshold; blank input makes no requests', async () => {
  const f = fake();
  assert.equal((await resolveMetadata('Unrelated', [f.entry], { threshold: 0 })).status, 'unresolved');
  f.calls.length = 0;
  assert.deepEqual(await resolveMetadata('  ', [f.entry]), { status: 'unresolved', attempts: [] });
  assert.deepEqual(f.calls, []);
});

test('disabled and unconfigured providers are never called; no providers is valid', async () => {
  const disabled = fake('disabled');
  const unconfigured = fake('unconfigured');
  disabled.entry.enabled = false;
  unconfigured.entry.configured = false;
  assert.deepEqual(await resolveMetadata('Game A', [disabled.entry, unconfigured.entry]), {
    status: 'unresolved', attempts: [{ providerId: 'disabled', outcome: 'disabled' }, { providerId: 'unconfigured', outcome: 'unconfigured' }]
  });
  assert.deepEqual([...disabled.calls, ...unconfigured.calls], []);
  assert.deepEqual(await resolveMetadata('Game A', []), { status: 'unresolved', attempts: [] });
});

test('uses supplied priority and stops after the provider-ranked exact match', async () => {
  const empty = fake('empty', []);
  const ambiguous = fake('ambiguous', [{ recordId: '1', title: 'Game A' }, { recordId: '2', title: 'Game A' }]);
  const chosen = fake('chosen');
  const later = fake('later');
  const result = await resolveMetadata('Game A', [empty.entry, ambiguous.entry, chosen.entry, later.entry]);
  if (result.status !== 'matched') assert.fail();
  assert.equal(result.binding.providerId, 'ambiguous');
  assert.deepEqual(result.attempts.map(attempt => attempt.outcome), ['no-results', 'matched']);
  assert.deepEqual(chosen.calls, []);
  assert.deepEqual(later.calls, []);
});

test('search and detail errors stay distinct from no match and hide raw exception secrets', async () => {
  for (const method of ['search', 'getGame'] as const) {
    const broken = fake('broken');
    broken.provider[method] = async () => { throw new Error('fixture-secret-in-request-url'); };
    const fallback = fake('fallback');
    const result = await resolveMetadata('Game A', [broken.entry, fallback.entry]);
    assert.equal(result.status, 'matched');
    assert.ok('attempts' in result);
    assert.equal(result.attempts[0].outcome, 'error');
    assert.ok(!JSON.stringify(result).includes('fixture-secret'));
    const failed = await resolveMetadata('Game A', [broken.entry]);
    assert.deepEqual(failed, { status: 'unresolved', attempts: [{ providerId: 'broken', outcome: 'error' }] });
  }
});

test('missing details and mismatched detail IDs/titles do not bind', async () => {
  for (const details of [null, { recordId: 'wrong', title: 'Game A', artwork: [] }, { recordId: '1', title: 'Game A 2', artwork: [] }]) {
    const f = fake();
    f.provider.getGame = async () => details;
    const result = await resolveMetadata('Game A', [f.entry]);
    assert.equal(result.status, 'unresolved');
    assert.ok('attempts' in result);
    assert.equal(result.attempts[0].outcome, details === null ? 'not-found' : 'error');
  }
});

test('duplicate records are deduplicated while conflicting duplicates fail safely', async () => {
  const duplicate = { recordId: '1', title: 'Game A' };
  const f = fake('fixture', [duplicate, duplicate]);
  assert.equal((await resolveMetadata('Game A', [f.entry, f.entry])).status, 'matched');
  assert.deepEqual(f.calls, ['search:Game A', 'detail:1']);
  const conflict = fake('fixture', [duplicate, { recordId: '1', title: 'Other' }]);
  assert.deepEqual(await resolveMetadata('Game A', [conflict.entry]), { status: 'unresolved', attempts: [{ providerId: 'fixture', outcome: 'error' }] });
});

test('malformed normalized search responses fail without fetching details', async () => {
  for (const invalid of [null, [{ title: 'Game A' }], [{ recordId: '', title: 'Game A' }], [null]]) {
    const f = fake();
    f.provider.search = async () => invalid as unknown as SearchCandidate[];
    assert.deepEqual(await resolveMetadata('Game A', [f.entry]), { status: 'unresolved', attempts: [{ providerId: 'fixture', outcome: 'error' }] });
    assert.deepEqual(f.calls, []);
  }
});

test('manual and automatic bindings survive changed priorities, names, disabled providers, and offline operation', async () => {
  for (const source of ['manual', 'automatic'] as const) {
    const binding: ProviderBinding = Object.freeze({ providerId: 'original', providerRecordId: 'fixed-id', source, confidence: source === 'manual' ? null : 1 });
    const manualOverrides = Object.freeze({ title: 'My title', description: null, cover: 'custom.png' });
    const state = { binding, manualOverrides };
    const before = structuredClone(state);
    const competing = fake('competing');
    assert.deepEqual(await resolveMetadata('Different folder name', [competing.entry], { binding }), { status: 'preserved', binding });
    assert.deepEqual(await resolveMetadata('Game A', [], { binding }), { status: 'preserved', binding });
    assert.deepEqual(competing.calls, []);
    assert.deepEqual(state, before);
  }
});

test('normalized detail/artwork data stays in the proposal with missing fields omitted', async () => {
  const f = fake();
  const details: GameDetails = { recordId: '1', title: 'Game A', description: 'Fixture description',
    developers: ['Fixture studio'], rating: 85, artwork: [{ kind: 'cover', url: 'https://fixture.invalid/cover.jpg' }] };
  f.provider.getGame = async () => details;
  const result = await resolveMetadata('Game A', [f.entry]);
  if (result.status !== 'matched') assert.fail();
  assert.deepEqual(result.details, details);
  assert.ok(!('releaseDate' in result.details));
  // No downloader, filesystem, catalog writer, or renderer bridge participates in resolution.
});

test('invalid thresholds fail before providers are invoked', async () => {
  const f = fake();
  for (const threshold of [-1, 1.1, NaN, Infinity]) {
    await assert.rejects(resolveMetadata('Game A', [f.entry], { threshold }), /Invalid matching threshold/);
  }
  assert.deepEqual(f.calls, []);
});
