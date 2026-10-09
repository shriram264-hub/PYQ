import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, chooseAnswer, newAttempt, submitAttempt } from '../src/lib/tests/attempt.js';
import {
  MAX_ATTEMPTS,
  TESTS_KEY,
  emptyTests,
  finished,
  getAttempt,
  inProgressPaper,
  latestLine,
  loadTests,
  parseTests,
  pruneAttempts,
  putAttempt,
  saveTests,
  unfinished,
} from '../src/lib/tests/store.js';
import { formatDate } from '../src/lib/tests/score.js';

const KEYS = ['upsc-2019-1', 'upsc-2019-2'];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute) => new Date(Date.UTC(2026, 9, 9, 10, minute)).toISOString();
const make = (n, { year = 2019, minute = n } = {}) =>
  newAttempt({ id: id(n), kind: 'paper', spec: { year }, keys: KEYS, limitMs: 120 * MINUTE, now: at(minute) });
const RESULT = { scored: 2, right: 1, wrong: 0, blank: 1, score: 2, max: 4 };

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

test('nothing stored, or garbage stored, reads as no attempts', () => {
  for (const raw of [null, '', 'nope', '[]', '{"attempts":[]}', '{"attempts":null}']) {
    assert.deepEqual(parseTests(raw), emptyTests(), String(raw));
  }
});

test('a stored attempt filed under another id, or malformed, is dropped; good ones stay', () => {
  const good = make(1);
  const raw = JSON.stringify({ attempts: { [good.id]: good, [id(9)]: make(2), [id(3)]: { nope: true } } });
  assert.deepEqual(parseTests(raw), { attempts: { [good.id]: good } });
});

test('save then load gives the same attempts', () => {
  const storage = memoryStorage();
  const tests = putAttempt(putAttempt(emptyTests(), make(1)), make(2));
  assert.equal(saveTests(tests, storage), true);
  assert.ok(storage.map.has(TESTS_KEY));
  assert.deepEqual(loadTests(storage), tests);
});

test('storage that refuses: save says false, load reads empty, neither throws', () => {
  const refusing = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(saveTests(putAttempt(emptyTests(), make(1)), refusing), false);
  assert.deepEqual(loadTests(refusing), emptyTests());
});

test('the device keeps the 200 most recently updated attempts', () => {
  let tests = emptyTests();
  for (let n = 1; n <= MAX_ATTEMPTS + 5; n += 1) tests = putAttempt(tests, make(n));
  const kept = pruneAttempts(tests.attempts);
  assert.equal(Object.keys(kept).length, MAX_ATTEMPTS);
  for (let n = 1; n <= 5; n += 1) assert.ok(!(id(n) in kept), `oldest ${n} dropped`);
  const storage = memoryStorage();
  saveTests(tests, storage);
  assert.equal(Object.keys(loadTests(storage).attempts).length, MAX_ATTEMPTS);
});

test('unfinished newest first; finished newest submitted first; abandoned in neither', () => {
  const a = make(1);
  const b = make(2);
  const c = submitAttempt(make(3), RESULT, at(30));
  const d = submitAttempt(make(4), RESULT, at(20));
  const e = { ...make(5), status: 'abandoned' };
  const tests = [a, b, c, d, e].reduce(putAttempt, emptyTests());
  assert.deepEqual(unfinished(tests).map((x) => x.id), [b.id, a.id]);
  assert.deepEqual(finished(tests).map((x) => x.id), [c.id, d.id]);
});

test('the unfinished attempt of a paper is found by year', () => {
  const tests = [make(1, { year: 2018 }), make(2, { year: 2019 }), submitAttempt(make(3, { year: 2020 }), RESULT, at(9))].reduce(
    putAttempt,
    emptyTests()
  );
  assert.equal(inProgressPaper(tests, 2019).id, id(2));
  assert.equal(inProgressPaper(tests, 2020), null);
});

test('getAttempt reads own entries only', () => {
  const tests = putAttempt(emptyTests(), make(1));
  assert.equal(getAttempt(tests, id(1)).id, id(1));
  assert.equal(getAttempt(tests, 'constructor'), null);
});

test('the /account line: the latest result, or that there is none', () => {
  assert.equal(latestLine(emptyTests()), 'No tests taken yet.');
  const done = submitAttempt(chooseAnswer(make(1), KEYS[0], 'a', at(2)), RESULT, at(40));
  assert.equal(latestLine(putAttempt(emptyTests(), done)), `Latest: UPSC Prelims 2019, 2.00 / 4, on ${formatDate(at(40))}.`);
});
