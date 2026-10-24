import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSES, passFor } from '../src/lib/passes.js';
import { longDate } from '../src/lib/legal.js';

test('the UPSC Prelims pass is ₹499, valid to 2027-05-24, with four unlocks', () => {
  const pass = passFor('upsc');
  assert.equal(pass, PASSES.upsc);
  assert.equal(pass.price, 499);
  assert.equal(pass.priceLabel, '₹499');
  assert.equal(pass.validUntil, '2027-05-24');
  assert.equal(pass.unlocks.length, 4);
});

test('the pass ends the day after the Prelims and prints as the pages expect', () => {
  const pass = passFor('upsc');
  assert.equal(pass.prelimsDate, '2027-05-23');
  assert.equal(longDate(pass.validUntil), '24 May 2027');
  assert.equal(longDate(pass.prelimsDate), '23 May 2027');
});

test('the pass cannot be changed at runtime, and an unknown exam has none', () => {
  assert.ok(Object.isFrozen(PASSES) && Object.isFrozen(PASSES.upsc));
  assert.ok(Object.isFrozen(PASSES.upsc.unlocks) && Object.isFrozen(PASSES.upsc.free));
  assert.equal(passFor('nope'), undefined);
});
