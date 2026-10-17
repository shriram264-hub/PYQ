import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolMessage, preselection, readSpec } from '../src/lib/tests/form.js';

const values = (o = {}) => ({
  subjects: [],
  topics: [],
  fromYear: '1995',
  toYear: '2026',
  count: '25',
  minutes: '30',
  skipDone: false,
  onlyReview: false,
  ...o,
});

test('a plain form reads as every subject, all years, 25 questions, 30 minutes', () => {
  assert.deepEqual(readSpec(values(), 7), {
    subjects: [],
    topics: [],
    fromYear: 1995,
    toYear: 2026,
    count: 25,
    minutes: 30,
    skipDone: false,
    onlyReview: false,
    seed: 7,
  });
});

test('a topic brings its subject; topics that are not [subject, topic] pairs are dropped', () => {
  const spec = readSpec(
    values({ subjects: ['Geography'], topics: [JSON.stringify(['Indian Polity', 'Parliament']), 'nonsense', JSON.stringify([1, 2])] }),
    1
  );
  assert.deepEqual(spec.subjects, ['Geography', 'Indian Polity']);
  assert.deepEqual(spec.topics, [['Indian Polity', 'Parliament']]);
});

test('years read in either order; count and minutes are kept to what a test allows', () => {
  const spec = readSpec(values({ fromYear: '2020', toYear: '2001', count: '30', minutes: '999' }), 1);
  assert.deepEqual([spec.fromYear, spec.toYear, spec.count, spec.minutes], [2001, 2020, 25, 180]);
  assert.equal(readSpec(values({ minutes: '2' }), 1).minutes, 5);
  assert.equal(readSpec(values({ count: '100', minutes: '' }), 1).minutes, 120, 'empty time takes the default');
  assert.equal(readSpec(values({ minutes: '12.6' }), 1).minutes, 13);
  assert.deepEqual([readSpec(values({ skipDone: true, onlyReview: true }), 1).skipDone, readSpec(values({ onlyReview: true }), 1).onlyReview], [true, true]);
});

test('the pool line says how many match and what the set will have', () => {
  assert.equal(poolMessage(312, 25), '312 questions match. The set will have 25.');
  assert.equal(poolMessage(25, 25), '25 questions match. The set will have 25.');
  assert.equal(poolMessage(12, 25), 'Only 12 questions match: the set will have all 12.');
  assert.equal(poolMessage(1, 10), 'Only 1 question matches: the set will have just that one.');
  assert.equal(poolMessage(0, 10), 'No questions match. Widen the filters.');
});

test('preselection reads slugs from the address, and nothing else', () => {
  assert.deepEqual(preselection('?subject=indian-polity&topic=parliament'), { subject: 'indian-polity', topic: 'parliament' });
  assert.deepEqual(preselection('?subject=geography'), { subject: 'geography', topic: null });
  assert.deepEqual(preselection('?topic=parliament'), { subject: null, topic: null });
  assert.deepEqual(preselection('?subject=<b>'), { subject: null, topic: null });
  assert.deepEqual(preselection(''), { subject: null, topic: null });
});
