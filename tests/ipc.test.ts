import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateNoArgumentRequest, validateGameIdRequest } from '../src/main/ipc.ts';

test('accepts the trusted main frame with no payload', () => {
  assert.doesNotThrow(() => validateNoArgumentRequest(true, []));
});

test('folder IPC accepts only one positive integer ID from the trusted frame', () => {
  assert.equal(validateGameIdRequest(true, [7]), 7);
  assert.throws(() => validateGameIdRequest(false, [7]), /Untrusted/);
  for (const args of [[], [1, 2], ['1'], ['E:\\Games'], [null], [0], [-1], [1.5], [NaN], [Infinity], [Number.MAX_SAFE_INTEGER + 1]]) {
    assert.throws(() => validateGameIdRequest(true, args), /game ID/);
  }
});
test('rejects other windows or frames', () => {
  assert.throws(() => validateNoArgumentRequest(false, []), /Untrusted/);
});
test('rejects unexpected payloads', () => {
  for (const value of [null, undefined, 'path', {}, 1]) {
    assert.throws(() => validateNoArgumentRequest(true, [value]), /no arguments/);
  }
});
