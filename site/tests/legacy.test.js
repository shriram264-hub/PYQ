import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinationOf, pagedDestination } from '../src/lib/legacy.js';

test('destination is where most questions went; ties go alphabetically', () => {
  assert.equal(destinationOf(new Map([['/b', 3], ['/a', 1]])), '/b');
  assert.equal(destinationOf(new Map([['/b', 2], ['/a', 2]])), '/a');
});

test('a page number survives only if the destination has that page', () => {
  assert.equal(pagedDestination(1, '/upsc/subject/x', 4), '/upsc/subject/x');
  assert.equal(pagedDestination(3, '/upsc/subject/x', 4), '/upsc/subject/x/3');
  assert.equal(pagedDestination(9, '/upsc/subject/x', 4), '/upsc/subject/x');
});
