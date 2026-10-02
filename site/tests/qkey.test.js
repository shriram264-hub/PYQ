import { test } from 'node:test';
import assert from 'node:assert/strict';
import { questionKey } from '../src/lib/accounts/qkey.js';
import { ALL_QUESTIONS } from '../src/lib/corpus.js';

test('formats exam-year-number', () => {
  assert.equal(questionKey('upsc', 2019, 7), 'upsc-2019-7');
});

test('every corpus question has a key, and keys are unique', () => {
  const keys = ALL_QUESTIONS.map((q) => q.qkey);
  assert.ok(keys.every((k) => /^upsc-\d{4}-\d{1,3}$/.test(k)));
  assert.equal(new Set(keys).size, keys.length);
});
