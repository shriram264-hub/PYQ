import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examRules, makeRules } from '../src/lib/exam-rules.js';

test('UPSC: +2 right, minus two-thirds wrong, to two decimals', () => {
  const r = examRules('upsc');
  assert.deepEqual(r.options, ['a', 'b', 'c', 'd']);
  assert.equal(r.marks(62, 17), 112.67);
  assert.equal(r.marks(64, 18), 116);
  assert.equal(r.marks(0, 1), -0.67);
  assert.equal(r.max(98), 196);
  assert.equal(r.penalty(52), 34.67);
  assert.equal(r.penalty(0), 0);
});

test('another marking scheme gives other marks', () => {
  const half = makeRules({ options: ['a', 'b', 'c', 'd'], right: 2, wrong: { numerator: 1, denominator: 2 } });
  assert.equal(half.marks(10, 4), 18);
  assert.equal(half.penalty(4), 2);
  assert.equal(half.max(100), 200);
});

test('an exam with no rules is null', () => {
  assert.equal(examRules('nope'), null);
  assert.equal(examRules('constructor'), null);
});
