import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNoArgumentRequest } from '../src/main/ipc.ts';

test('accepts the trusted main frame with no payload', () => {
  assert.doesNotThrow(() => validateNoArgumentRequest(true, []));
});
test('rejects other windows or frames', () => {
  assert.throws(() => validateNoArgumentRequest(false, []), /Untrusted/);
});
test('rejects unexpected payloads', () => {
  for (const value of [null, undefined, 'path', {}, 1]) {
    assert.throws(() => validateNoArgumentRequest(true, [value]), /no arguments/);
  }
});
