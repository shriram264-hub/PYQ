import { test } from 'node:test';
import assert from 'node:assert/strict';
import { announcementFor, formatClock, keyAction } from '../src/lib/tests/clock.js';

const MIN = 60000;

test('the countdown reads h:mm:ss, rounded up to the second, never below zero', () => {
  assert.equal(formatClock(120 * MIN), '2:00:00');
  assert.equal(formatClock(3661000), '1:01:01');
  assert.equal(formatClock(59400), '0:01:00');
  assert.equal(formatClock(1), '0:00:01');
  assert.equal(formatClock(0), '0:00:00');
  assert.equal(formatClock(-5000), '0:00:00');
});

test('time is announced as 15, 5 and 1 minutes are crossed, and not otherwise', () => {
  assert.equal(announcementFor(15 * MIN + 500, 15 * MIN - 500), '15 minutes left');
  assert.equal(announcementFor(15 * MIN + 500, 15 * MIN), '15 minutes left');
  assert.equal(announcementFor(5 * MIN + 1, 5 * MIN - 999), '5 minutes left');
  assert.equal(announcementFor(MIN + 400, MIN - 600), '1 minute left');
  assert.equal(announcementFor(14 * MIN, 13 * MIN), null);
  assert.equal(announcementFor(15 * MIN, 14 * MIN), null, 'already at 15 when the clock started');
  assert.equal(announcementFor(16 * MIN, 30 * 1000), '1 minute left', 'the nearest mark when several are crossed');
});

test('keys: A–D and 1–4 choose, arrows move, anything else is not ours', () => {
  assert.deepEqual(keyAction('a'), { choose: 'a' });
  assert.deepEqual(keyAction('D'), { choose: 'd' });
  assert.deepEqual(keyAction('1'), { choose: 'a' });
  assert.deepEqual(keyAction('4'), { choose: 'd' });
  assert.deepEqual(keyAction('ArrowLeft'), { move: -1 });
  assert.deepEqual(keyAction('ArrowRight'), { move: 1 });
  for (const key of ['e', '5', '0', 'Enter', ' ', 'ArrowUp', 'Tab']) assert.equal(keyAction(key), null, key);
});
