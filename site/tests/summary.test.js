import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  describe,
  indexPath,
  indexPathsFor,
  parseKey,
  pendingForKeys,
  pendingPaths,
  reviewOldestFirst,
  serialOf,
  subjectsCovered,
  summarise,
} from '../src/lib/accounts/summary.js';

const entry = (status, updatedAt = '2026-01-01T00:00:00.000Z') => ({ status, updatedAt, synced: false });
const list = (name, keys = []) => ({ name, keys, remoteId: null, syncedKeys: [] });
const state = (entries = {}, lists = {}) => ({ entries, pending: [], lists });
// [path, subject, title], as pages/upsc/index/[year].json.js writes it.
const q = (n, subject, title = `Question ${n}`) => [`/upsc/question/2019-q${n}-x`, subject, title];

const INDEX = {
  'upsc-2019-7': q(7, 'Indian Polity', 'Which one of the following is not a Harappan site?'),
  'upsc-2019-8': q(8, 'Indian Polity'),
  'upsc-2018-3': q(3, 'Ancient History'),
  'upsc-2018-4': q(4, 'Geography'),
};

// --- Keys and which index file holds them. ---

test('parseKey reads exam, year and number from a key this site made', () => {
  assert.deepEqual(parseKey('upsc-2019-7'), { exam: 'upsc', year: 2019, number: 7 });
  assert.deepEqual(parseKey('upsc-1995-100'), { exam: 'upsc', year: 1995, number: 100 });
});

test('parseKey refuses anything else, so it is never fetched or linked', () => {
  for (const bad of ['', 'upsc', 'upsc-2019', 'upsc-19-7', 'UPSC-2019-7', 'upsc-2019-7-8', 'upsc-2019-x', '../upsc-2019-7', 'upsc-2019-7 ']) {
    assert.equal(parseKey(bad), null, JSON.stringify(bad));
    assert.equal(indexPath(bad), null, JSON.stringify(bad));
  }
});

test('the index for a key is the per-year file under its exam', () => {
  assert.equal(indexPath('upsc-2019-7'), '/upsc/index/2019.json');
  assert.equal(indexPath('upsc-1995-100'), '/upsc/index/1995.json');
});

test('only the years the student has keys for are needed, once each, in a stable order', () => {
  const s = state(
    { 'upsc-2019-7': entry('done'), 'upsc-2019-8': entry('review'), 'upsc-2021-1': entry('done') },
    { L1: list('Polity', ['upsc-2018-3', 'upsc-2019-7']), L2: list('Maps', ['upsc-2021-9']) }
  );
  assert.deepEqual(indexPathsFor(s), ['/upsc/index/2018.json', '/upsc/index/2019.json', '/upsc/index/2021.json']);
});

test('a student with nothing stored needs no index at all', () => {
  assert.deepEqual(indexPathsFor(state()), []);
  assert.deepEqual(indexPathsFor(state({}, { L1: list('Empty') })), []);
});

test('a key that names no year is skipped, not fetched', () => {
  assert.deepEqual(indexPathsFor(state({ garbage: entry('done'), 'upsc-2020-2': entry('done') })), ['/upsc/index/2020.json']);
});

// --- Which index files are still on their way. ---

const status = (o) => new Map(Object.entries(o));
const needs = state(
  { 'upsc-2019-7': entry('done'), 'upsc-2018-1': entry('review') },
  { L1: list('Maps', ['upsc-2017-3']) }
);

test('every needed file is pending until the page has asked for it and it has settled', () => {
  assert.deepEqual(pendingPaths(needs, status({})), ['/upsc/index/2017.json', '/upsc/index/2018.json', '/upsc/index/2019.json']);
});

test('a file that is loading is pending; one that loaded or failed is not', () => {
  assert.deepEqual(
    pendingPaths(needs, status({ '/upsc/index/2019.json': 'loading', '/upsc/index/2018.json': 'loaded', '/upsc/index/2017.json': 'failed' })),
    ['/upsc/index/2019.json']
  );
  assert.deepEqual(
    pendingPaths(needs, status({ '/upsc/index/2019.json': 'loaded', '/upsc/index/2018.json': 'loaded', '/upsc/index/2017.json': 'failed' })),
    []
  );
});

test('a file the state does not need never keeps the page waiting', () => {
  const s = status({ '/upsc/index/2019.json': 'loaded', '/upsc/index/2016.json': 'loading' });
  assert.deepEqual(pendingPaths(state({ 'upsc-2019-7': entry('done') }), s), []);
});

test('nothing stored is never pending', () => {
  assert.deepEqual(pendingPaths(state(), status({})), []);
});

test('a key shows as its printed serial, or as itself when it is not one of ours', () => {
  assert.equal(serialOf('upsc-2019-7'), '2019 · Q7');
  assert.equal(serialOf('whatever'), 'whatever');
});

// --- describe: one question, as listed. ---

test('describe resolves a key through the index', () => {
  assert.deepEqual(describe('upsc-2019-7', INDEX), {
    key: 'upsc-2019-7',
    serial: '2019 · Q7',
    path: '/upsc/question/2019-q7-x',
    subject: 'Indian Polity',
    title: 'Which one of the following is not a Harappan site?',
  });
});

test('describe leaves an unknown key as the key, with no path, subject or title', () => {
  assert.deepEqual(describe('upsc-2017-5', INDEX), {
    key: 'upsc-2017-5',
    serial: '2017 · Q5',
    path: null,
    subject: null,
    title: null,
  });
});

test('describe does not trust what is not a question entry', () => {
  // Each has a good path, so only its shape can be what is refused.
  const good = '/upsc/question/2019-q1-x';
  const index = { 'upsc-2019-1': 'nope', 'upsc-2019-2': [good, 3, 'x'], 'upsc-2019-3': [good, 'S'], 'upsc-2019-4': null, 'upsc-2019-5': [good, 'S', 7] };
  for (const key of Object.keys(index)) assert.equal(describe(key, index).path, null, key);
  // The path becomes a link: only a path on this site is one.
  const offSite = [
    '//evil.example/x',
    '/\\evil.example/x', // a browser reads "/\" as "//"
    '/\t/evil.example', // and drops the tab, leaving "//"
    '/\n/evil.example',
    'javascript:alert(1)',
    'https://evil.example/',
    'upsc/question/x',
    '/other/page',
    '/upsc/question/',
    '/upsc/question/x/../../y',
    '/upsc/question/x?next=//evil.example',
    '/upsc/question/Ab',
    '',
  ];
  for (const path of offSite) {
    assert.equal(describe('upsc-2019-9', { 'upsc-2019-9': [path, 'S', 'T'] }).path, null, JSON.stringify(path));
  }
  for (const path of ['/upsc/question/2019-q7-which-one-is-not-a-harappan-site', '/upsc/question/x', '/neet/question/2020-q1-a']) {
    assert.equal(describe('upsc-2019-9', { 'upsc-2019-9': [path, 'S', 'T'] }).path, path, path);
  }
  // A stored key is the user's: "constructor" is not a question just because every object has one.
  for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal(describe(key, {}).path, null, key);
  }
});

test('describe only believes entries the index itself holds, not ones it inherits', () => {
  const inherited = Object.create({ 'upsc-2019-1': ['/upsc/question/x', 'Indian Polity', 'T'] });
  assert.equal(describe('upsc-2019-1', inherited).path, null);
  assert.equal(summarise(state({ 'upsc-2019-1': entry('done') }), inherited).subjects.length, 0);
});

// --- Counting by subject. ---

test('counts done and needs-review per subject, A to Z', () => {
  const s = state({
    'upsc-2019-7': entry('done'),
    'upsc-2019-8': entry('review'),
    'upsc-2018-3': entry('done'),
    'upsc-2018-4': entry('review'),
  });
  const r = summarise(s, INDEX);
  assert.deepEqual(r.subjects, [
    { subject: 'Ancient History', done: 1, review: 0 },
    { subject: 'Geography', done: 0, review: 1 },
    { subject: 'Indian Polity', done: 1, review: 1 },
  ]);
  assert.deepEqual(r.totals, { done: 2, review: 2 });
  assert.equal(r.unplaced, 0);
});

test('a subject with the same name is one row however many years its questions are from', () => {
  const index = { ...INDEX, 'upsc-2017-1': q(1, 'Geography') };
  const r = summarise(state({ 'upsc-2018-4': entry('done'), 'upsc-2017-1': entry('done') }), index);
  assert.deepEqual(r.subjects, [{ subject: 'Geography', done: 2, review: 0 }]);
});

test('a key the index does not know is counted in the totals but never given a subject', () => {
  const s = state({ 'upsc-2019-7': entry('done'), 'upsc-2017-5': entry('review'), whatever: entry('done') });
  const r = summarise(s, INDEX);
  assert.deepEqual(r.subjects, [{ subject: 'Indian Polity', done: 1, review: 0 }]);
  assert.equal(r.unplaced, 2);
  assert.deepEqual(r.totals, { done: 2, review: 1 });
  assert.ok(!JSON.stringify(r.subjects).includes('Other'));
});

test('before any index has loaded nothing is placed and no subject is made up', () => {
  const r = summarise(state({ 'upsc-2019-7': entry('done'), 'upsc-2018-3': entry('review') }), {});
  assert.deepEqual(r.subjects, []);
  assert.equal(r.unplaced, 2);
  assert.deepEqual(r.totals, { done: 1, review: 1 });
});

test('nothing stored gives an empty summary', () => {
  assert.deepEqual(summarise(state(), INDEX), {
    totals: { done: 0, review: 0 },
    subjects: [],
    unplaced: 0,
    review: [],
    lists: [],
  });
});

// --- Needs review. ---

test('needs review holds only the questions marked that way, newest first', () => {
  const s = state({
    'upsc-2019-7': entry('review', '2026-03-01T10:00:00.000Z'),
    'upsc-2019-8': entry('done', '2026-03-05T10:00:00.000Z'),
    'upsc-2018-3': entry('review', '2026-03-03T10:00:00.000Z'),
    'upsc-2018-4': entry('review', '2026-02-01T10:00:00.000Z'),
  });
  assert.deepEqual(summarise(s, INDEX).review, ['upsc-2018-3', 'upsc-2019-7', 'upsc-2018-4']);
});

test('the review order does not depend on the order storage lists its entries in', () => {
  const at = '2026-03-01T10:00:00.000Z';
  const a = state({ 'upsc-2019-8': entry('review', at), 'upsc-2019-7': entry('review', at), 'upsc-2018-3': entry('review', at) });
  const b = state({ 'upsc-2018-3': entry('review', at), 'upsc-2019-7': entry('review', at), 'upsc-2019-8': entry('review', at) });
  assert.deepEqual(summarise(a, INDEX).review, ['upsc-2018-3', 'upsc-2019-7', 'upsc-2019-8']);
  assert.deepEqual(summarise(b, INDEX).review, summarise(a, INDEX).review);
});

test('dates are compared as dates, not as text (an account returns another format)', () => {
  const s = state({
    'upsc-2019-7': entry('review', '2026-03-01T10:00:00.000Z'),
    'upsc-2019-8': entry('review', '2026-03-01T15:00:00+05:30'), // 09:30 UTC: earlier
  });
  assert.deepEqual(summarise(s, INDEX).review, ['upsc-2019-7', 'upsc-2019-8']);
});

test('a question marked for review stays in the list while its index is missing', () => {
  const r = summarise(state({ 'upsc-2017-5': entry('review') }), INDEX);
  assert.deepEqual(r.review, ['upsc-2017-5']);
});

// --- Lists. ---

test('lists come A to Z by name, with their questions in the order they were saved', () => {
  const s = state({}, {
    L2: list('polity', ['upsc-2019-8', 'upsc-2019-7']),
    L1: list('Maps', ['upsc-2018-4']),
    L3: list('Ancient', []),
  });
  assert.deepEqual(summarise(s, INDEX).lists, [
    { id: 'L3', name: 'Ancient', keys: [] },
    { id: 'L1', name: 'Maps', keys: ['upsc-2018-4'] },
    { id: 'L2', name: 'polity', keys: ['upsc-2019-8', 'upsc-2019-7'] },
  ]);
});

test('lists with the same name keep a fixed order by id', () => {
  const a = summarise(state({}, { b: list('Same'), a: list('Same') }), {}).lists.map((l) => l.id);
  const b = summarise(state({}, { a: list('Same'), b: list('Same') }), {}).lists.map((l) => l.id);
  assert.deepEqual(a, ['a', 'b']);
  assert.deepEqual(b, ['a', 'b']);
});

test('a list does not change what the subject counts say', () => {
  const s = state({ 'upsc-2019-7': entry('done') }, { L1: list('Polity', ['upsc-2019-7', 'upsc-2018-3']) });
  assert.deepEqual(summarise(s, INDEX).subjects, [{ subject: 'Indian Polity', done: 1, review: 0 }]);
});

test('summarise does not change its input', () => {
  const s = state({ 'upsc-2019-7': entry('review') }, { L1: list('Polity', ['upsc-2019-7']) });
  const before = JSON.stringify(s);
  summarise(s, INDEX);
  assert.equal(JSON.stringify(s), before);
});

// --- What a list card shows: subjects covered, oldest review first, loaded years. ---

test('subjectsCovered names the two most frequent subjects and counts the rest', () => {
  const index = {
    'upsc-2019-1': ['/upsc/question/a', 'Polity', 't'], 'upsc-2019-2': ['/upsc/question/b', 'Polity', 't'],
    'upsc-2019-3': ['/upsc/question/c', 'Economy', 't'], 'upsc-2019-4': ['/upsc/question/d', 'Geography', 't'],
    'upsc-2019-5': ['/upsc/question/e', 'Art & Culture', 't'],
  };
  assert.deepEqual(subjectsCovered(['upsc-2019-1', 'upsc-2019-2', 'upsc-2019-3', 'upsc-2019-4', 'upsc-2019-5', 'upsc-2019-9'], index),
    { top: ['Polity', 'Art & Culture'], more: 2 });
  assert.deepEqual(subjectsCovered([], index), { top: [], more: 0 });
});

test('subjectsCovered: fewer than three subjects leave nothing to count, and a lone subject is alone', () => {
  assert.deepEqual(subjectsCovered(['upsc-2019-7', 'upsc-2019-8', 'upsc-2018-3'], INDEX), {
    top: ['Indian Polity', 'Ancient History'],
    more: 0,
  });
  assert.deepEqual(subjectsCovered(['upsc-2019-7', 'upsc-2019-8'], INDEX), { top: ['Indian Polity'], more: 0 });
});

test('subjectsCovered ignores keys the index does not know, and ones it only inherits', () => {
  assert.deepEqual(subjectsCovered(['upsc-1900-1', 'constructor', '__proto__'], INDEX), { top: [], more: 0 });
  assert.deepEqual(subjectsCovered(['upsc-1900-1', 'upsc-2018-4'], INDEX), { top: ['Geography'], more: 0 });
  assert.deepEqual(subjectsCovered(['upsc-2019-7'], {}), { top: [], more: 0 });
});

test('subjectsCovered breaks a tie A to Z, whatever order the keys came in', () => {
  const keys = ['upsc-2018-4', 'upsc-2018-3', 'upsc-2019-7']; // Geography, Ancient History, Indian Polity: one each
  assert.deepEqual(subjectsCovered(keys, INDEX), { top: ['Ancient History', 'Geography'], more: 1 });
  assert.deepEqual(subjectsCovered([...keys].reverse(), INDEX), { top: ['Ancient History', 'Geography'], more: 1 });
});

test('reviewOldestFirst orders needs-review marks oldest first', () => {
  const state = { entries: {
    'upsc-2019-1': { status: 'review', updatedAt: '2026-10-03T00:00:00Z' },
    'upsc-2019-2': { status: 'done', updatedAt: '2026-10-01T00:00:00Z' },
    'upsc-2019-3': { status: 'review', updatedAt: '2026-10-01T00:00:00Z' },
  }, lists: {} };
  assert.deepEqual(reviewOldestFirst(state), ['upsc-2019-3', 'upsc-2019-1']);
});

test('reviewOldestFirst breaks a tie by key, compares real dates, and has nothing to say for no marks', () => {
  const at = '2026-03-01T10:00:00.000Z';
  const tied = state({ 'upsc-2019-8': entry('review', at), 'upsc-2019-7': entry('review', at), 'upsc-2018-3': entry('review', at) });
  assert.deepEqual(reviewOldestFirst(tied), ['upsc-2018-3', 'upsc-2019-7', 'upsc-2019-8']);
  const zones = state({
    'upsc-2019-7': entry('review', '2026-03-01T10:00:00.000Z'),
    'upsc-2019-8': entry('review', '2026-03-01T15:00:00+05:30'), // 09:30 UTC: earlier
  });
  assert.deepEqual(reviewOldestFirst(zones), ['upsc-2019-8', 'upsc-2019-7']);
  assert.deepEqual(reviewOldestFirst(state({ 'upsc-2019-7': entry('done') })), []);
  assert.deepEqual(reviewOldestFirst(state()), []);
});

test('reviewOldestFirst is the reverse of the order the page lists review marks in, and changes nothing', () => {
  const s = state({
    'upsc-2019-7': entry('review', '2026-03-01T10:00:00.000Z'),
    'upsc-2018-3': entry('review', '2026-03-03T10:00:00.000Z'),
    'upsc-2018-4': entry('review', '2026-02-01T10:00:00.000Z'),
  });
  const before = JSON.stringify(s);
  assert.deepEqual(reviewOldestFirst(s), [...summarise(s, INDEX).review].reverse());
  assert.equal(JSON.stringify(s), before);
});

test('pendingForKeys: a card waits only for the years its own questions are in', () => {
  const status = new Map([['/upsc/index/2019.json', 'loaded']]);
  assert.deepEqual(pendingForKeys(['upsc-2019-7', 'upsc-2018-3'], status), ['/upsc/index/2018.json']);
  assert.deepEqual(pendingForKeys(['upsc-2019-7', 'upsc-2019-8'], status), []);
  assert.deepEqual(pendingForKeys([], status), []);
});

test('pendingForKeys counts a failed year as settled, a loading one as pending, and skips keys with no year', () => {
  const status = new Map([['/upsc/index/2019.json', 'failed'], ['/upsc/index/2018.json', 'loading']]);
  assert.deepEqual(pendingForKeys(['upsc-2019-7', 'upsc-2018-3', 'not-a-key', 'upsc-2017-1'], status), [
    '/upsc/index/2017.json',
    '/upsc/index/2018.json',
  ]);
});
