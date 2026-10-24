import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  PASS_FACTS,
  istDate,
  modeOf,
  hmacHex,
  safeEqual,
  verifyCheckoutSignature,
  verifyWebhookSignature,
  corsHeaders,
  handle,
} from '../../supabase/functions/payments/index.js';
import { PASSES } from '../src/lib/passes.js';

// An obviously fake secret: real ones never appear in the repo.
const SECRET = 'test_secret_for_unit_tests';
const sign = (msg) => createHmac('sha256', SECRET).update(msg).digest('hex');

test('the server pass facts match site/src/lib/passes.js, with no extra exams', () => {
  assert.deepEqual(Object.keys(PASS_FACTS).sort(), Object.keys(PASSES).sort());
  for (const [exam, pass] of Object.entries(PASSES)) {
    const f = PASS_FACTS[exam];
    assert.ok(f, exam);
    assert.equal(f.amountPaise, pass.price * 100);
    assert.equal(f.currency, pass.currency);
    assert.equal(f.validUntil, pass.validUntil);
    assert.equal(f.salesClose, pass.salesClose);
    assert.equal(f.name, pass.name);
  }
  assert.ok(Object.isFrozen(PASS_FACTS));
});

test('verifyCheckoutSignature accepts the real HMAC and rejects anything else', async () => {
  const good = sign('order_ABC|pay_XYZ');
  const ok = (o) => verifyCheckoutSignature(o, SECRET);
  assert.equal(await ok({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: good }), true);
  const flipped = good.slice(0, -1) + (good.endsWith('0') ? '1' : '0');
  assert.equal(await ok({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: flipped }), false);
  assert.equal(await ok({ orderId: 'order_OTHER', paymentId: 'pay_XYZ', signature: good }), false);
  assert.equal(await ok({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: '' }), false);
  assert.equal(await ok({ orderId: 'order_ABC', paymentId: 'pay_XYZ', signature: good.toUpperCase() }), false);
});

test('verifyWebhookSignature checks the exact raw body', async () => {
  const body = '{"event":"payment.captured"}';
  const good = sign(body);
  assert.equal(await verifyWebhookSignature(body, good, SECRET), true);
  assert.equal(await verifyWebhookSignature('{"event": "payment.captured"}', good, SECRET), false);
  assert.equal(await verifyWebhookSignature(body, '', SECRET), false);
  assert.equal(await verifyWebhookSignature(body, good.toUpperCase(), SECRET), false);
  assert.equal(await verifyWebhookSignature(body, good, 'a_different_fake_secret'), false);
});

test('hmacHex is lowercase hex HMAC-SHA256', async () => {
  assert.equal(await hmacHex(SECRET, 'x'), sign('x'));
});

test('safeEqual is true only for identical strings', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
  assert.equal(safeEqual('abc', 'abd'), false);
  assert.equal(safeEqual('abc', 'abcd'), false);
  assert.equal(safeEqual('', ''), true);
});

test('modeOf reads the key id prefix; anything else is test', () => {
  assert.equal(modeOf('rzp_live_a'), 'live');
  assert.equal(modeOf('rzp_test_a'), 'test');
  assert.equal(modeOf(''), 'test');
});

test('istDate matches the site: the Asia/Kolkata calendar date', () => {
  assert.equal(istDate(new Date('2027-05-24T18:29:00Z')), '2027-05-24');
  assert.equal(istDate(new Date('2027-05-24T18:30:00Z')), '2027-05-25');
  assert.equal(istDate(new Date('2027-05-23T18:29:59Z')), '2027-05-23');
  assert.equal(istDate(new Date('2027-05-23T18:30:00Z')), '2027-05-24');
});

test('corsHeaders allows the live sites always and localhost only in test mode', () => {
  assert.equal(corsHeaders('http://localhost:4400', 'live')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('http://localhost:4400', 'test')['Access-Control-Allow-Origin'], 'http://localhost:4400');
  assert.equal(corsHeaders('http://127.0.0.1:4400', 'test')['Access-Control-Allow-Origin'], 'http://127.0.0.1:4400');
  assert.equal(corsHeaders('https://evil.example', 'test')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders('http://localhost.evil.example', 'test')['Access-Control-Allow-Origin'], undefined);
  assert.equal(corsHeaders(null, 'test')['Access-Control-Allow-Origin'], undefined);
  const h = corsHeaders('https://sawaalbox.in', 'live');
  assert.equal(h['Access-Control-Allow-Origin'], 'https://sawaalbox.in');
  assert.match(h['Access-Control-Allow-Headers'], /authorization, content-type/);
  assert.equal(
    corsHeaders('https://upsc-pyq-search-s778.onrender.com', 'live')['Access-Control-Allow-Origin'],
    'https://upsc-pyq-search-s778.onrender.com',
  );
});

test('importing the module under Node starts nothing, and handle is a 404 stub for now', async () => {
  assert.equal(typeof globalThis.Deno, 'undefined');
  const res = await handle(new Request('http://x/anything'), {});
  assert.equal(res.status, 404);
});
