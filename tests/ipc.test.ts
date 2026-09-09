import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAppInfoRequest } from '../src/main/ipc.ts';

test('accepts the trusted main frame with no payload', () => {
  assert.doesNotThrow(() => validateAppInfoRequest(true, []));
});
test('rejects other windows or frames', () => {
  assert.throws(() => validateAppInfoRequest(false, []), /Untrusted/);
});
test('rejects unexpected payloads', () => {
  for (const value of [null, undefined, 'path', {}, 1]) {
    assert.throws(() => validateAppInfoRequest(true, [value]), /no arguments/);
  }
});
