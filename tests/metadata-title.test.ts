import assert from 'node:assert/strict';
import test from 'node:test';
import { metadataTitle } from '../src/main/metadata/title.ts';

test('metadata titles omit supported archive extensions while preserving other names', () => {
  assert.equal(metadataTitle('Tekken 3.iso'), 'Tekken 3');
  assert.equal(metadataTitle('Prototype.exe'), 'Prototype');
  assert.equal(metadataTitle('Collection.RAR'), 'Collection');
  assert.equal(metadataTitle('Root.ZIP'), 'Root');
  assert.equal(metadataTitle('Game.7z'), 'Game.7z');
  assert.equal(metadataTitle('Folder Game'), 'Folder Game');
});
