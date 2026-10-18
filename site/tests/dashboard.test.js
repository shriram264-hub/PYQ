import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, abandonAttempt, addElapsed, chooseAnswer, newAttempt, submitAttempt } from '../src/lib/tests/attempt.js';
import { formatDate } from '../src/lib/tests/score.js';
import { emptyTests, putAttempt } from '../src/lib/tests/store.js';
import {
  coverageOf,
  figures,
  oldestLine,
  pickPlan,
  practisePath,
  recentTests,
  resumeOf,
  reviewOf,
  scoreText,
  signedText,
  weakestOf,
} from '../src/lib/accounts/dashboard.js';
import { subjectsCovered, subjectsCoveredBy } from '../src/lib/accounts/summary.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute) => new Date(Date.UTC(2026, 9, 9, 10, minute)).toISOString();
const KEYS = ['upsc-2019-1', 'upsc-2019-2', 'upsc-2019-3'];
const paper = (n, { year = 2019, minute = n } = {}) =>
  newAttempt({ id: id(n), kind: 'paper', spec: { year }, keys: KEYS, limitMs: 120 * MINUTE, now: at(minute) });
const testsOf = (...attempts) => attempts.reduce(putAttempt, emptyTests());
const result = (score, max = 6) => ({ scored: max / 2, right: 1, wrong: 0, blank: max / 2 - 1, score, max });

test('resumeOf: the unfinished attempt touched last, with Carry on’s line; none is null', () => {
  assert.equal(resumeOf(emptyTests(), 'upsc'), null);
  const older = chooseAnswer(paper(1, { year: 2018 }), KEYS[0], 'a', at(20));
  const newer = addElapsed(paper(2, { year: 2020 }), 30 * MINUTE + 1500, at(30));
  const done = submitAttempt(paper(3), result(2), at(40));
  const gone = abandonAttempt(paper(4), at(50));
  const r = resumeOf(testsOf(older, newer, done, gone), 'upsc');
  assert.deepEqual(r, { id: id(2), name: 'UPSC Prelims 2020', detail: '0 of 3 answered · 1:29:59 left' });
  // Another exam's attempt is not this page's to resume.
  assert.equal(resumeOf(testsOf({ ...newer, exam: 'ssc' }), 'upsc'), null);
});

test('reviewOf: the count and whole days since the oldest mark; none is null', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  const entries = {
    'upsc-2019-1': { status: 'review', updatedAt: '2026-10-07T13:00:00Z' }, // 11.96 days: 11
    'upsc-2019-2': { status: 'review', updatedAt: '2026-10-18T00:00:00Z' },
    'upsc-2019-3': { status: 'done', updatedAt: '2026-01-01T00:00:00Z' }, // Done is not in the pile
  };
  assert.deepEqual(reviewOf({ entries, lists: {} }, now), { count: 2, days: 11 });
  assert.equal(reviewOf({ entries: { 'upsc-2019-3': entries['upsc-2019-3'] }, lists: {} }, now), null);
  assert.deepEqual(reviewOf({ entries: { k: { status: 'review', updatedAt: '2026-10-19T11:00:00Z' } } }, now), { count: 1, days: 0 });
  // A mark dated after now (another device's clock) is not "-1 days" old.
  assert.deepEqual(reviewOf({ entries: { k: { status: 'review', updatedAt: '2026-10-20T00:00:00Z' } } }, now), { count: 1, days: 0 });
  assert.deepEqual(reviewOf({ entries: { k: { status: 'review', updatedAt: 'not a date' } } }, now), { count: 1, days: null });
});

test('oldestLine', () => {
  assert.equal(oldestLine(null), null);
  assert.equal(oldestLine(0), 'Oldest marked in the last day');
  assert.equal(oldestLine(1), 'Oldest marked 1 day ago');
  assert.equal(oldestLine(12), 'Oldest marked 12 days ago');
});

test('weakestOf and practisePath: the practice form opened on the topic', () => {
  assert.equal(weakestOf(undefined, 'upsc'), null);
  assert.deepEqual(weakestOf({ subject: 'Indian Polity', topic: 'Parliament & Laws', right: 2, answered: 7 }, 'upsc'), {
    topic: 'Parliament & Laws',
    subject: 'Indian Polity',
    line: '2 of 7 right so far',
    href: '/upsc/test?subject=indian-polity&topic=parliament-and-laws#practice',
  });
  assert.equal(practisePath('upsc', 'Geography'), '/upsc/test?subject=geography#practice');
});

test('pickPlan: the cards that apply, the starter only when none do, and one primary', () => {
  const plan = (o) => pickPlan({ resume: null, review: null, tests: 0, marked: false, ...o });
  assert.deepEqual(plan({}), { cards: [], starter: true, hint: true, primary: 'starter' });
  // Done marks only: still the starter, without the line about marking.
  assert.deepEqual(plan({ marked: true }), { cards: [], starter: true, hint: false, primary: 'starter' });
  // Needs review and no tests: nothing above is green, so Practice tests is.
  assert.deepEqual(plan({ review: { count: 2 }, marked: true }), { cards: ['review'], starter: false, hint: false, primary: 'tests' });
  assert.deepEqual(plan({ tests: 3, marked: true }), { cards: ['weak'], starter: false, hint: false, primary: 'analytics' });
  assert.deepEqual(plan({ resume: { id: 'x' }, review: { count: 1 }, tests: 1 }), {
    cards: ['resume', 'review', 'weak'],
    starter: false,
    hint: false,
    primary: 'resume',
  });
  assert.deepEqual(plan({ resume: { id: 'x' } }), { cards: ['resume'], starter: false, hint: false, primary: 'resume' });
});

test('figures: tests taken, accuracy and the latest paper, as the analytics page words them', () => {
  const h = {
    tests: 3,
    papers: 2,
    accuracy: { right: 61, answered: 90 },
    latestPaper: { year: 2024, score: 101.33, max: 200, change: -4.67 },
  };
  assert.deepEqual(figures(h), [
    { label: 'Tests taken', value: '3', max: null, detail: '2 full papers and 1 practice set' },
    { label: 'Accuracy', value: '68%', max: null, detail: '61 right of 90 answered' },
    { label: 'Latest paper', value: '101.33', max: 200, detail: '2024 paper, −4.67 on the paper before' },
  ]);
  const one = figures({ tests: 1, papers: 0, accuracy: { right: 0, answered: 0 }, latestPaper: null });
  assert.deepEqual(one, [
    { label: 'Tests taken', value: '1', max: null, detail: '1 practice set' },
    { label: 'Accuracy', value: 'None', max: null, detail: 'No questions answered yet' },
    { label: 'Latest paper', value: 'None', max: null, detail: 'No full paper yet' },
  ]);
  const paperOnly = (change, score = -3.33) =>
    figures({ tests: 1, papers: 1, accuracy: { right: 1, answered: 3 }, latestPaper: { year: 2019, score, max: 200, change } });
  assert.equal(paperOnly(null)[2].detail, '2019 paper');
  assert.equal(paperOnly(null)[2].value, '−3.33');
  assert.equal(paperOnly(0)[2].detail, '2019 paper, the same score as the paper before');
  assert.equal(paperOnly(2.5)[2].detail, '2019 paper, +2.50 on the paper before');
});

test('scoreText and signedText use a true minus', () => {
  assert.equal(scoreText(-0.67), '−0.67');
  assert.equal(scoreText(12), '12.00');
  assert.equal(signedText(0), '0.00');
  assert.equal(signedText(-1), '−1.00');
});

test('recentTests: this exam’s three newest submissions, each with its date and score', () => {
  const sub = (n, minute, score) => submitAttempt(paper(n, { year: 2010 + n }), result(score), at(minute));
  const tests = testsOf(sub(1, 10, 2), sub(2, 50, -0.67), sub(3, 30, 4), sub(4, 40, 6), paper(5), { ...sub(6, 59, 1), exam: 'ssc' });
  const recent = recentTests(tests, 'upsc');
  assert.deepEqual(
    recent.map((r) => [r.id, r.name, r.score, r.max]),
    [
      [id(2), 'UPSC Prelims 2012', '−0.67', 6],
      [id(4), 'UPSC Prelims 2014', '6.00', 6],
      [id(3), 'UPSC Prelims 2013', '4.00', 6],
    ]
  );
  assert.equal(recent[0].date, formatDate(at(50)));
  assert.deepEqual(recentTests(emptyTests(), 'upsc'), []);
});

test('coverageOf: covered subjects by share, then count, then name; the rest counted', () => {
  const by = new Map([
    ['Geography', { answered: 0, right: 0, covered: 10, total: 100 }],
    ['Art', { answered: 0, right: 0, covered: 5, total: 20 }],
    ['Economy', { answered: 3, right: 1, covered: 20, total: 200 }],
    ['Ecology', { answered: 0, right: 0, covered: 2, total: 20 }],
    ['History', { answered: 0, right: 0, covered: 0, total: 300 }],
    ['Science', { answered: 0, right: 0, covered: 0, total: 150 }],
  ]);
  assert.deepEqual(coverageOf(by), {
    rows: [
      { subject: 'Art', covered: 5, total: 20 },
      { subject: 'Economy', covered: 20, total: 200 },
      { subject: 'Geography', covered: 10, total: 100 },
      { subject: 'Ecology', covered: 2, total: 20 },
    ],
    more: 2,
  });
  assert.deepEqual(coverageOf(new Map()), { rows: [], more: 0 });
});

test('subjectsCoveredBy reads subjects from a function, and subjectsCovered still agrees', () => {
  const subjects = { 'upsc-2019-1': 'Polity', 'upsc-2019-2': 'Polity', 'upsc-2019-3': 'Economy', 'upsc-2019-4': 'Geography' };
  const subjectOf = (k) => (Object.hasOwn(subjects, k) ? subjects[k] : null);
  const keys = ['upsc-2019-1', 'upsc-2019-2', 'upsc-2019-3', 'upsc-2019-4', 'upsc-1900-1'];
  assert.deepEqual(subjectsCoveredBy(keys, subjectOf), { top: ['Polity', 'Economy'], more: 1 });
  assert.deepEqual(subjectsCoveredBy([], subjectOf), { top: [], more: 0 });
  const index = Object.fromEntries(Object.entries(subjects).map(([k, s]) => [k, ['/upsc/question/x', s, 't']]));
  assert.deepEqual(subjectsCovered(keys, index), subjectsCoveredBy(keys, subjectOf));
});
