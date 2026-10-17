import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, chooseAnswer, newAttempt, toggleReview } from '../src/lib/tests/attempt.js';
import { REVIEW_FILTERS, reviewKeys, verdictOf, verdictText } from '../src/lib/tests/review.js';

const KEYS = ['upsc-2019-1', 'upsc-2019-2', 'upsc-2019-3', 'upsc-2019-4', 'upsc-2019-5'];
const OFFICIAL = { 'upsc-2019-1': 'a', 'upsc-2019-2': 'b', 'upsc-2019-3': 'c', 'upsc-2019-4': null, 'upsc-2019-5': 'd' };
const T = '2026-10-09T10:00:00.000Z';
let a = newAttempt({ id: '00000000-0000-4000-8000-000000000001', kind: 'paper', spec: { year: 2019 }, keys: KEYS, limitMs: 120 * MINUTE, now: T });
a = chooseAnswer(a, KEYS[0], 'a', T); // right
a = chooseAnswer(a, KEYS[1], 'c', T); // wrong
a = chooseAnswer(a, KEYS[3], 'b', T); // unscored, answered
a = toggleReview(toggleReview(a, KEYS[1], T), KEYS[4], T);
const officialOf = (k) => OFFICIAL[k];

test('verdicts: right, wrong, blank, and not scored', () => {
  assert.deepEqual(KEYS.map((k) => verdictOf(a, k, officialOf(k))), ['right', 'wrong', 'blank', 'unscored', 'blank']);
});

test('verdict lines say what was chosen and what it scored', () => {
  assert.equal(verdictText('right', 'a', 'a'), 'Your answer: (a). Right, +2.');
  assert.equal(verdictText('wrong', 'c', 'b'), 'Your answer: (c). Wrong, −0.67. The official answer is (b).');
  assert.equal(verdictText('blank', null, 'c'), 'Not answered. The official answer is (c).');
  assert.equal(verdictText('unscored', 'b', null), 'Not scored: UPSC gives no answer for this question. You chose (b).');
  assert.equal(verdictText('unscored', null, null), 'Not scored: UPSC gives no answer for this question.');
});

test('filters pick questions in test order', () => {
  assert.deepEqual(reviewKeys(a, officialOf, 'all'), KEYS);
  assert.deepEqual(reviewKeys(a, officialOf, 'wrong'), [KEYS[1]]);
  assert.deepEqual(reviewKeys(a, officialOf, 'blank'), [KEYS[2], KEYS[4]]);
  assert.deepEqual(reviewKeys(a, officialOf, 'review'), [KEYS[1], KEYS[4]]);
  assert.deepEqual(REVIEW_FILTERS.map((f) => f.id), ['all', 'wrong', 'blank', 'review']);
});
