import { test } from 'node:test';
import assert from 'node:assert/strict';
import { istDate, paywallStart, paymentsState, currentPayments, salesOpen, PAYMENTS } from '../src/lib/payments/switch.js';
import { passFor } from '../src/lib/passes.js';

test('istDate is the Asia/Kolkata calendar date', () => {
  assert.equal(istDate(new Date('2027-05-24T18:29:00Z')), '2027-05-24');
  assert.equal(istDate(new Date('2027-05-24T18:30:00Z')), '2027-05-25');
});

test('paywallStart is 00:00 IST on the date, or NaN when it is not a date', () => {
  assert.equal(paywallStart('2026-11-10'), Date.parse('2026-11-09T18:30:00Z'));
  assert.ok(Number.isNaN(paywallStart('2026-13-01')));
  assert.ok(Number.isNaN(paywallStart('')));
  assert.ok(Number.isNaN(paywallStart(undefined)));
});

const live = { from: '2026-11-10', keyId: 'rzp_live_X', allowTest: false };

test('with a live key, the notice runs until 00:00 IST on the start date, then payments are on', () => {
  const before = paymentsState(live, new Date('2026-11-09T18:29:59Z'));
  assert.deepEqual(before, { state: 'notice', from: '2026-11-10', mode: 'live', keyId: 'rzp_live_X' });
  const at = paymentsState(live, new Date('2026-11-09T18:30:00Z'));
  assert.equal(at.state, 'on');
  assert.equal(at.mode, 'live');
});

test('payments are off, with no mode, unless the date and a usable key are both set', () => {
  const now = new Date('2026-12-01T00:00:00Z');
  const cases = [
    { ...live, from: undefined },
    { ...live, from: '' },
    { ...live, from: '2026-13-01' },
    { ...live, keyId: undefined },
    { ...live, keyId: '' },
    { ...live, keyId: 'sk_something' },
    { ...live, keyId: 'rzp_test_X', allowTest: false },
  ];
  for (const c of cases) {
    const s = paymentsState(c, now);
    assert.equal(s.state, 'off', JSON.stringify(c));
    assert.equal(s.mode, null);
  }
});

test('a test key works only where allowTest is set, and then reports test mode', () => {
  const cfg = { from: '2026-11-10', keyId: 'rzp_test_X', allowTest: true };
  assert.equal(paymentsState(cfg, new Date('2026-11-09T18:29:59Z')).state, 'notice');
  const on = paymentsState(cfg, new Date('2026-11-09T18:30:00Z'));
  assert.equal(on.state, 'on');
  assert.equal(on.mode, 'test');
});

test('PAYMENTS reads cleanly under plain Node, which leaves payments off', () => {
  assert.equal(typeof PAYMENTS.allowTest, 'boolean');
  assert.equal(currentPayments(new Date('2026-12-01T00:00:00Z')).state, paymentsState(PAYMENTS, new Date('2026-12-01T00:00:00Z')).state);
});

test('sales of the upsc pass stay open through the whole of the Prelims day, India time', () => {
  const pass = passFor('upsc');
  assert.equal(salesOpen(pass, new Date('2027-05-23T18:29:59Z')), true);
  assert.equal(salesOpen(pass, new Date('2027-05-23T18:30:00Z')), false);
});
