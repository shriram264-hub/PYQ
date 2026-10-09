import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_KEYS,
  MINUTE,
  abandonAttempt,
  addElapsed,
  attemptName,
  chooseAnswer,
  clearAnswer,
  moveTo,
  newAttempt,
  parseAttempt,
  progressLine,
  remainingMs,
  submitAttempt,
  toggleReview,
} from '../src/lib/tests/attempt.js';

const ID = '11111111-1111-4111-8111-111111111111';
const T0 = '2026-10-09T10:00:00.000Z';
const T1 = '2026-10-09T10:05:00.000Z';
const T2 = '2026-10-09T10:09:00.000Z';
const KEYS = ['upsc-2019-1', 'upsc-2019-2', 'upsc-2019-3'];
const RESULT = { scored: 3, right: 1, wrong: 1, blank: 1, score: 1.33, max: 6 };

const paper = () => newAttempt({ id: ID, kind: 'paper', spec: { year: 2019 }, keys: KEYS, limitMs: 120 * MINUTE, now: T0 });
const customSpec = (o = {}) => ({
  subjects: ['Indian Polity'],
  topics: [['Indian Polity', 'Fundamental Rights and Duties']],
  fromYear: 1995,
  toYear: 2026,
  count: 25,
  minutes: 30,
  skipDone: false,
  onlyReview: false,
  seed: 42,
  ...o,
});
const custom = (o) => newAttempt({ id: ID, kind: 'custom', spec: customSpec(o), keys: KEYS, limitMs: 30 * MINUTE, now: T0 });

test('a new attempt starts at the first question with nothing answered and the full time left', () => {
  assert.deepEqual(paper(), {
    id: ID,
    exam: 'upsc',
    kind: 'paper',
    spec: { year: 2019 },
    keys: KEYS,
    answers: {},
    review: [],
    current: 0,
    limitMs: 120 * MINUTE,
    elapsedMs: 0,
    status: 'in_progress',
    startedAt: T0,
    updatedAt: T0,
    submittedAt: null,
    result: null,
    syncedAt: null,
  });
  assert.equal(remainingMs(paper()), 120 * MINUTE);
});

test('choosing an answer records it and the time; a second choice replaces it', () => {
  const a = chooseAnswer(paper(), KEYS[1], 'c', T1);
  assert.deepEqual(a.answers, { [KEYS[1]]: 'c' });
  assert.equal(a.updatedAt, T1);
  assert.deepEqual(chooseAnswer(a, KEYS[1], 'a', T2).answers, { [KEYS[1]]: 'a' });
});

test('an answer to a question not in the test, an option that is not one, or the same option again changes nothing', () => {
  const a = chooseAnswer(paper(), KEYS[0], 'b', T1);
  assert.equal(chooseAnswer(a, 'upsc-2020-1', 'a', T2), a);
  assert.equal(chooseAnswer(a, KEYS[0], 'e', T2), a);
  assert.equal(chooseAnswer(a, KEYS[0], 'b', T2), a);
});

test('clearing an answer removes it; clearing a blank question changes nothing', () => {
  const a = chooseAnswer(paper(), KEYS[0], 'b', T1);
  const cleared = clearAnswer(a, KEYS[0], T2);
  assert.deepEqual(cleared.answers, {});
  assert.equal(cleared.updatedAt, T2);
  assert.equal(clearAnswer(cleared, KEYS[0], T2), cleared);
});

test('mark for review toggles, independently of the answer', () => {
  const a = toggleReview(chooseAnswer(paper(), KEYS[2], 'd', T1), KEYS[2], T1);
  assert.deepEqual(a.review, [KEYS[2]]);
  assert.deepEqual(a.answers, { [KEYS[2]]: 'd' });
  assert.deepEqual(toggleReview(a, KEYS[2], T2).review, []);
  assert.equal(toggleReview(a, 'upsc-2020-1', T2), a);
});

test('moving is clamped to the test, and moving to where you are changes nothing', () => {
  assert.equal(moveTo(paper(), 2, T1).current, 2);
  assert.equal(moveTo(paper(), 99, T1).current, 2);
  assert.equal(moveTo(paper(), -4, T1).current, 0);
  const a = paper();
  assert.equal(moveTo(a, 0, T1), a);
});

test('time adds up, never past the limit, and nothing is added for zero or less', () => {
  let a = addElapsed(paper(), 1500, T1);
  a = addElapsed(a, 2500, T2);
  assert.equal(a.elapsedMs, 4000);
  assert.equal(a.updatedAt, T2);
  assert.equal(remainingMs(a), 120 * MINUTE - 4000);
  assert.equal(addElapsed(a, 0, T2), a);
  assert.equal(addElapsed(a, -5, T2), a);
  assert.equal(addElapsed(a, 999 * MINUTE, T2).elapsedMs, 120 * MINUTE);
  assert.equal(remainingMs(addElapsed(a, 999 * MINUTE, T2)), 0);
});

test('submitting closes the attempt with its result; a closed attempt takes no more changes', () => {
  const done = submitAttempt(chooseAnswer(paper(), KEYS[0], 'a', T1), RESULT, T2);
  assert.equal(done.status, 'submitted');
  assert.equal(done.submittedAt, T2);
  assert.deepEqual(done.result, RESULT);
  for (const change of [
    (a) => chooseAnswer(a, KEYS[1], 'b', T2),
    (a) => clearAnswer(a, KEYS[0], T2),
    (a) => toggleReview(a, KEYS[0], T2),
    (a) => moveTo(a, 2, T2),
    (a) => addElapsed(a, 1000, T2),
    (a) => submitAttempt(a, RESULT, T2),
    (a) => abandonAttempt(a, T2),
  ]) {
    assert.equal(change(done), done);
  }
});

test('abandoning keeps every answer and cannot then be submitted', () => {
  const left = abandonAttempt(chooseAnswer(paper(), KEYS[0], 'a', T1), T2);
  assert.equal(left.status, 'abandoned');
  assert.deepEqual(left.answers, { [KEYS[0]]: 'a' });
  assert.equal(left.submittedAt, null);
  assert.equal(submitAttempt(left, RESULT, T2), left);
});

test('names: a paper by its year, a set by its one topic, its one subject, or how many subjects', () => {
  assert.equal(attemptName(paper()), 'UPSC Prelims 2019');
  assert.equal(attemptName(custom()), 'Practice: Fundamental Rights and Duties');
  assert.equal(attemptName(custom({ topics: [] })), 'Practice: Indian Polity');
  assert.equal(
    attemptName(custom({ topics: [['Indian Polity', 'A'], ['Indian Polity', 'B']] })),
    'Practice: Indian Polity'
  );
  assert.equal(attemptName(custom({ subjects: ['Indian Polity', 'Geography'] })), 'Practice: 2 subjects');
  assert.equal(attemptName(custom({ subjects: [], topics: [] })), 'Practice: all subjects');
});

test('progress line counts answered questions', () => {
  assert.equal(progressLine(chooseAnswer(paper(), KEYS[0], 'a', T1)), '1 of 3 answered');
});

// --- parseAttempt: storage and the account are not trusted ---

const roundTrip = (a) => parseAttempt(JSON.parse(JSON.stringify(a)));

test('a well-formed attempt survives storage unchanged', () => {
  const a = submitAttempt(toggleReview(chooseAnswer(paper(), KEYS[0], 'a', T1), KEYS[1], T1), RESULT, T2);
  assert.deepEqual(roundTrip(a), a);
  const c = { ...custom(), syncedAt: T0 };
  assert.deepEqual(roundTrip(c), c);
});

test('answers and review marks for questions not in the test, or not an option, are dropped', () => {
  const a = { ...paper(), answers: { [KEYS[0]]: 'a', [KEYS[1]]: 'z', 'upsc-2020-1': 'b', [KEYS[2]]: 3 }, review: [KEYS[0], 'x', KEYS[0]] };
  const parsed = roundTrip(a);
  assert.deepEqual(parsed.answers, { [KEYS[0]]: 'a' });
  assert.deepEqual(parsed.review, [KEYS[0]]);
});

test('the current index and elapsed time are clamped', () => {
  const parsed = roundTrip({ ...paper(), current: 7, elapsedMs: 999 * MINUTE });
  assert.equal(parsed.current, 2);
  assert.equal(parsed.elapsedMs, 120 * MINUTE);
});

test('bad shapes are refused, not trusted', () => {
  const bad = [
    null,
    'x',
    [],
    { ...paper(), id: 'not-a-uuid' },
    { ...paper(), exam: 'UPSC!' },
    { ...paper(), kind: 'quiz' },
    { ...paper(), status: 'paused' },
    { ...paper(), spec: {} },
    { ...paper(), keys: [] },
    { ...paper(), keys: ['upsc-2019-1', 'upsc-2019-1'] },
    { ...paper(), keys: ['not a key'] },
    { ...paper(), keys: Array.from({ length: MAX_KEYS + 1 }, (_, i) => `upsc-2019-${i + 1}`) },
    { ...paper(), limitMs: 1000 },
    { ...paper(), limitMs: 181 * MINUTE },
    { ...paper(), elapsedMs: -1 },
    { ...paper(), startedAt: 'yesterday' },
    { ...paper(), status: 'submitted', submittedAt: T1, result: null },
    { ...paper(), status: 'submitted', submittedAt: null, result: RESULT },
    { ...paper(), status: 'submitted', submittedAt: T1, result: { ...RESULT, max: 7 } },
    { ...custom(), spec: customSpec({ count: 30 }) },
    { ...custom(), spec: customSpec({ minutes: 4 }) },
    { ...custom(), spec: customSpec({ fromYear: 2020, toYear: 2019 }) },
    { ...custom(), spec: customSpec({ seed: -1 }) },
    { ...custom(), spec: customSpec({ skipDone: 'yes' }) },
  ];
  for (const raw of bad) assert.equal(parseAttempt(raw), null, JSON.stringify(raw)?.slice(0, 120));
});

test('a set spec keeps only topics inside its subjects, once each', () => {
  const parsed = roundTrip({
    ...custom(),
    spec: customSpec({ topics: [['Indian Polity', 'X'], ['Geography', 'Y'], ['Indian Polity', 'X']] }),
  });
  assert.deepEqual(parsed.spec.topics, [['Indian Polity', 'X']]);
});

test('an attempt that is not submitted carries no submit time or result', () => {
  const parsed = roundTrip({ ...paper(), submittedAt: T1, result: RESULT });
  assert.equal(parsed.submittedAt, null);
  assert.equal(parsed.result, null);
});
