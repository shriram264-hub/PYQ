import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isQuestionKey, questionKey } from '../src/lib/accounts/qkey.js';
import { ALL_QUESTIONS } from '../src/lib/corpus.js';

test('formats exam-year-number', () => {
  assert.equal(questionKey('upsc', 2019, 7), 'upsc-2019-7');
});

test('every corpus question has a key, and keys are unique', () => {
  const keys = ALL_QUESTIONS.map((q) => q.qkey);
  assert.ok(keys.every((k) => /^upsc-\d{4}-\d{1,3}$/.test(k)));
  assert.equal(new Set(keys).size, keys.length);
});

test('isQuestionKey accepts exactly the shape the account accepts', () => {
  for (const key of ['upsc-2019-7', 'upsc-1995-100', 'ssc-2024-999']) assert.equal(isQuestionKey(key), true, key);
  const refused = ['upsc-2019-1000', 'UPSC-2019-7', 'upsc-19-7', 'upsc-2019-', 'upsc2-2019-7', ' upsc-2019-7', 'upsc-2019-7\n', 'a', '', null, 7, undefined, {}];
  for (const key of refused) assert.equal(isQuestionKey(key), false, JSON.stringify(key));
});

test('every corpus key is one the account accepts', () => {
  assert.ok(ALL_QUESTIONS.every((q) => isQuestionKey(q.qkey)));
});
