import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanLibrary, type DirectoryEntry, type ListDirectory } from '../src/main/library/scanner.ts';

const input = { root: 'E:\\Games 日本語', collectionPrefix: 'Collection_' };
const directory = (name: string): DirectoryEntry => ({ name, kind: 'directory' });
const file = (name: string): DirectoryEntry => ({ name, kind: 'file' });

function listing(tree: Record<string, readonly DirectoryEntry[]>) {
  const calls: string[] = [];
  const list: ListDirectory = async (root, relative) => {
    assert.equal(root, input.root);
    calls.push(relative);
    if (!Object.hasOwn(tree, relative)) throw new Error('Unexpected directory visit');
    return tree[relative];
  };
  return { list, calls };
}

test('discovers root games and collection members with literal names and full relative paths', async () => {
  const { list, calls } = listing({
    '': [directory('Z Game [Edition]'), directory('Collection_Favorites'), directory('A Game')],
    Collection_Favorites: [directory('日本語 Game'), directory('A Game')]
  });
  assert.deepEqual(await scanLibrary(input, list), {
    status: 'complete',
    games: [
      { folderName: 'A Game', relativePath: 'A Game', collectionPath: null },
      { folderName: 'A Game', relativePath: 'Collection_Favorites/A Game', collectionPath: 'Collection_Favorites' },
      { folderName: '日本語 Game', relativePath: 'Collection_Favorites/日本語 Game', collectionPath: 'Collection_Favorites' },
      { folderName: 'Z Game [Edition]', relativePath: 'Z Game [Edition]', collectionPath: null }
    ],
    collections: [{ folderName: 'Collection_Favorites', displayName: 'Favorites', relativePath: 'Collection_Favorites' }]
  });
  assert.deepEqual(calls, ['', 'Collection_Favorites']);
});

test('empty library succeeds; empty game folders count without being listed', async () => {
  assert.deepEqual(await scanLibrary(input, listing({ '': [] }).list), { status: 'complete', games: [], collections: [] });
  const { list, calls } = listing({ '': [directory('Empty Game')] });
  const result = await scanLibrary(input, list);
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') assert.equal(result.games.length, 1);
  assert.deepEqual(calls, ['']);
});

test('empty collections remain collections, including a prefix-only folder', async () => {
  const result = await scanLibrary(input, listing({
    '': [directory('Collection_Empty'), directory('Collection_')],
    Collection_Empty: [], Collection_: []
  }).list);
  assert.deepEqual(result, {
    status: 'complete', games: [], collections: [
      { folderName: 'Collection_', displayName: '', relativePath: 'Collection_' },
      { folderName: 'Collection_Empty', displayName: 'Empty', relativePath: 'Collection_Empty' }
    ]
  });
});

test('loose files never imply games or collections', async () => {
  const { list, calls } = listing({
    '': [file('setup.exe'), file('Collection_File'), file('Game.iso'), directory('Collection_Files')],
    Collection_Files: [file('setup.exe'), file('Game.zip')]
  });
  const result = await scanLibrary(input, list);
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') assert.deepEqual(result.games, []);
  assert.deepEqual(calls, ['', 'Collection_Files']);
});

test('never visits game contents or treats collection members as nested collections', async () => {
  const { list, calls } = listing({
    '': [directory('Game'), directory('Collection_Outer')],
    Collection_Outer: [directory('Collection_Inner'), directory('Member')]
    // No listings exist for any game, including Collection_Inner.
  });
  const result = await scanLibrary(input, list);
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') {
    assert.equal(result.collections.length, 1);
    assert.deepEqual(result.games.map(game => game.relativePath), ['Collection_Outer/Collection_Inner', 'Collection_Outer/Member', 'Game']);
  }
  assert.deepEqual(calls, ['', 'Collection_Outer']);
});

test('skips links/junctions and special entries at both levels without following targets', async () => {
  const { list, calls } = listing({
    '': [{ name: 'Collection_Link', kind: 'link' }, { name: 'Game Link', kind: 'link' },
      { name: 'Special', kind: 'other' }, directory('Collection_Real')],
    Collection_Real: [{ name: 'Outside Root', kind: 'link' }, { name: 'Special', kind: 'other' }]
  });
  const result = await scanLibrary(input, list);
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') assert.deepEqual(result.games, []);
  assert.deepEqual(calls, ['', 'Collection_Real']);
});

test('custom prefix is matched exactly and only at the root', async () => {
  const { list, calls } = listing({
    '': [directory('Set_One'), directory('set_lowercase'), directory('Collection_Default')],
    Set_One: [directory('Set_Child')]
  });
  const result = await scanLibrary({ ...input, collectionPrefix: 'Set_' }, list);
  assert.equal(result.status, 'complete');
  if (result.status === 'complete') {
    assert.deepEqual(result.collections.map(collection => collection.displayName), ['One']);
    assert.equal(result.games.length, 3);
  }
  assert.deepEqual(calls, ['', 'Set_One']);
});

test('listing order does not affect output or collection visit order; inputs are not mutated', async () => {
  const tree = {
    '': Object.freeze([directory('z'), directory('Collection_Z'), directory('A'), directory('Collection_A')]),
    Collection_Z: Object.freeze([directory('z'), directory('A')]),
    Collection_A: Object.freeze([directory('日本語'), directory('a')])
  };
  const forward = listing(tree);
  const reversed = listing(Object.fromEntries(Object.entries(tree).map(([key, entries]) => [key, [...entries].reverse()])));
  assert.deepEqual(await scanLibrary(input, forward.list), await scanLibrary(input, reversed.list));
  assert.deepEqual(forward.calls, ['', 'Collection_A', 'Collection_Z']);
  assert.deepEqual(reversed.calls, forward.calls);
});

test('root listing failure is distinguishable from an empty library and hides raw errors', async () => {
  assert.deepEqual(await scanLibrary(input, async () => { throw new Error('sensitive filesystem detail'); }), {
    status: 'failed', error: { code: 'listing-failed', relativePath: '' }
  });
});

test('collection failure discards earlier discoveries and stops further listing', async () => {
  const calls: string[] = [];
  const result = await scanLibrary(input, async (_root, relative) => {
    calls.push(relative);
    if (!relative) return [directory('A Game'), directory('Collection_Z'), directory('Collection_B'), directory('Collection_A')];
    if (relative === 'Collection_A') return [directory('Found')];
    throw new Error('unreadable collection');
  });
  assert.deepEqual(result, { status: 'failed', error: { code: 'listing-failed', relativePath: 'Collection_B' } });
  assert.deepEqual(calls, ['', 'Collection_A', 'Collection_B']);
  assert.equal('games' in result, false);
  assert.equal('collections' in result, false);
});

test('unsafe adapter names fail without visiting paths outside the scan grammar', async () => {
  for (const name of ['', '.', '..', '../escape', 'Collection_../escape', 'nested\\child', 'E:escape', 'nul\0name']) {
    const { list, calls } = listing({ '': [directory(name)] });
    assert.deepEqual(await scanLibrary(input, list), { status: 'failed', error: { code: 'invalid-entry', relativePath: '' } });
    assert.deepEqual(calls, ['']);
  }
  assert.deepEqual(await scanLibrary(input, listing({
    '': [directory('Collection_A')], Collection_A: [directory('../escape')]
  }).list), { status: 'failed', error: { code: 'invalid-entry', relativePath: 'Collection_A' } });
});

test('duplicate Windows names fail rather than producing ambiguous identities', async () => {
  for (const entries of [[directory('Game'), directory('Game')], [directory('Game'), directory('game')]]) {
    assert.deepEqual(await scanLibrary(input, listing({ '': entries }).list), {
      status: 'failed', error: { code: 'invalid-entry', relativePath: '' }
    });
  }
});

test('invalid root or prefix fails before calling the adapter', async () => {
  let called = false;
  const list: ListDirectory = async () => { called = true; return []; };
  for (const invalid of [
    { ...input, root: '' }, { ...input, root: 'relative' },
    { ...input, collectionPrefix: '' }, { ...input, collectionPrefix: '../' }
  ]) {
    assert.deepEqual(await scanLibrary(invalid, list), { status: 'failed', error: { code: 'invalid-input', relativePath: '' } });
  }
  assert.equal(called, false);
});
