import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accuracy,
  bySubject,
  formatDate,
  formatDuration,
  formatScore,
  marks,
  officialAnswer,
  resultLine,
  scoreAttempt,
} from '../src/lib/tests/score.js';
import { canStartTest } from '../src/lib/tests/access.js';

test('marks: +2 right, minus two-thirds wrong, to two decimals', () => {
  assert.equal(marks(62, 17), 112.67);
  assert.equal(marks(64, 18), 116);
  assert.equal(marks(0, 1), -0.67);
  assert.equal(marks(0, 2), -1.33);
  assert.equal(marks(0, 3), -2);
  assert.equal(marks(0, 0), 0);
  assert.equal(marks(100, 0), 200);
});

test('only an option is an official answer, and a cancelled question has none', () => {
  assert.equal(officialAnswer({ answer: 'b', status: 'ok' }), 'b');
  assert.equal(officialAnswer({ answer: 'c', status: 'disputed' }), 'c');
  assert.equal(officialAnswer({ answer: '', status: 'disputed' }), null);
  assert.equal(officialAnswer({ answer: 'a', status: 'cancelled' }), null);
  assert.equal(officialAnswer({ answer: 'e', status: 'ok' }), null);
  assert.equal(officialAnswer(null), null);
});

test('scoring counts right, wrong and blank among scored questions only', () => {
  const official = { k1: 'a', k2: 'b', k3: 'c', k4: null, k5: 'd' };
  const r = scoreAttempt(['k1', 'k2', 'k3', 'k4', 'k5'], { k1: 'a', k2: 'c', k4: 'a' }, (k) => official[k]);
  assert.deepEqual(r, { scored: 4, right: 1, wrong: 1, blank: 2, score: 1.33, max: 8 });
});

test('a test with nothing scorable scores 0 out of 0', () => {
  assert.deepEqual(scoreAttempt(['k1'], { k1: 'a' }, () => null), { scored: 0, right: 0, wrong: 0, blank: 0, score: 0, max: 0 });
});

test('formatting: score to two decimals, accuracy of answered, durations in hours and minutes', () => {
  assert.equal(formatScore(112.67), '112.67');
  assert.equal(formatScore(116), '116.00');
  assert.equal(formatScore(-0.67), '-0.67');
  assert.equal(accuracy({ right: 3, wrong: 1 }), 0.75);
  assert.equal(accuracy({ right: 0, wrong: 0 }), null);
  assert.equal(formatDuration(108 * 60000 + 59000), '1 h 48 m');
  assert.equal(formatDuration(120 * 60000), '2 h 0 m');
  assert.equal(formatDuration(12 * 60000), '12 m');
  assert.equal(formatDuration(59000), '0 m');
});

test('the result line reads as the spec shows it', () => {
  const r = { scored: 100, right: 62, wrong: 17, blank: 21, score: 112.67, max: 200 };
  assert.equal(resultLine(r, 108 * 60000), 'Score 112.67 / 200 · 62 right · 17 wrong · 21 not answered · 1 h 48 m');
});

test('dates read as day, short month, year', () => {
  assert.equal(formatDate('2026-10-09T12:00:00.000Z'), new Date('2026-10-09T12:00:00.000Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }));
});

test('by subject: right, wrong and blank per subject, A to Z, scored questions only', () => {
  const entries = {
    k1: { subject: 'Indian Polity', answer: 'a', status: 'ok' },
    k2: { subject: 'Geography', answer: 'b', status: 'ok' },
    k3: { subject: 'Indian Polity', answer: 'c', status: 'ok' },
    k4: { subject: 'Geography', answer: '', status: 'disputed' },
    k5: { subject: 'Art & Culture', answer: 'd', status: 'ok' },
  };
  const rows = bySubject(['k1', 'k2', 'k3', 'k4', 'k5', 'gone'], { k1: 'a', k2: 'a', k4: 'b' }, (k) => entries[k] ?? null);
  assert.deepEqual(rows, [
    { subject: 'Art & Culture', right: 0, wrong: 0, blank: 1 },
    { subject: 'Geography', right: 0, wrong: 1, blank: 0 },
    { subject: 'Indian Polity', right: 1, wrong: 0, blank: 1 },
  ]);
});

test('during the beta anyone can start a test', async () => {
  assert.equal(await canStartTest('upsc'), true);
});
