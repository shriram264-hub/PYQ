import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEGAL, longDate } from '../src/lib/legal.js';

test('LEGAL carries every detail the legal pages and /account read', () => {
  assert.deepEqual(Object.keys(LEGAL).sort(), ['betaTerms', 'email', 'minAge', 'operator', 'place', 'replyDays', 'updated']);
  for (const key of ['operator', 'email', 'place', 'betaTerms']) {
    assert.equal(typeof LEGAL[key], 'string');
    assert.ok(LEGAL[key].trim().length > 0, `${key} is empty`);
  }
  assert.match(LEGAL.email, /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/);
  assert.match(LEGAL.updated, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isInteger(LEGAL.minAge) && LEGAL.minAge >= 18, 'accounts are for adults (DPDP Act: under 18 is a child)');
  assert.ok(Number.isInteger(LEGAL.replyDays) && LEGAL.replyDays > 0);
});

test('the beta terms are the owner’s words, unchanged', () => {
  assert.equal(
    LEGAL.betaTerms,
    "Free during the beta. Some features may later need a paid pass; we'll tell you before anything you use changes."
  );
});

test('LEGAL cannot be changed at runtime', () => {
  assert.ok(Object.isFrozen(LEGAL));
});

test('longDate spells a date out the way the pages print it', () => {
  assert.equal(longDate('2026-10-03'), '3 October 2026');
  assert.equal(longDate('2027-01-31'), '31 January 2027');
  assert.equal(longDate(LEGAL.updated), '3 October 2026');
});

test('longDate refuses anything that is not an ISO date', () => {
  for (const bad of ['3 October 2026', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-3', '']) {
    assert.throws(() => longDate(bad), /not an ISO date/, bad);
  }
});
