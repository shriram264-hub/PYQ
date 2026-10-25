import { test } from 'node:test';
import assert from 'node:assert/strict';
import { paymentsCopy, paymentsState } from '../src/lib/payments/switch.js';

const live = { from: '2026-11-10', keyId: 'rzp_live_X', allowTest: false };

test('with payments off, the pages keep their beta copy', () => {
  const off = paymentsState({ from: '', keyId: '', allowTest: false }, new Date('2026-10-25T00:00:00Z'));
  assert.deepEqual(paymentsCopy(off), { phase: 'off', from: null, fromLabel: null });
});

test('in the notice, the pages say the date the paywall starts', () => {
  const notice = paymentsState(live, new Date('2026-11-01T00:00:00Z'));
  assert.equal(notice.state, 'notice');
  assert.deepEqual(paymentsCopy(notice), { phase: 'scheduled', from: '2026-11-10', fromLabel: '10 November 2026' });
});

test('once payments are on, the pages say the same thing, so a build from either side of the date is true', () => {
  const on = paymentsState(live, new Date('2026-11-20T00:00:00Z'));
  assert.equal(on.state, 'on');
  assert.deepEqual(paymentsCopy(on), { phase: 'scheduled', from: '2026-11-10', fromLabel: '10 November 2026' });
});

test('anything that is not a usable notice or on state reads as off', () => {
  for (const odd of [undefined, null, {}, { state: 'notice', from: '' }, { state: 'on', from: '2026-02-31' }, { state: 'later', from: '2026-11-10' }]) {
    assert.deepEqual(paymentsCopy(odd), { phase: 'off', from: null, fromLabel: null }, JSON.stringify(odd));
  }
});
