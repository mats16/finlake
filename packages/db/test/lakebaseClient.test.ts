import assert from 'node:assert/strict';
import test from 'node:test';
import { timestampStringOrNullForPg } from '../src/LakebaseClient.js';

test('timestampStringOrNullForPg converts empty and invalid values to null', () => {
  assert.equal(timestampStringOrNullForPg(null), null);
  assert.equal(timestampStringOrNullForPg(''), null);
  assert.equal(timestampStringOrNullForPg('not-a-date'), null);
});

test('timestampStringOrNullForPg normalizes ISO datetimes', () => {
  assert.equal(timestampStringOrNullForPg('2026-05-19T02:27:40.410Z'), '2026-05-19T02:27:40.410Z');
});
