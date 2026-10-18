import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, abandonAttempt, chooseAnswer, newAttempt, submitAttempt } from '../src/lib/tests/attempt.js';
import { buildCatalogue, parseCatalogue } from '../src/lib/tests/catalogue.js';
import { examRules, makeRules } from '../src/lib/exam-rules.js';
import { scoreAttempt } from '../src/lib/tests/score.js';
import { emptyTests, putAttempt } from '../src/lib/tests/store.js';
import { MIN_ANSWERED, breakdown, headline, paperHistory, statsLine, submittedFor } from '../src/lib/tests/analytics.js';

const UPSC = examRules('upsc');
const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 18, h, m)).toISOString();
const key = (n) => `upsc-2020-${n}`;
const byNumber = (answers) => Object.fromEntries(Object.entries(answers).map(([n, option]) => [key(n), option]));

// --- Fixtures, built with the real helpers (attempt.js, catalogue.js, score.js) ---

const question = (year, qNo, subject, subtopic, answer) => ({
  year,
  q_no: qNo,
  subject,
  subtopic,
  status: answer ? 'ok' : 'cancelled',
  answer: answer ?? '',
});

const RAW = buildCatalogue([
  question(2020, 1, 'Indian Polity', 'Parliament', 'a'),
  question(2020, 2, 'Indian Polity', 'Parliament', 'b'),
  question(2020, 3, 'Indian Polity', 'Fundamental Rights', 'c'),
  question(2020, 4, 'Geography', 'Rivers', 'd'),
  question(2020, 5, 'Geography', 'Rivers', null),
  question(2020, 6, 'Indian Economy', 'Banking', 'a'),
]);
const CATALOGUE = parseCatalogue(RAW);

const officialIn = (catalogue) => {
  const answers = new Map(catalogue.entries.map((e) => [e.key, e.answer]));
  return (k) => answers.get(k) ?? null;
};

const CUSTOM = { subjects: [], topics: [], fromYear: 2020, toYear: 2020, count: 10, minutes: 60, skipDone: false, onlyReview: false, seed: 1 };

/** A submitted attempt whose stored result is scored by scoreAttempt against `catalogue`. */
function submitted(id, { keys, answers, submittedAt, kind = 'custom', year = 2020, catalogue = CATALOGUE }) {
  let a = newAttempt({ id, kind, spec: kind === 'paper' ? { year } : CUSTOM, keys, limitMs: 60 * MINUTE, now: at(9) });
  for (const [k, option] of Object.entries(answers)) a = chooseAnswer(a, k, option, at(9, 30));
  return submitAttempt(a, scoreAttempt(keys, a.answers, officialIn(catalogue)), submittedAt);
}

/** A submitted attempt with a stored result given outright, as the headline reads it. */
function withResult(id, { kind, year = 2022, right, wrong, blank, score, max, submittedAt }) {
  const a = newAttempt({ id, kind, spec: kind === 'paper' ? { year } : CUSTOM, keys: [key(1)], limitMs: 60 * MINUTE, now: at(9) });
  return submitAttempt(a, { scored: right + wrong + blank, right, wrong, blank, score, max }, submittedAt);
}

const mark = (status, updatedAt) => ({ status, updatedAt, synced: true });

const T1 = submitted('t1', {
  keys: [1, 2, 3, 4, 5, 6].map(key),
  answers: byNumber({ 1: 'a', 2: 'c', 3: 'c', 4: 'a', 5: 'b' }),
  submittedAt: at(10),
});
const T2 = submitted('t2', { keys: [2, 4, 6].map(key), answers: byNumber({ 2: 'b', 4: 'a' }), submittedAt: at(11) });
const T3 = abandonAttempt(
  chooseAnswer(newAttempt({ id: 't3', kind: 'custom', spec: CUSTOM, keys: [key(1)], limitMs: 60 * MINUTE, now: at(9) }), key(1), 'b', at(9, 10)),
  at(9, 20)
);
const tests = [T1, T2, T3].reduce(putAttempt, emptyTests());

const MARKS = {
  [key(6)]: mark('review', at(10, 15)),
  [key(4)]: mark('done', at(10, 30)),
  'upsc-2019-9': mark('done', at(10, 45)), // not in the catalogue
  'ssc-2020-1': mark('done', at(10, 45)), // another exam
};

const SUBJECTS = [
  { subject: 'Geography', answered: 2, right: 0, wrong: 2, net: -1.33, covered: 2, total: 2 },
  { subject: 'Indian Polity', answered: 4, right: 3, wrong: 1, net: 5.33, covered: 3, total: 3 },
  { subject: 'Indian Economy', answered: 0, right: 0, wrong: 0, net: 0, covered: 1, total: 1 },
];

const run = (attempts = submittedFor(tests, 'upsc'), marks = MARKS, catalogue = CATALOGUE, rules = UPSC) =>
  breakdown(attempts, marks, catalogue, rules, 'upsc');

/**
 * A catalogue of one subject per row of `plan` ({ subject, topic, size }), every answer 'a', and
 * the keys of each topic. Question numbers run on across rows.
 */
function drill(plan) {
  const questions = [];
  const keys = {};
  let n = 0;
  for (const { subject, topic, size } of plan) {
    keys[topic] = [];
    for (let i = 0; i < size; i += 1) {
      n += 1;
      questions.push(question(2020, n, subject, topic, 'a'));
      keys[topic].push(key(n));
    }
  }
  return { catalogue: parseCatalogue(buildCatalogue(questions)), keys };
}

/** Answers for the first `answered` keys of a topic, the first `right` of them rightly ('a'). */
const answerTopic = (topicKeys, answered, right) =>
  Object.fromEntries(topicKeys.slice(0, answered).map((k, i) => [k, i < right ? 'a' : 'b']));

test('the minimum for a percentage is five answers', () => {
  assert.equal(MIN_ANSWERED, 5);
});

test('the fixture catalogue parses as the brief says', () => {
  assert.equal(CATALOGUE.entries.length, 6);
  assert.equal(CATALOGUE.entries.find((e) => e.key === key(5)).answer, null);
  assert.equal(CATALOGUE.entries.find((e) => e.key === key(5)).flag, 3);
  assert.equal(CATALOGUE.entries.find((e) => e.key === key(4)).answer, 'd');
});

test('submittedFor: this exam, submitted only, oldest first', () => {
  const ssc = { ...submitted('s1', { keys: [key(1)], answers: {}, submittedAt: at(9, 30) }), exam: 'ssc' };
  // Inserted newest first, so the order has to come from submittedAt rather than insertion.
  const mixed = [T2, T3, ssc, T1].reduce(putAttempt, emptyTests());
  assert.deepEqual(
    submittedFor(mixed, 'upsc').map((a) => a.id),
    ['t1', 't2']
  );
  assert.deepEqual(
    submittedFor(mixed, 'ssc').map((a) => a.id),
    ['s1']
  );
  assert.deepEqual(submittedFor(mixed, 'nope'), []);
  assert.deepEqual(submittedFor(emptyTests(), 'upsc'), []);
});

test('submittedFor: attempts submitted at the same moment keep a fixed order', () => {
  const a = submitted('b', { keys: [key(1)], answers: {}, submittedAt: at(10) });
  const b = submitted('a', { keys: [key(1)], answers: {}, submittedAt: at(10) });
  assert.deepEqual(
    submittedFor([a, b].reduce(putAttempt, emptyTests()), 'upsc').map((x) => x.id),
    ['a', 'b']
  );
});

test('subjects: counts, net marks and coverage, weakest first', () => {
  assert.deepEqual(run().subjects, SUBJECTS);
});

test('the by-subject and by-topic maps carry the same counts, topics keyed by subject and topic', () => {
  const { bySubject, byTopic } = run();
  assert.deepEqual(bySubject.get('Geography'), { answered: 2, right: 0, covered: 2, total: 2 });
  assert.deepEqual(bySubject.get('Indian Polity'), { answered: 4, right: 3, covered: 3, total: 3 });
  assert.deepEqual(bySubject.get('Indian Economy'), { answered: 0, right: 0, covered: 1, total: 1 });
  assert.equal(bySubject.get('Nowhere'), undefined);
  assert.deepEqual(byTopic.get('Indian Polity\u0000Parliament'), { answered: 3, right: 2, covered: 2, total: 2 });
  assert.deepEqual(byTopic.get('Indian Polity\u0000Fundamental Rights'), { answered: 1, right: 1, covered: 1, total: 1 });
  assert.deepEqual(byTopic.get('Geography\u0000Rivers'), { answered: 2, right: 0, covered: 2, total: 2 });
  assert.equal(byTopic.size, 4);
});

test('unknown keys, other exams and abandoned attempts count nowhere', () => {
  const clean = run(submittedFor(tests, 'upsc'), { [key(6)]: MARKS[key(6)], [key(4)]: MARKS[key(4)] });
  const stray = submitted('t6', {
    keys: ['upsc-2019-9', 'upsc-2020-99', 'ssc-2020-1', 'not a key'],
    answers: { 'upsc-2019-9': 'a', 'upsc-2020-99': 'b', 'ssc-2020-1': 'c', 'not a key': 'd' },
    submittedAt: at(11, 30),
  });
  const otherExam = { ...submitted('s1', { keys: [key(1), key(4)], answers: byNumber({ 1: 'b', 4: 'a' }), submittedAt: at(11, 40) }), exam: 'ssc' };
  // Handed straight to breakdown, without submittedFor: the abandoned and other-exam
  // attempts are still kept out, and a catalogue-less key is skipped without a throw.
  const noisy = run([T1, T2, T3, stray, otherExam], MARKS);
  assert.deepEqual(noisy.subjects, SUBJECTS);
  assert.deepEqual(noisy.wrong, ['upsc-2020-4']);
  assert.deepEqual(noisy, clean);
  assert.doesNotThrow(() => run([T3, stray], MARKS));
  assert.deepEqual(run([T3, stray], MARKS).subjects.map((s) => s.subject), ['Geography', 'Indian Economy']);
});

test('the wrong pile uses the last actual answer and a later Done', () => {
  assert.deepEqual(run().wrong, ['upsc-2020-4']); // wrong again at 11:00, after the 10:30 Done

  const doneLater = { ...MARKS, [key(4)]: mark('done', at(11, 30)) };
  assert.deepEqual(run(submittedFor(tests, 'upsc'), doneLater).wrong, []);

  const T4 = submitted('t4', { keys: [key(1)], answers: byNumber({ 1: 'b' }), submittedAt: at(12) });
  const T5 = submitted('t5', { keys: [key(1)], answers: {}, submittedAt: at(13) }); // key 1 left blank
  const more = [T1, T2, T4, T5].reduce(putAttempt, emptyTests());
  const pile = run(submittedFor(more, 'upsc'), doneLater).wrong;
  assert.deepEqual(pile, ['upsc-2020-1']); // a blank does not clear it
  assert.ok(!pile.includes('upsc-2020-2')); // its last actual answer (T2) was right
  // Newest wrong first: key 1 was wrong at 12:00, key 4 at 11:00 (the 10:30 Done is earlier than both).
  assert.deepEqual(run(submittedFor(more, 'upsc')).wrong, ['upsc-2020-1', 'upsc-2020-4']);
});

test('breakdown does not depend on the order it is handed the attempts', () => {
  // Question 2 was wrong in T1 and right in T2: whichever comes first in the list, T2 is the later answer.
  assert.deepEqual(run([T2, T1]), run([T1, T2]));
  assert.ok(!run([T2, T1]).wrong.includes(key(2)));
});

test('a Done at the very moment of the test, or a Needs review mark, does not clear the wrong pile', () => {
  const sameMoment = { ...MARKS, [key(4)]: mark('done', at(11)) };
  assert.deepEqual(run(submittedFor(tests, 'upsc'), sameMoment).wrong, ['upsc-2020-4']);
  const review = { ...MARKS, [key(4)]: mark('review', at(11, 30)) };
  assert.deepEqual(run(submittedFor(tests, 'upsc'), review).wrong, ['upsc-2020-4']);
});

test('answering a wrong question rightly later takes it out; wrong again later puts it back', () => {
  const rightLater = submitted('t4', { keys: [key(4)], answers: byNumber({ 4: 'd' }), submittedAt: at(12) });
  const pile = (attempts) => run(submittedFor(attempts.reduce(putAttempt, emptyTests()), 'upsc')).wrong;
  assert.deepEqual(pile([T1, T2]), ['upsc-2020-4']);
  assert.deepEqual(pile([T1, T2, rightLater]), []);
  const wrongAgain = submitted('t5', { keys: [key(4)], answers: byNumber({ 4: 'b' }), submittedAt: at(13) });
  assert.deepEqual(pile([T1, T2, rightLater, wrongAgain]), ['upsc-2020-4']);
});

test('the wrong pile is newest wrong first, and ties go by question number', () => {
  const { catalogue, keys } = drill([{ subject: 'Sub', topic: 'Top', size: 12 }]);
  const k = keys.Top;
  const early = submitted('e', { keys: [k[1], k[9], k[8]], answers: { [k[1]]: 'b', [k[9]]: 'b', [k[8]]: 'b' }, submittedAt: at(10), catalogue });
  const late = submitted('l', { keys: [k[10]], answers: { [k[10]]: 'b' }, submittedAt: at(11), catalogue });
  // Handed over newest first, so the order of the pile cannot come from the order of the list.
  const { wrong } = breakdown([late, early], {}, catalogue, UPSC, 'upsc');
  // Question 11 is the newest. Questions 2, 9 and 10 were wrong at the same moment, and read as text
  // they would sort 10, 2, 9: the pile has to read in question order.
  assert.deepEqual(wrong, [k[10], k[1], k[8], k[9]]);
});

test('topics to work on need five answers and keep three', () => {
  // Listed S first so that P before S comes from the sort, not from the catalogue's order.
  const { catalogue, keys } = drill([
    { subject: 'Sub', topic: 'S', size: 7 },
    { subject: 'Sub', topic: 'T', size: 9 },
    { subject: 'Sub', topic: 'R', size: 6 },
    { subject: 'Sub', topic: 'Q', size: 8 },
    { subject: 'Sub', topic: 'P', size: 7 },
  ]);
  const plan = { P: [5, 2], Q: [6, 5], R: [4, 0], S: [5, 2], T: [7, 3] };
  const all = Object.fromEntries(Object.entries(plan).flatMap(([topic, [answered, right]]) => Object.entries(answerTopic(keys[topic], answered, right))));
  const attempt = submitted('syn', { keys: Object.values(keys).flat(), answers: all, submittedAt: at(10), catalogue });
  const { topics, byTopic } = breakdown([attempt], {}, catalogue, UPSC, 'upsc');
  assert.deepEqual(
    topics.map((t) => t.topic),
    ['P', 'S', 'T']
  );
  assert.deepEqual(topics[0], { subject: 'Sub', topic: 'P', right: 2, answered: 5 });
  assert.deepEqual(topics[2], { subject: 'Sub', topic: 'T', right: 3, answered: 7 });
  // R (4 answered) is too few to rank, and Q (0.83) is the strongest, cut by the limit of three.
  assert.deepEqual(byTopic.get('Sub\u0000R'), { answered: 4, right: 0, covered: 4, total: 6 });
  assert.deepEqual(byTopic.get('Sub\u0000Q'), { answered: 6, right: 5, covered: 6, total: 8 });
});

test('among topics of equal accuracy, the one with more answers comes first', () => {
  const { catalogue, keys } = drill([
    { subject: 'Sub', topic: 'A', size: 6 },
    { subject: 'Sub', topic: 'B', size: 10 },
  ]);
  const answers = { ...answerTopic(keys.A, 6, 3), ...answerTopic(keys.B, 10, 5) };
  const attempt = submitted('syn', { keys: [...keys.A, ...keys.B], answers, submittedAt: at(10), catalogue });
  const { topics } = breakdown([attempt], {}, catalogue, UPSC, 'upsc');
  assert.deepEqual(
    topics.map((t) => t.topic),
    ['B', 'A']
  );
});

test('subjects: enough answers first, then a few, then coverage only; nothing at all is left out', () => {
  const { catalogue, keys } = drill([
    { subject: 'Zeta', topic: 'z', size: 12 }, // 10 answered, 5 right: 0.5, the most answers
    { subject: 'Alpha', topic: 'a', size: 8 }, // 6 answered, 3 right: 0.5
    { subject: 'Bravo', topic: 'b', size: 8 }, // 5 answered, 1 right: 0.2
    { subject: 'Golf', topic: 'g', size: 8 }, //  5 answered, 1 right: 0.2, after Bravo by name
    { subject: 'Charlie', topic: 'c', size: 8 }, // 5 answered, 4 right: 0.8
    { subject: 'Delta', topic: 'd', size: 4 }, //  2 answered, 0 right
    { subject: 'Hotel', topic: 'h', size: 4 }, //  3 answered, 3 right
    { subject: 'Echo', topic: 'e', size: 4 }, //   none answered, one marked Done
    { subject: 'Alfa', topic: 'f', size: 4 }, //   none answered, one marked Needs review
    { subject: 'Foxtrot', topic: 'x', size: 4 }, // nothing at all
  ]);
  const answers = {
    ...answerTopic(keys.z, 10, 5),
    ...answerTopic(keys.a, 6, 3),
    ...answerTopic(keys.b, 5, 1),
    ...answerTopic(keys.g, 5, 1),
    ...answerTopic(keys.c, 5, 4),
    ...answerTopic(keys.d, 2, 0),
    ...answerTopic(keys.h, 3, 3),
  };
  const attempt = submitted('syn', { keys: Object.values(keys).flat(), answers, submittedAt: at(10), catalogue });
  const marks = { [keys.e[0]]: mark('done', at(10, 30)), [keys.f[1]]: mark('review', at(10, 30)) };
  const { subjects } = breakdown([attempt], marks, catalogue, UPSC, 'upsc');
  assert.deepEqual(
    subjects.map((s) => s.subject),
    // 5 or more answered: accuracy ascending, then more answers, then name (Zeta's 10 beat Alpha's 6).
    // Fewer than 5: the same. Then the coverage-only subjects by name. Foxtrot is left out.
    ['Bravo', 'Golf', 'Zeta', 'Alpha', 'Charlie', 'Delta', 'Hotel', 'Alfa', 'Echo']
  );
});

test("another exam's marking changes net marks", () => {
  const half = makeRules({ options: ['a', 'b', 'c', 'd'], right: 2, wrong: { numerator: 1, denominator: 2 } });
  const rows = run(submittedFor(tests, 'upsc'), MARKS, CATALOGUE, half).subjects;
  assert.equal(rows.find((s) => s.subject === 'Geography').net, -1);
  assert.equal(rows.find((s) => s.subject === 'Indian Polity').net, 5.5);
});

test('a catalogue without answers makes everything unscored', () => {
  // A copy of the catalogue file from before answers existed, still in a browser's cache:
  // four elements per entry, so every question parses with answer null (and flag 0 for the
  // ones that were fine).
  const old = structuredClone(RAW);
  for (const k of Object.keys(old.questions)) old.questions[k] = old.questions[k].slice(0, 4);
  const stale = parseCatalogue(old);
  assert.ok(stale.entries.every((e) => e.answer === null));
  assert.equal(stale.entries.find((e) => e.key === key(1)).flag, 0);

  const result = run(submittedFor(tests, 'upsc'), MARKS, stale);
  assert.deepEqual(result.subjects, [
    { subject: 'Geography', answered: 0, right: 0, wrong: 0, net: 0, covered: 2, total: 2 },
    { subject: 'Indian Economy', answered: 0, right: 0, wrong: 0, net: 0, covered: 1, total: 1 },
    { subject: 'Indian Polity', answered: 0, right: 0, wrong: 0, net: 0, covered: 3, total: 3 },
  ]);
  assert.deepEqual(result.wrong, []);
  assert.deepEqual(result.topics, []);

  // The same through entries set to null by hand.
  const nulled = { ...CATALOGUE, entries: CATALOGUE.entries.map((e) => ({ ...e, answer: null })) };
  assert.deepEqual(run(submittedFor(tests, 'upsc'), MARKS, nulled).subjects, result.subjects);
});

test('with nothing taken and nothing marked there is nothing to show', () => {
  const none = run([], {});
  assert.deepEqual(none.subjects, []);
  assert.deepEqual(none.topics, []);
  assert.deepEqual(none.wrong, []);
  // Marks alone give coverage.
  const marked = run([], { [key(1)]: mark('done', at(10)) });
  assert.deepEqual(marked.subjects, [{ subject: 'Indian Polity', answered: 0, right: 0, wrong: 0, net: 0, covered: 1, total: 3 }]);
});

test('marks that are not marks, and an empty catalogue, do not throw', () => {
  const garbage = { [key(1)]: null, [key(2)]: 'done', [key(3)]: { status: 'archived', updatedAt: at(10) }, [key(4)]: {} };
  const result = run(submittedFor(tests, 'upsc'), garbage);
  // None of them is a mark, so coverage comes from the tests alone: Economy has only a blank.
  assert.deepEqual(result.subjects, SUBJECTS.slice(0, 2));
  assert.deepEqual(result.wrong, ['upsc-2020-4']);
  assert.doesNotThrow(() => run(submittedFor(tests, 'upsc'), null));
  assert.deepEqual(run(submittedFor(tests, 'upsc'), null).subjects, SUBJECTS.slice(0, 2));
  const empty = { subjects: [], topics: [], entries: [] };
  const bare = run(submittedFor(tests, 'upsc'), MARKS, empty);
  assert.deepEqual(bare.subjects, []);
  assert.deepEqual(bare.wrong, []);
  assert.equal(bare.bySubject.size, 0);
  assert.equal(bare.byTopic.size, 0);
});

const P1 = withResult('p1', { kind: 'paper', year: 2022, right: 50, wrong: 30, blank: 20, score: 80, max: 200, submittedAt: at(9) });
const P2 = withResult('p2', { kind: 'paper', year: 2023, right: 60, wrong: 20, blank: 20, score: 106.67, max: 200, submittedAt: at(10) });
const C1 = withResult('c1', { kind: 'custom', right: 7, wrong: 2, blank: 1, score: 12.67, max: 20, submittedAt: at(11) });

test('headline from stored results', () => {
  assert.deepEqual(headline([P1, P2, C1], UPSC), {
    tests: 3,
    papers: 2,
    accuracy: { right: 117, answered: 169 },
    blank: { blank: 41, scored: 210 },
    lost: 34.67,
    latestPaper: { year: 2023, score: 106.67, max: 200, change: 26.67 },
  });
  const otherMax = withResult('p1', { kind: 'paper', year: 2022, right: 50, wrong: 30, blank: 20, score: 80, max: 300, submittedAt: at(9) });
  assert.equal(headline([otherMax, P2, C1], UPSC).latestPaper.change, null);
  assert.equal(headline([C1], UPSC).latestPaper, null);
});

test('headline: papers of a similar size show the change', () => {
  // 97 scored questions (max 194) then 100 (max 200): recent UPSC papers differ like this.
  const small = withResult('p1', { kind: 'paper', year: 2024, right: 50, wrong: 30, blank: 17, score: 80, max: 194, submittedAt: at(9) });
  assert.deepEqual(headline([small, P2], UPSC).latestPaper, { year: 2023, score: 106.67, max: 200, change: 26.67 });
});

test('headline: the change needs maxima within 10% of each other', () => {
  // Exactly 10% apart still compares; a mark further does not. Only `max` is read
  // here, so 179 need not be a whole number of questions.
  const at180 = withResult('p1', { kind: 'paper', year: 2022, right: 50, wrong: 30, blank: 10, score: 80, max: 180, submittedAt: at(9) });
  const at179 = withResult('p1', { kind: 'paper', year: 2022, right: 50, wrong: 30, blank: 10, score: 80, max: 179, submittedAt: at(9) });
  assert.equal(headline([at180, P2], UPSC).latestPaper.change, 26.67);
  assert.equal(headline([at179, P2], UPSC).latestPaper.change, null);
});

test('headline: the latest paper is the last one submitted, not the highest year', () => {
  const retake = withResult('p3', { kind: 'paper', year: 2022, right: 70, wrong: 10, blank: 20, score: 133.33, max: 200, submittedAt: at(12) });
  const { latestPaper } = headline([P1, P2, C1, retake], UPSC);
  assert.deepEqual(latestPaper, { year: 2022, score: 133.33, max: 200, change: 26.66 });
  // Handed in any order, the same answer.
  assert.deepEqual(headline([retake, C1, P2, P1], UPSC).latestPaper, latestPaper);
});

test('headline: a single paper has no change, and a drop is negative', () => {
  assert.deepEqual(headline([P1], UPSC).latestPaper, { year: 2022, score: 80, max: 200, change: null });
  const worse = withResult('p3', { kind: 'paper', year: 2024, right: 40, wrong: 40, blank: 20, score: 53.33, max: 200, submittedAt: at(12) });
  assert.equal(headline([P1, P2, worse], UPSC).latestPaper.change, -53.34);
});

test('headline: nothing taken yet', () => {
  assert.deepEqual(headline([], UPSC), {
    tests: 0,
    papers: 0,
    accuracy: { right: 0, answered: 0 },
    blank: { blank: 0, scored: 0 },
    lost: 0,
    latestPaper: null,
  });
});

test('headline: marks lost follow the exam rules', () => {
  const half = makeRules({ options: ['a', 'b', 'c', 'd'], right: 2, wrong: { numerator: 1, denominator: 2 } });
  assert.equal(headline([P1, P2, C1], half).lost, 26);
});

test('headline: an attempt that was not submitted is not counted', () => {
  assert.equal(headline([P1, T3], UPSC).tests, 1);
});

test('paper history is papers only, oldest first', () => {
  assert.deepEqual(paperHistory([P2, C1, P1]), [
    { id: 'p1', year: 2022, score: 80, max: 200, submittedAt: at(9) },
    { id: 'p2', year: 2023, score: 106.67, max: 200, submittedAt: at(10) },
  ]);
  assert.deepEqual(paperHistory([C1]), []);
  assert.deepEqual(paperHistory([]), []);
});

test('statsLine says what the student has', () => {
  assert.equal(statsLine({ answered: 25, right: 12, covered: 60, total: 422 }), 'Your accuracy here: 48% (25 answered) · Covered 60 of 422');
  assert.equal(statsLine({ answered: 3, right: 2, covered: 3, total: 10 }), '2 of 3 right so far · Covered 3 of 10');
  assert.equal(statsLine({ answered: 0, right: 0, covered: 12, total: 422 }), 'Covered 12 of 422');
  assert.equal(statsLine({ answered: 0, right: 0, covered: 0, total: 5 }), null);
  assert.equal(statsLine(undefined), null);
});

test('statsLine: a bare percentage starts at five answers', () => {
  assert.equal(statsLine({ answered: 4, right: 4, covered: 4, total: 9 }), '4 of 4 right so far · Covered 4 of 9');
  assert.equal(statsLine({ answered: 5, right: 5, covered: 5, total: 9 }), 'Your accuracy here: 100% (5 answered) · Covered 5 of 9');
  assert.equal(statsLine({ answered: 5, right: 0, covered: 5, total: 9 }), 'Your accuracy here: 0% (5 answered) · Covered 5 of 9');
});
