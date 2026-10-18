import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { GET } from '../src/pages/upsc/catalogue.json.js';
import { ALL_QUESTIONS } from '../src/lib/corpus.js';
import { makeRules } from '../src/lib/exam-rules.js';
import { FLAG, buildCatalogue, flagOf, parseCatalogue } from '../src/lib/tests/catalogue.js';

// Built exactly as the build builds it.
const body = await GET().text();
const data = JSON.parse(body);

test('every question is in the catalogue, under its key', () => {
  assert.equal(Object.keys(data.questions).length, ALL_QUESTIONS.length);
  for (const q of ALL_QUESTIONS) assert.ok(Object.hasOwn(data.questions, q.qkey), q.qkey);
});

test('the endpoint serves buildCatalogue of the corpus', () => {
  assert.deepEqual(data, buildCatalogue(ALL_QUESTIONS));
});

test('flags: 9 cancelled, 3 with no official answer, 1 disputed with one', () => {
  const counts = [0, 0, 0, 0];
  for (const [, , , flag] of Object.values(data.questions)) counts[flag] += 1;
  assert.equal(counts[FLAG.cancelled], 9);
  assert.equal(counts[FLAG.unanswered], 3);
  assert.equal(counts[FLAG.disputed], 1);
  assert.equal(counts[FLAG.ok], ALL_QUESTIONS.length - 13);
  assert.equal(flagOf({ status: 'disputed', answer: '' }), FLAG.unanswered);
  assert.equal(flagOf({ status: 'cancelled', answer: 'a' }), FLAG.cancelled);
});

test('it parses back to every question with its subject, topic and year', () => {
  const cat = parseCatalogue(data);
  assert.equal(cat.entries.length, ALL_QUESTIONS.length);
  const byKey = new Map(cat.entries.map((e) => [e.key, e]));
  for (const q of ALL_QUESTIONS) {
    const e = byKey.get(q.qkey);
    assert.deepEqual([e.subject, e.topic, e.year], [q.subject, q.subtopic, q.year], q.qkey);
  }
  assert.deepEqual(cat.subjects, [...cat.subjects].sort((a, b) => a.localeCompare(b, 'en')));
  // In order: by year, then number.
  const order = cat.entries.map((e) => [e.year, Number(e.key.split('-')[2])]);
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1][0] < order[i][0] || (order[i - 1][0] === order[i][0] && order[i - 1][1] < order[i][1]));
  }
});

test('it is small: under 25 KB gzipped', () => {
  const size = gzipSync(body).length;
  assert.ok(size < 25 * 1024, `${size} bytes`);
});

test('a catalogue that is not one is refused, and bad entries are dropped', () => {
  for (const bad of [null, [], {}, { subjects: 'x', topics: [], questions: {} }]) assert.equal(parseCatalogue(bad), null);
  const cat = parseCatalogue({
    subjects: ['Geography'],
    topics: [[0, 'Rivers'], [5, 'Bad']],
    questions: {
      'upsc-2019-1': [0, 0, 2019, 0],
      'upsc-2019-2': [0, 1, 2019, 0], // topic 1 names a subject that is not there
      'upsc-2019-3': [0, 0, 2018, 0], // year disagrees with the key
      'not-a-key': [0, 0, 2019, 0],
      'upsc-2019-4': [0, 0, 2019, 9], // no such flag
      'upsc-2019-5': 'x',
    },
  });
  assert.deepEqual(cat.entries, [{ key: 'upsc-2019-1', subject: 'Geography', topic: 'Rivers', year: 2019, flag: 0, answer: null }]);
});

test('every scored question carries its official answer', () => {
  const cat = parseCatalogue(data);
  const byKey = new Map(cat.entries.map((e) => [e.key, e]));
  let withAnswer = 0;
  for (const q of ALL_QUESTIONS) {
    const scored = q.status !== 'cancelled' && /^[abcd]$/.test(q.answer);
    assert.equal(byKey.get(q.qkey).answer, scored ? q.answer : null, q.qkey);
    if (scored) withAnswer += 1;
  }
  // Not vacuous: nearly every question has one (cancelled and unanswered ones do not).
  assert.ok(withAnswer > ALL_QUESTIONS.length - 20, `${withAnswer} of ${ALL_QUESTIONS.length}`);
});

test('a catalogue from before answers still parses', () => {
  const cat = parseCatalogue({
    subjects: ['Geography'],
    topics: [[0, 'Rivers']],
    questions: { 'upsc-2019-1': [0, 0, 2019, 0] },
  });
  assert.deepEqual(cat.entries, [{ key: 'upsc-2019-1', subject: 'Geography', topic: 'Rivers', year: 2019, flag: 0, answer: null }]);
  const bad = parseCatalogue({
    subjects: ['Geography'],
    topics: [[0, 'Rivers']],
    questions: {
      'upsc-2019-1': [0, 0, 2019, 0, 7], // an answer index out of range
      'upsc-2019-2': [0, 0, 2019, 0, 'a'], // not an index
      'upsc-2019-3': [0, 0, 2019, 0, 1.5],
      'upsc-2019-4': [0, 0, 2019, 0, -2],
      'upsc-2019-5': [0, 0, 2019, 0, 0, 0], // too long
      'upsc-2019-6': [0, 0, 2019, 0, -1], // no scored answer
      'upsc-2019-7': [0, 0, 2019, 0, 3],
    },
  });
  assert.deepEqual(
    bad.entries.map((e) => [e.key, e.answer]),
    [['upsc-2019-6', null], ['upsc-2019-7', 'd']]
  );
});

// A made-up exam. The shared rules table is private to exam-rules.js (adding to it
// would mean mutating state every other test reads), so parseCatalogue takes the
// rules as an optional third argument and these tests hand it makeRules' output:
// the same code path as a real second exam, with nothing shared touched.
const FIVE_OPTIONS = makeRules({ options: ['a', 'b', 'c', 'd', 'e'], right: 1, wrong: { numerator: 1, denominator: 4 } });
const MADE_UP = {
  subjects: ['Maths'],
  topics: [[0, 'Algebra']],
  questions: {
    'xyz-2021-1': [0, 0, 2021, 0, 4], // option e: only a five-option exam has it
    'xyz-2021-2': [0, 0, 2021, 0, -1],
    'upsc-2021-3': [0, 0, 2021, 0, 0], // another exam's key
  },
};

test('a made-up exam parses with its own rules: its keys, its options', () => {
  const cat = parseCatalogue(MADE_UP, 'xyz', FIVE_OPTIONS);
  assert.deepEqual(
    cat.entries.map((e) => [e.key, e.answer]),
    [['xyz-2021-1', 'e'], ['xyz-2021-2', null]]
  );
});

test('an exam with no rules has no catalogue, and the default is still UPSC', () => {
  assert.equal(parseCatalogue(MADE_UP, 'xyz'), null);
  for (const bad of ['', 'UPSC', 'up-sc', 'upsc.*', 7, null]) {
    assert.equal(parseCatalogue(MADE_UP, bad, FIVE_OPTIONS), null, String(bad));
  }
  // UPSC's four options: answer index 4 is out of range, and xyz keys are not its keys.
  assert.deepEqual(parseCatalogue(MADE_UP).entries.map((e) => e.key), ['upsc-2021-3']);
  assert.deepEqual(parseCatalogue(MADE_UP, 'upsc').entries.map((e) => e.key), ['upsc-2021-3']);
});
