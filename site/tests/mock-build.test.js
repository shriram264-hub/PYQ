import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAG } from '../src/lib/tests/catalogue.js';
import { defaultMinutes, drawSet, mulberry32, newSeed, paperInfo, paperKeys, paperNotes, setPool } from '../src/lib/tests/build.js';
import { questionsForYear } from '../src/lib/corpus.js';

const full = (year, qNo, status = 'ok', answer = 'a') => ({
  year,
  q_no: qNo,
  subject: 'Geography',
  subtopic: 'Rivers',
  difficulty: 'easy',
  question: `Q${qNo}`,
  a: 'A',
  b: 'B',
  c: 'C',
  d: 'D',
  answer,
  answer_note: '',
  status,
});

test('a paper is every question of its year but the cancelled ones, in question-number order', () => {
  const file = {
    'upsc-2020-3': full(2020, 3),
    'upsc-2020-1': full(2020, 1),
    'upsc-2020-2': full(2020, 2, 'cancelled', ''),
    'upsc-2020-10': full(2020, 10, 'disputed', ''),
    'upsc-2019-4': full(2019, 4), // filed in the wrong year's file
    'upsc-2020-7': { nope: true }, // malformed
  };
  assert.deepEqual(paperKeys(2020, file), ['upsc-2020-1', 'upsc-2020-3', 'upsc-2020-10']);
});

test('paper notes say what is missing and what UPSC cancelled', () => {
  assert.deepEqual(paperNotes({ present: 98, highest: 100, missing: 2, cancelled: 0 }), ["98 of 100 questions: 2 aren't in our copy"]);
  assert.deepEqual(paperNotes({ present: 99, highest: 100, missing: 1, cancelled: 1 }), [
    "99 of 100 questions: 1 isn't in our copy",
    '1 question cancelled by UPSC is left out',
  ]);
  assert.deepEqual(paperNotes({ present: 100, highest: 100, missing: 0, cancelled: 2 }), ['2 questions cancelled by UPSC are left out']);
  assert.deepEqual(paperNotes({ present: 100, highest: 100, missing: 0, cancelled: 0 }), []);
});

test('paper info from the real corpus: 1995 lacks 3 numbers, 2020 had 2 cancelled', () => {
  const y1995 = paperInfo(1995, questionsForYear(1995));
  assert.deepEqual(y1995, { year: 1995, present: 147, highest: 150, missing: 3, cancelled: 0, questions: 147 });
  assert.deepEqual(paperNotes(y1995), ["147 of 150 questions: 3 aren't in our copy"]);
  const y2020 = paperInfo(2020, questionsForYear(2020));
  assert.deepEqual(y2020, { year: 2020, present: 100, highest: 100, missing: 0, cancelled: 2, questions: 98 });
});

// A small catalogue, as parseCatalogue returns it.
const entry = (key, subject, topic, flag = FLAG.ok) => ({ key, subject, topic, year: Number(key.split('-')[1]), flag });
const CATALOGUE = {
  subjects: ['Geography', 'Indian Polity'],
  topics: [],
  entries: [
    entry('upsc-2001-1', 'Indian Polity', 'Parliament'),
    entry('upsc-2001-2', 'Geography', 'Rivers'),
    entry('upsc-2010-5', 'Indian Polity', 'Fundamental Rights'),
    entry('upsc-2015-9', 'Indian Polity', 'Parliament', FLAG.cancelled),
    entry('upsc-2016-3', 'Indian Polity', 'Parliament', FLAG.unanswered),
    entry('upsc-2018-7', 'Indian Polity', 'Parliament', FLAG.disputed),
    entry('upsc-2020-2', 'Geography', 'Rivers'),
  ],
};
const spec = (o = {}) => ({ subjects: [], topics: [], fromYear: 1995, toYear: 2026, count: 10, minutes: 12, skipDone: false, onlyReview: false, seed: 1, ...o });
const mark = (status) => ({ status, updatedAt: '2026-10-01T00:00:00.000Z', synced: false });

test('the pool: every scorable question, nothing cancelled or without an answer', () => {
  assert.deepEqual(setPool(spec(), CATALOGUE, {}), ['upsc-2001-1', 'upsc-2001-2', 'upsc-2010-5', 'upsc-2018-7', 'upsc-2020-2']);
});

test('the pool follows subjects, topics within a subject, and years', () => {
  assert.deepEqual(setPool(spec({ subjects: ['Geography'] }), CATALOGUE, {}), ['upsc-2001-2', 'upsc-2020-2']);
  assert.deepEqual(
    setPool(spec({ subjects: ['Indian Polity', 'Geography'], topics: [['Indian Polity', 'Parliament']] }), CATALOGUE, {}),
    ['upsc-2001-1', 'upsc-2001-2', 'upsc-2018-7', 'upsc-2020-2']
  );
  assert.deepEqual(setPool(spec({ fromYear: 2005, toYear: 2018 }), CATALOGUE, {}), ['upsc-2010-5', 'upsc-2018-7']);
});

test('the switches: skip Done, or only Needs review (filters still apply)', () => {
  const marks = { 'upsc-2001-1': mark('done'), 'upsc-2010-5': mark('review'), 'upsc-2020-2': mark('review') };
  assert.deepEqual(setPool(spec({ skipDone: true }), CATALOGUE, marks), ['upsc-2001-2', 'upsc-2010-5', 'upsc-2018-7', 'upsc-2020-2']);
  assert.deepEqual(setPool(spec({ onlyReview: true }), CATALOGUE, marks), ['upsc-2010-5', 'upsc-2020-2']);
  assert.deepEqual(setPool(spec({ onlyReview: true, subjects: ['Geography'] }), CATALOGUE, marks), ['upsc-2020-2']);
});

test('the draw: no repeats, the requested count, all of a small pool, and the same seed gives the same set', () => {
  const pool = Array.from({ length: 300 }, (_, i) => `upsc-2019-${i + 1}`);
  const a = drawSet(pool, 25, 12345);
  assert.equal(a.length, 25);
  assert.equal(new Set(a).size, 25);
  assert.ok(a.every((k) => pool.includes(k)));
  assert.deepEqual(drawSet(pool, 25, 12345), a);
  assert.notDeepEqual(drawSet(pool, 25, 54321), a);
  assert.deepEqual(new Set(drawSet(pool.slice(0, 7), 25, 1)), new Set(pool.slice(0, 7)));
  assert.deepEqual(drawSet([], 10, 1), []);
  assert.deepEqual(pool.length, 300, 'the pool itself is not shuffled');
  assert.equal(pool[0], 'upsc-2019-1');
});

test('the generator is deterministic and stays in [0, 1)', () => {
  const r1 = mulberry32(7);
  const r2 = mulberry32(7);
  for (let i = 0; i < 1000; i += 1) {
    const x = r1();
    assert.equal(x, r2());
    assert.ok(x >= 0 && x < 1);
  }
  const seed = newSeed();
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
});

test('default time is 1.2 minutes a question, rounded up, between 5 and 180', () => {
  assert.deepEqual([10, 25, 50, 100, 3, 12, 150, 1000].map(defaultMinutes), [12, 30, 60, 120, 5, 15, 180, 180]);
});
