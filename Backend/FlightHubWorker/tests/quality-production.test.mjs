import test from 'node:test';
import assert from 'node:assert/strict';
import {publicOfferIsFresh} from '../src/core.js';

const now = Date.parse('2026-11-09T15:00:00Z');
test('fresh price must not be expired', () => {
  assert.equal(publicOfferIsFresh({provider: 'centrum', checked_at: '2026-11-09T14:00:00Z', expires_at: '2026-11-09T14:30:00Z'}, now), false);
  assert.equal(publicOfferIsFresh({provider: 'centrum', checked_at: '2026-11-09T14:00:00Z', expires_at: '2026-11-10T14:00:00Z'}, now), true);
});
test('future observation and invalid date cannot be fresh', () => {
  assert.equal(publicOfferIsFresh({provider: 'flynas', checked_at: '2026-11-09T15:10:00Z'}, now), false);
  assert.equal(publicOfferIsFresh({provider: 'ignav', checked_at: 'bogus'}, now), false);
});
test('legacy import never qualifies as verified live fare', () => {
  assert.equal(publicOfferIsFresh({provider: 'legacy_import', checked_at: '2026-11-09T15:00:00Z'}, now), false);
});
