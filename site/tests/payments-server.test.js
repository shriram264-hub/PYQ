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
  envFrom,
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

test('importing the module under Node starts nothing', () => {
  assert.equal(typeof globalThis.Deno, 'undefined');
});

test('envFrom prefers the new default publishable/secret keys and falls back to the legacy ones', () => {
  const fake = (vars) => (name) => vars[name];
  const both = envFrom(
    fake({
      SUPABASE_URL: 'https://p.supabase.co',
      SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'sb_publishable_fake_default', other: 'sb_publishable_x' }),
      SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'sb_secret_fake_default' }),
      SUPABASE_ANON_KEY: 'legacy_anon_fake',
      SUPABASE_SERVICE_ROLE_KEY: 'legacy_service_fake',
      RAZORPAY_KEY_ID: 'rzp_test_fake',
      RAZORPAY_KEY_SECRET: 'test_secret_for_unit_tests',
      RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_for_unit_tests',
    }),
  );
  assert.deepEqual(both, {
    SUPABASE_URL: 'https://p.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_fake_default',
    SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_fake_default',
    RAZORPAY_KEY_ID: 'rzp_test_fake',
    RAZORPAY_KEY_SECRET: 'test_secret_for_unit_tests',
    RAZORPAY_WEBHOOK_SECRET: 'test_webhook_secret_for_unit_tests',
  });
  const legacy = envFrom(
    fake({ SUPABASE_PUBLISHABLE_KEYS: '{}', SUPABASE_SECRET_KEYS: 'not json', SUPABASE_ANON_KEY: 'a', SUPABASE_SERVICE_ROLE_KEY: 's' }),
  );
  assert.equal(legacy.SUPABASE_ANON_KEY, 'a');
  assert.equal(legacy.SUPABASE_SERVICE_ROLE_KEY, 's');
  const named = envFrom(fake({ SUPABASE_SECRET_KEYS: JSON.stringify({ mykey: 'sb_secret_only' }) }));
  assert.equal(named.SUPABASE_SERVICE_ROLE_KEY, 'sb_secret_only');
});

// ---------------------------------------------------------------------------
// Routes, against a fake world. deps.fetch is a small in-memory router standing
// in for Supabase Auth, PostgREST (with the table's real uniqueness rules) and
// Razorpay. Every value below is obviously fake.
// ---------------------------------------------------------------------------

const SB = 'https://fakeproject.supabase.co';
const ANON = 'sb_publishable_fake_for_unit_tests';
const SERVICE = 'sb_secret_fake_for_unit_tests';
const LEGACY_SERVICE = 'eyJfake.legacy.service_role_jwt_for_unit_tests';
const KEY_ID_LIVE = 'rzp_live_fakekeyforunittests';
const KEY_ID_TEST = 'rzp_test_fakekeyforunittests';
const WEBHOOK_SECRET = 'test_webhook_secret_for_unit_tests';
const UPSTREAM_DETAIL = 'upstream_private_detail_never_echoed';
const UA = '11111111-1111-4111-8111-111111111111';
const UB = '22222222-2222-4222-8222-222222222222';
const TOKENS = {
  'token-a': { id: UA, email: 'a@example.com' },
  'token-b': { id: UB, email: 'b@example.com' },
};
const NOW = new Date('2026-11-01T06:00:00Z');
const RZP = 'api.razorpay.com';

const tick = () => new Promise((r) => setImmediate(r));
const reply = (status, body) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function setup(t, { keyId = KEY_ID_LIVE, now = NOW, serviceKey = SERVICE } = {}) {
  const w = {
    passes: [],
    // auth.users, for the passes.user_id foreign key.
    users: new Set([UA, UB]),
    orders: new Map(),
    payments: new Map(),
    refunds: [],
    calls: [],
    seq: 0,
    // (method, path) => status | null: makes a Razorpay call fail.
    failRazorpay: null,
    logs: [],
  };
  const env = {
    SUPABASE_URL: SB,
    SUPABASE_ANON_KEY: ANON,
    SUPABASE_SERVICE_ROLE_KEY: serviceKey,
    RAZORPAY_KEY_ID: keyId,
    RAZORPAY_KEY_SECRET: SECRET,
    RAZORPAY_WEBHOOK_SECRET: WEBHOOK_SECRET,
  };

  const matches = (row, params) => {
    for (const [col, raw] of params) {
      if (['select', 'order', 'limit', 'on_conflict'].includes(col)) continue;
      const dot = raw.indexOf('.');
      const op = raw.slice(0, dot);
      const val = raw.slice(dot + 1);
      const have = row[col] === null || row[col] === undefined ? null : String(row[col]);
      if (op === 'eq' && have !== val) return false;
      else if (op === 'gte' && !(have !== null && have >= val)) return false;
      else if (op !== 'eq' && op !== 'gte') throw new Error(`fake PostgREST: unsupported op ${op}`);
    }
    return true;
  };

  async function postgrest(url, method, headers, body) {
    // The service key goes on apikey. A legacy JWT key also goes on
    // Authorization; a new sb_secret_ key must not.
    if (headers.get('apikey') !== serviceKey) return reply(401, { message: 'bad key' });
    const authz = headers.get('authorization');
    if (serviceKey.startsWith('sb_') ? authz !== null : authz !== `Bearer ${serviceKey}`) {
      return reply(401, { message: 'bad authorization' });
    }
    const params = [...url.searchParams];
    const prefer = headers.get('prefer') ?? '';
    if (method === 'GET') {
      await tick();
      const limit = Number(url.searchParams.get('limit') ?? Infinity);
      return reply(200, w.passes.filter((r) => matches(r, params)).slice(0, limit).map((r) => ({ ...r })));
    }
    if (method === 'POST') {
      await tick();
      // The table's checks.
      const ok =
        /^[a-z]+$/.test(body.exam) &&
        ['test', 'live'].includes(body.mode) &&
        ['active', 'refunded'].includes(body.status) &&
        Number.isInteger(body.amount_paise) &&
        body.amount_paise > 0 &&
        typeof body.payment_id === 'string' &&
        typeof body.order_id === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(body.valid_until);
      if (!ok) return reply(400, { code: '23514', message: 'check violation' });
      // user_id references auth.users (PostgREST maps 23503 to 409).
      if (body.user_id && !w.users.has(body.user_id)) {
        return reply(409, { code: '23503', message: 'insert or update violates foreign key constraint' });
      }
      // payment_id is unique.
      if (w.passes.some((r) => r.payment_id === body.payment_id)) {
        if (url.searchParams.get('on_conflict') === 'payment_id' && prefer.includes('resolution=ignore-duplicates')) {
          return reply(201, prefer.includes('return=representation') ? [] : undefined);
        }
        return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint "passes_payment_id_key"' });
      }
      // passes_one_active: one active row per (user_id, exam, mode, valid_until).
      if (
        body.status === 'active' &&
        body.user_id &&
        w.passes.some(
          (r) =>
            r.status === 'active' &&
            r.user_id === body.user_id &&
            r.exam === body.exam &&
            r.mode === body.mode &&
            r.valid_until === body.valid_until,
        )
      ) {
        return reply(409, { code: '23505', message: 'duplicate key value violates unique constraint "passes_one_active"' });
      }
      const row = {
        id: `row_${++w.seq}`,
        note: null,
        refunded_at: null,
        created_at: new Date().toISOString(),
        ...body,
      };
      w.passes.push(row);
      return reply(201, prefer.includes('return=representation') ? [{ ...row }] : undefined);
    }
    if (method === 'PATCH') {
      await tick();
      for (const r of w.passes) if (matches(r, params)) Object.assign(r, body);
      return reply(204);
    }
    return reply(405, {});
  }

  async function razorpay(url, method, headers, body) {
    if (headers.get('authorization') !== `Basic ${btoa(`${keyId}:${SECRET}`)}`) {
      return reply(401, { error: { code: 'BAD_REQUEST_ERROR', description: 'auth' } });
    }
    const path = url.pathname.replace(/^\/v1/, '');
    const fail = w.failRazorpay && w.failRazorpay(method, path);
    if (fail) return reply(fail, { error: { code: 'SERVER_ERROR', description: UPSTREAM_DETAIL } });
    const bad = () => reply(400, { error: { code: 'BAD_REQUEST_ERROR', description: UPSTREAM_DETAIL } });
    let m;
    if (method === 'POST' && path === '/orders') {
      const order = {
        id: `order_T${++w.seq}`,
        entity: 'order',
        amount: body.amount,
        amount_paid: 0,
        currency: body.currency,
        receipt: body.receipt,
        notes: body.notes ?? [],
        status: 'created',
      };
      w.orders.set(order.id, order);
      return reply(200, order);
    }
    if (method === 'GET' && (m = /^\/orders\/([^/]+)$/.exec(path))) {
      const o = w.orders.get(m[1]);
      return o ? reply(200, structuredClone(o)) : bad();
    }
    if (method === 'GET' && (m = /^\/payments\/([^/]+)$/.exec(path))) {
      const p = w.payments.get(m[1]);
      return p ? reply(200, structuredClone(p)) : bad();
    }
    if (method === 'POST' && (m = /^\/payments\/([^/]+)\/capture$/.exec(path))) {
      const p = w.payments.get(m[1]);
      if (!p || p.status !== 'authorized' || body.amount !== p.amount || body.currency !== p.currency) return bad();
      p.status = 'captured';
      p.captured = true;
      return reply(200, structuredClone(p));
    }
    if (method === 'POST' && (m = /^\/payments\/([^/]+)\/refund$/.exec(path))) {
      const p = w.payments.get(m[1]);
      const amount = body.amount ?? (p && p.amount - p.amount_refunded);
      if (!p || p.status !== 'captured' || amount > p.amount - p.amount_refunded) return bad();
      p.amount_refunded += amount;
      if (p.amount_refunded === p.amount) p.status = 'refunded';
      const refund = {
        id: `rfnd_T${++w.seq}`,
        entity: 'refund',
        amount,
        currency: p.currency,
        payment_id: p.id,
        notes: body.notes ?? [],
        status: 'processed',
      };
      w.refunds.push(refund);
      return reply(200, refund);
    }
    return bad();
  }

  w.deps = {
    env,
    now: () => new Date(now.getTime()),
    fetch: async (input, init = {}) => {
      const url = new URL(String(input));
      const method = (init.method ?? 'GET').toUpperCase();
      const headers = new Headers(init.headers);
      const body = init.body ? JSON.parse(init.body) : undefined;
      w.calls.push({ host: url.host, path: url.pathname, search: url.search, method, headers, body });
      await tick();
      if (url.origin === SB && url.pathname === '/auth/v1/user') {
        if (headers.get('apikey') !== ANON) return reply(401, { message: 'no apikey' });
        const user = TOKENS[(headers.get('authorization') ?? '').replace(/^Bearer /, '')];
        return user ? reply(200, { ...user, aud: 'authenticated' }) : reply(403, { code: 'bad_jwt' });
      }
      if (url.origin === SB && url.pathname === '/rest/v1/passes') return postgrest(url, method, headers, body);
      if (url.host === RZP) return razorpay(url, method, headers, body);
      throw new Error(`fake fetch: unexpected ${method} ${url}`);
    },
  };

  w.addOrder = ({ amount = 49900, currency = 'INR', notes = [] } = {}) => {
    const id = `order_T${++w.seq}`;
    w.orders.set(id, { id, entity: 'order', amount, amount_paid: 0, currency, notes, status: 'created' });
    return id;
  };
  w.pay = (orderId, { amount, currency, status = 'captured' } = {}) => {
    const o = w.orders.get(orderId);
    const id = `pay_T${++w.seq}`;
    w.payments.set(id, {
      id,
      entity: 'payment',
      amount: amount ?? o.amount,
      currency: currency ?? o.currency,
      status,
      order_id: orderId,
      captured: status === 'captured',
      amount_refunded: 0,
      notes: [],
    });
    return id;
  };
  w.rzCalls = () => w.calls.filter((c) => c.host === RZP);
  w.inserts = () => w.calls.filter((c) => c.path === '/rest/v1/passes' && c.method === 'POST');
  w.writes = () => w.calls.filter((c) => c.path === '/rest/v1/passes' && c.method !== 'GET');

  // Logs are captured, and must never carry a secret or an upstream body.
  t.mock.method(console, 'error', (...args) => w.logs.push(args.map(String).join(' ')));
  t.mock.method(console, 'log', (...args) => w.logs.push(args.map(String).join(' ')));
  t.after(() => {
    const all = w.logs.join('\n');
    for (const s of [SECRET, WEBHOOK_SECRET, SERVICE, LEGACY_SERVICE, ANON, 'token-a', 'token-b', UPSTREAM_DETAIL]) {
      assert.ok(!all.includes(s), `a log line leaked ${s}`);
    }
  });
  return w;
}

const fnUrl = (route) => `${SB}/functions/v1/payments/${route}`;

function post(route, body, token, extra = {}) {
  const headers = { 'content-type': 'application/json', origin: 'https://sawaalbox.in', ...extra };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(fnUrl(route), { method: 'POST', headers, body: JSON.stringify(body) });
}

const confirmBody = (orderId, paymentId, exam = 'upsc') => ({
  exam,
  orderId,
  paymentId,
  signature: sign(`${orderId}|${paymentId}`),
});

function webhookReq(event, signature) {
  const raw = JSON.stringify(event);
  const sig = signature ?? createHmac('sha256', WEBHOOK_SECRET).update(raw).digest('hex');
  return new Request(fnUrl('webhook'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
    body: raw,
  });
}

const paymentEvent = (w, paymentId, event) => ({
  entity: 'event',
  account_id: 'acc_FAKE',
  event,
  contains: ['payment'],
  payload: { payment: { entity: structuredClone(w.payments.get(paymentId)) } },
  created_at: 1793512800,
});
const capturedEvent = (w, paymentId) => paymentEvent(w, paymentId, 'payment.captured');
// payment.authorized carries payload.payment.entity like payment.captured
// (https://razorpay.com/docs/webhooks/payments/). It is the only event that
// arrives when automatic capture is off in the Razorpay dashboard.
const authorizedEvent = (w, paymentId) => paymentEvent(w, paymentId, 'payment.authorized');

const refundEvent = (paymentId) => ({
  entity: 'event',
  account_id: 'acc_FAKE',
  event: 'refund.created',
  contains: ['refund', 'payment'],
  payload: {
    refund: { entity: { id: 'rfnd_FAKE1', entity: 'refund', amount: 49900, currency: 'INR', payment_id: paymentId } },
    payment: { entity: { id: paymentId, entity: 'payment', amount: 49900, currency: 'INR' } },
  },
  created_at: 1793512800,
});

async function call(w, req) {
  const res = await handle(req, w.deps);
  const text = await res.text();
  return { status: res.status, headers: res.headers, body: text ? JSON.parse(text) : null, text };
}

/** Create an order through the route, then pay it in the fake. */
async function buy(w, token = 'token-a', payOpts) {
  const r = await call(w, post('create-order', { exam: 'upsc' }, token));
  assert.equal(r.status, 200, r.text);
  return { orderId: r.body.orderId, paymentId: w.pay(r.body.orderId, payOpts) };
}

// --- plumbing ---

test('OPTIONS is 204 with CORS, and an unknown path is 404', async (t) => {
  const w = setup(t);
  const pre = await handle(
    new Request(fnUrl('create-order'), { method: 'OPTIONS', headers: { origin: 'https://sawaalbox.in' } }),
    w.deps,
  );
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), 'https://sawaalbox.in');
  assert.match(pre.headers.get('access-control-allow-headers'), /authorization/);
  const nf = await call(w, post('nope', {}, 'token-a'));
  assert.equal(nf.status, 404);
  assert.equal(nf.body.error, 'not_found');
  assert.equal(nf.headers.get('access-control-allow-origin'), 'https://sawaalbox.in');
  assert.equal(w.calls.length, 0);
});

// --- create-order ---

test('create-order: signed out is 401', async (t) => {
  const w = setup(t);
  const none = await call(w, post('create-order', { exam: 'upsc' }));
  assert.equal(none.status, 401);
  assert.equal(none.body.error, 'not_signed_in');
  assert.equal(none.headers.get('access-control-allow-origin'), 'https://sawaalbox.in');
  const bad = await call(w, post('create-order', { exam: 'upsc' }, 'token-unknown'));
  assert.equal(bad.status, 401);
  assert.equal(w.rzCalls().length, 0);
});

test('create-order: an unknown exam is 400', async (t) => {
  const w = setup(t);
  for (const exam of ['nope', 'constructor', '__proto__', undefined]) {
    const r = await call(w, post('create-order', { exam }, 'token-a'));
    assert.equal(r.status, 400, String(exam));
    assert.equal(r.body.error, 'unknown_exam');
  }
  assert.equal(w.rzCalls().length, 0);
});

test('create-order: after the salesClose day (IST) is 410', async (t) => {
  const open = setup(t, { now: new Date('2027-05-23T18:29:59Z') });
  assert.equal((await call(open, post('create-order', { exam: 'upsc' }, 'token-a'))).status, 200);
  const w = setup(t, { now: new Date('2027-05-23T18:30:00Z') });
  const r = await call(w, post('create-order', { exam: 'upsc' }, 'token-a'));
  assert.equal(r.status, 410);
  assert.equal(r.body.error, 'sales_closed');
  assert.equal(w.rzCalls().length, 0);
});

test('create-order: an existing active pass in this mode is 409 with validUntil', async (t) => {
  const w = setup(t);
  w.passes.push({ user_id: UA, exam: 'upsc', mode: 'live', status: 'active', valid_until: '2027-05-24', payment_id: 'pay_OLD' });
  const r = await call(w, post('create-order', { exam: 'upsc' }, 'token-a'));
  assert.equal(r.status, 409);
  assert.deepEqual(r.body, { error: 'already_active', validUntil: '2027-05-24' });
  assert.equal(w.rzCalls().length, 0);
});

test('create-order: an active test pass does not block a live purchase (modes are apart)', async (t) => {
  const w = setup(t);
  w.passes.push({ user_id: UA, exam: 'upsc', mode: 'test', status: 'active', valid_until: '2027-05-24', payment_id: 'pay_OLD' });
  const r = await call(w, post('create-order', { exam: 'upsc' }, 'token-a'));
  assert.equal(r.status, 200, r.text);
});

test('create-order: a refunded or expired pass does not block', async (t) => {
  const w = setup(t);
  w.passes.push({ user_id: UA, exam: 'upsc', mode: 'live', status: 'refunded', valid_until: '2027-05-24', payment_id: 'pay_R' });
  assert.equal((await call(w, post('create-order', { exam: 'upsc' }, 'token-a'))).status, 200);
  // Active through the whole of its last day (IST), not after.
  const day = { user_id: UA, exam: 'upsc', mode: 'live', status: 'active', valid_until: '2026-11-01', payment_id: 'pay_D' };
  const last = setup(t, { now: new Date('2026-11-01T18:29:59Z') });
  last.passes.push({ ...day });
  assert.equal((await call(last, post('create-order', { exam: 'upsc' }, 'token-a'))).status, 409);
  const after = setup(t, { now: new Date('2026-11-01T18:30:00Z') });
  after.passes.push({ ...day });
  assert.equal((await call(after, post('create-order', { exam: 'upsc' }, 'token-a'))).status, 200);
});

test('create-order: success asks Razorpay for the server amount, never the browser one', async (t) => {
  const w = setup(t);
  const r = await call(w, post('create-order', { exam: 'upsc', amount: 1, currency: 'USD' }, 'token-a'));
  assert.equal(r.status, 200, r.text);
  const orderCalls = w.rzCalls().filter((c) => c.method === 'POST' && c.path === '/v1/orders');
  assert.equal(orderCalls.length, 1);
  const sent = orderCalls[0].body;
  assert.equal(sent.amount, 49900);
  assert.equal(sent.currency, 'INR');
  assert.deepEqual(sent.notes, { user_id: UA, exam: 'upsc' });
  assert.match(sent.receipt, /^upsc-11111111-\d+$/);
  assert.ok(sent.receipt.length <= 40);
  assert.deepEqual(r.body, {
    orderId: [...w.orders.keys()][0],
    amount: 49900,
    currency: 'INR',
    keyId: KEY_ID_LIVE,
    name: 'UPSC Prelims pass',
    validUntil: '2027-05-24',
  });
  // The key secret never leaves the server.
  assert.ok(!r.text.includes(SECRET));
});

test('create-order: a Razorpay failure is 502 and leaks nothing upstream', async (t) => {
  const w = setup(t);
  w.failRazorpay = () => 500;
  const r = await call(w, post('create-order', { exam: 'upsc' }, 'token-a'));
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: 'razorpay' });
  assert.ok(!r.text.includes(UPSTREAM_DETAIL));
  assert.ok(w.logs.length >= 1);
});

test('the service key goes on apikey only for sb_secret_ keys, and on Bearer too for a legacy JWT', async (t) => {
  const neu = setup(t);
  assert.equal((await call(neu, post('create-order', { exam: 'upsc' }, 'token-a'))).status, 200);
  const rest = neu.calls.find((c) => c.path === '/rest/v1/passes');
  assert.equal(rest.headers.get('apikey'), SERVICE);
  assert.equal(rest.headers.get('authorization'), null);
  const old = setup(t, { serviceKey: LEGACY_SERVICE });
  assert.equal((await call(old, post('create-order', { exam: 'upsc' }, 'token-a'))).status, 200);
  const r2 = old.calls.find((c) => c.path === '/rest/v1/passes');
  assert.equal(r2.headers.get('authorization'), `Bearer ${LEGACY_SERVICE}`);
  // Auth uses the publishable key plus the caller's own token.
  const auth = neu.calls.find((c) => c.path === '/auth/v1/user');
  assert.equal(auth.headers.get('apikey'), ANON);
  assert.equal(auth.headers.get('authorization'), 'Bearer token-a');
});

// --- confirm ---

test('confirm: a bad signature is 400 with no Razorpay calls', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  const before = w.rzCalls().length;
  const body = confirmBody(orderId, paymentId);
  const flipped = body.signature.slice(0, -1) + (body.signature.endsWith('0') ? '1' : '0');
  for (const b of [
    { ...body, signature: flipped },
    { ...body, signature: '' },
    { ...body, paymentId: 'pay_OTHER' },
    { exam: 'upsc', orderId, paymentId },
  ]) {
    const r = await call(w, post('confirm', b, 'token-a'));
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'bad_signature');
  }
  assert.equal(w.rzCalls().length, before);
  assert.equal(w.inserts().length, 0);
});

test('confirm: signed out is 401', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  const r = await call(w, post('confirm', confirmBody(orderId, paymentId)));
  assert.equal(r.status, 401);
  assert.equal(w.inserts().length, 0);
});

const captures = (w) => w.rzCalls().filter((c) => c.path.endsWith('/capture'));

for (const status of ['captured', 'authorized']) {
  test(`confirm: another user's order is 403, inserts nothing and captures nothing (${status})`, async (t) => {
    const w = setup(t);
    const { orderId, paymentId } = await buy(w, 'token-b', { status });
    const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'not_your_order');
    assert.equal(w.inserts().length, 0);
    assert.equal(w.passes.length, 0);
    assert.equal(captures(w).length, 0);
    assert.equal(w.payments.get(paymentId).status, status);
  });

  test(`confirm: an order without our notes is 403, inserts nothing and captures nothing (${status})`, async (t) => {
    const w = setup(t);
    const orderId = w.addOrder({ notes: [] });
    const paymentId = w.pay(orderId, { status });
    const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
    assert.equal(r.status, 403);
    assert.equal(w.inserts().length, 0);
    assert.equal(captures(w).length, 0);
  });
}

for (const status of ['captured', 'authorized']) {
  test(`confirm: a payment of the wrong amount, currency or order is 422, inserts and captures nothing (${status})`, async (t) => {
    const w = setup(t);
    const a = await buy(w, 'token-a', { amount: 100, status });
    const r = await call(w, post('confirm', confirmBody(a.orderId, a.paymentId), 'token-a'));
    assert.equal(r.status, 422);
    assert.equal(r.body.error, 'payment_mismatch');

    const b = await buy(w, 'token-a', { currency: 'USD', status });
    assert.equal((await call(w, post('confirm', confirmBody(b.orderId, b.paymentId), 'token-a'))).status, 422);

    // An order made for a different amount (not by us) fails too.
    const cheap = w.addOrder({ amount: 100, notes: { user_id: UA, exam: 'upsc' } });
    const cp = w.pay(cheap, { status });
    assert.equal((await call(w, post('confirm', confirmBody(cheap, cp), 'token-a'))).status, 422);

    // A payment that belongs to another order, signed as if it were this one.
    const c = await buy(w, 'token-a', { status });
    const otherOrder = w.addOrder({ notes: { user_id: UA, exam: 'upsc' } });
    const r2 = await call(w, post('confirm', confirmBody(otherOrder, c.paymentId), 'token-a'));
    assert.equal(r2.status, 422);

    assert.equal(w.inserts().length, 0);
    assert.equal(captures(w).length, 0);
    for (const p of w.payments.values()) assert.equal(p.status, status);
  });
}

test('confirm: an unknown exam in the body is refused before any Razorpay call', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  const before = w.rzCalls().length;
  const r = await call(w, post('confirm', confirmBody(orderId, paymentId, 'nope'), 'token-a'));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'unknown_exam');
  assert.equal(w.rzCalls().length, before);
  assert.equal(w.inserts().length, 0);
});

test('confirm: a payment that is not captured is 409 and inserts nothing', async (t) => {
  const w = setup(t);
  for (const status of ['failed', 'created']) {
    const { orderId, paymentId } = await buy(w, 'token-a', { status });
    const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
    assert.equal(r.status, 409, status);
    assert.equal(r.body.error, 'not_captured');
  }
  assert.equal(w.inserts().length, 0);
});

test('confirm: an authorized payment is captured for the server amount, then switched on', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w, 'token-a', { status: 'authorized' });
  const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(r.status, 200, r.text);
  const cap = w.rzCalls().filter((c) => c.path === `/v1/payments/${paymentId}/capture`);
  assert.equal(cap.length, 1);
  assert.deepEqual(cap[0].body, { amount: 49900, currency: 'INR' });
  assert.equal(w.passes.length, 1);
});

test('confirm: success writes one live row valid until 2027-05-24', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { pass: { exam: 'upsc', validUntil: '2027-05-24', status: 'active' } });
  assert.equal(r.headers.get('access-control-allow-origin'), 'https://sawaalbox.in');
  assert.equal(w.passes.length, 1);
  const row = w.passes[0];
  assert.equal(row.user_id, UA);
  assert.equal(row.exam, 'upsc');
  assert.equal(row.mode, 'live');
  assert.equal(row.valid_until, '2027-05-24');
  assert.equal(row.payment_id, paymentId);
  assert.equal(row.order_id, orderId);
  assert.equal(row.amount_paise, 49900);
  assert.equal(row.status, 'active');
  assert.match(w.inserts()[0].headers.get('prefer'), /return=representation/);
});

test('confirm: a test key writes a test-mode row', async (t) => {
  const w = setup(t, { keyId: KEY_ID_TEST });
  const { orderId, paymentId } = await buy(w);
  assert.equal((await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'))).status, 200);
  assert.equal(w.passes[0].mode, 'test');
});

test('confirm: a Razorpay failure is 502, a database failure is 500, neither leaks', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  w.failRazorpay = (method, path) => (path.startsWith('/payments/') ? 503 : null);
  const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(r.status, 502);
  assert.deepEqual(r.body, { error: 'razorpay' });
  assert.ok(!r.text.includes(UPSTREAM_DETAIL));
  assert.equal(w.passes.length, 0);

  const d = setup(t);
  const p = await buy(d);
  d.deps.env = { ...d.deps.env, SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_wrong_for_unit_tests' };
  const r2 = await call(d, post('confirm', confirmBody(p.orderId, p.paymentId), 'token-a'));
  assert.equal(r2.status, 500);
  assert.ok(!r2.text.includes('sb_secret_wrong_for_unit_tests'));
});

// --- idempotency ---

test('idempotency: confirm then webhook makes one row', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  assert.equal((await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'))).status, 200);
  const hook = await call(w, webhookReq(capturedEvent(w, paymentId)));
  assert.equal(hook.status, 200);
  assert.deepEqual(hook.body, { ok: true });
  assert.equal(w.passes.length, 1);
  assert.equal(w.refunds.length, 0);
});

test('idempotency: webhook then confirm makes one row, and confirm returns the pass', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  assert.equal(w.passes.length, 1);
  assert.equal(w.passes[0].user_id, UA);
  const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { pass: { exam: 'upsc', validUntil: '2027-05-24', status: 'active' } });
  assert.equal(w.passes.length, 1);
  assert.equal(w.refunds.length, 0);
});

test('idempotency: two parallel confirms make one row and both return the pass', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  const [a, b] = await Promise.all([
    call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a')),
    call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a')),
  ]);
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  assert.deepEqual(a.body, b.body);
  assert.equal(w.passes.length, 1);
  // Both really raced: each tried to insert.
  assert.equal(w.inserts().length, 2);
  assert.equal(w.refunds.length, 0);
});

test('idempotency: confirm and webhook racing make one row', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  const [a, b] = await Promise.all([
    call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a')),
    call(w, webhookReq(capturedEvent(w, paymentId))),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(w.passes.length, 1);
  assert.equal(w.refunds.length, 0);
});

test('idempotency: two parallel authorized confirms capture once and make one row', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w, 'token-a', { status: 'authorized' });
  const [a, b] = await Promise.all([
    call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a')),
    call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a')),
  ]);
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  assert.equal(w.passes.length, 1);
});

// --- duplicates ---

test('duplicate: a second paid order is refunded in full, recorded, and the first pass is untouched', async (t) => {
  const w = setup(t);
  // Two tabs: both orders are made before either is paid.
  const one = await buy(w);
  const two = await buy(w);
  const first = await call(w, post('confirm', confirmBody(one.orderId, one.paymentId), 'token-a'));
  assert.equal(first.status, 200);
  const snapshot = structuredClone(w.passes[0]);

  const r = await call(w, post('confirm', confirmBody(two.orderId, two.paymentId), 'token-a'));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { duplicate: true });

  const refundCalls = w.rzCalls().filter((c) => c.path.endsWith('/refund'));
  assert.equal(refundCalls.length, 1);
  assert.equal(refundCalls[0].path, `/v1/payments/${two.paymentId}/refund`);
  assert.equal(refundCalls[0].body.amount, 49900);
  assert.deepEqual(refundCalls[0].body.notes, { reason: 'duplicate' });

  assert.equal(w.passes.length, 2);
  assert.deepEqual(w.passes[0], snapshot);
  const dup = w.passes.find((p) => p.payment_id === two.paymentId);
  assert.equal(dup.status, 'refunded');
  assert.equal(dup.note, 'duplicate');
  assert.equal(dup.refunded_at, NOW.toISOString());
  assert.equal(dup.user_id, UA);
  const last = w.inserts().at(-1);
  assert.match(last.search, /on_conflict=payment_id/);
  assert.match(last.headers.get('prefer'), /resolution=ignore-duplicates/);

  // Seen again (confirm retry, then the webhook): still one refund, no new rows.
  const again = await call(w, post('confirm', confirmBody(two.orderId, two.paymentId), 'token-a'));
  assert.equal(again.status, 200);
  assert.deepEqual(again.body, { duplicate: true });
  assert.equal((await call(w, webhookReq(capturedEvent(w, two.paymentId)))).status, 200);
  assert.equal(w.rzCalls().filter((c) => c.path.endsWith('/refund')).length, 1);
  assert.equal(w.passes.length, 2);
});

test('duplicate: confirm and webhook racing on a duplicate refund once and make one record', async (t) => {
  const w = setup(t);
  const one = await buy(w);
  const two = await buy(w);
  await call(w, post('confirm', confirmBody(one.orderId, one.paymentId), 'token-a'));
  const [a, b] = await Promise.all([
    call(w, post('confirm', confirmBody(two.orderId, two.paymentId), 'token-a')),
    call(w, webhookReq(capturedEvent(w, two.paymentId))),
  ]);
  assert.equal(a.status, 200, a.text);
  assert.deepEqual(a.body, { duplicate: true });
  assert.equal(b.status, 200);
  assert.equal(w.refunds.length, 1);
  assert.equal(w.passes.filter((p) => p.payment_id === two.paymentId).length, 1);
  assert.equal(w.passes.filter((p) => p.status === 'active').length, 1);
});

test('duplicate: an expired pass still marked active does not make a new purchase a duplicate', async (t) => {
  const w = setup(t);
  // Last cycle's pass: never switched off, but its valid_until has passed (IST).
  w.passes.push({
    id: 'row_old',
    user_id: UA,
    exam: 'upsc',
    mode: 'live',
    status: 'active',
    valid_until: '2026-10-31',
    payment_id: 'pay_OLDCYCLE',
    order_id: 'order_OLDCYCLE',
    amount_paise: 49900,
    note: null,
    refunded_at: null,
  });
  const one = await buy(w);
  const r = await call(w, post('confirm', confirmBody(one.orderId, one.paymentId), 'token-a'));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { pass: { exam: 'upsc', validUntil: '2027-05-24', status: 'active' } });
  assert.equal(w.passes.filter((p) => p.status === 'active').length, 2);
  assert.equal(w.passes.find((p) => p.payment_id === one.paymentId).status, 'active');
  assert.equal(w.refunds.length, 0);
  assert.equal(w.rzCalls().filter((c) => c.path.endsWith('/refund')).length, 0);
});

test('duplicate: an expired pass still marked active does not trigger a refund via the webhook either', async (t) => {
  const w = setup(t);
  w.passes.push({
    id: 'row_old',
    user_id: UA,
    exam: 'upsc',
    mode: 'live',
    status: 'active',
    valid_until: '2026-10-31',
    payment_id: 'pay_OLDCYCLE',
    order_id: 'order_OLDCYCLE',
    amount_paise: 49900,
    note: null,
    refunded_at: null,
  });
  const { paymentId } = await buy(w);
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  assert.equal(w.passes.find((p) => p.payment_id === paymentId).status, 'active');
  assert.equal(w.refunds.length, 0);
});

// 23:59:59 IST on 24 May 2027, the pass's last day, and 00:00 IST the day after.
const LAST_MOMENT = new Date('2027-05-24T18:29:59Z');
const AFTER_END = new Date('2027-05-24T18:30:00Z');

test('duplicate: a clash with no active unexpired pass is never refunded; it is retried instead', async (t) => {
  // An active row with the same valid_until clashes in the index. If the day
  // turns between the late-payment check (still the last day) and the clash
  // check (the day after), the old pass is no longer active today. That is
  // not a duplicate purchase: no refund, and a server error so Razorpay
  // retries (and the owner gets the alert email).
  const w = setup(t);
  let reads = 0;
  // Each request reads the clock twice: the late check, then the clash check.
  w.deps.now = () => new Date((reads++ % 2 === 0 ? LAST_MOMENT : AFTER_END).getTime());
  w.passes.push({
    id: 'row_old',
    user_id: UA,
    exam: 'upsc',
    mode: 'live',
    status: 'active',
    valid_until: '2027-05-24',
    payment_id: 'pay_OLD',
    order_id: 'order_OLD',
    amount_paise: 49900,
    note: null,
    refunded_at: null,
  });
  const orderId = w.addOrder({ notes: { user_id: UA, exam: 'upsc' } });
  const paymentId = w.pay(orderId);
  const hook = await call(w, webhookReq(capturedEvent(w, paymentId)));
  assert.equal(hook.status, 500);
  const conf = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(conf.status, 500);
  assert.deepEqual(conf.body, { error: 'server' });
  assert.equal(w.rzCalls().filter((c) => c.path.endsWith('/refund')).length, 0);
  assert.equal(w.passes.length, 1);
  assert.equal(w.payments.get(paymentId).status, 'captured');
  assert.ok(w.logs.some((l) => l.includes('no_active_pass')));

  // The next retry, now plainly after the pass's last day, settles it as late.
  w.deps.now = () => new Date(AFTER_END.getTime());
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  assert.equal(w.refunds.length, 1);
  assert.equal(w.payments.get(paymentId).status, 'refunded');
  const late = w.passes.find((p) => p.payment_id === paymentId);
  assert.equal(late.status, 'refunded');
  assert.equal(late.note, 'expired');
  assert.equal(w.passes.find((p) => p.payment_id === 'pay_OLD').status, 'active');
});

// --- late: a payment that settles after the pass has ended ---

// An order made by create-order before sales closed (the route itself is
// closed by now, so the fake order is added directly).
const lateOrder = (w) => w.addOrder({ notes: { user_id: UA, exam: 'upsc' } });
const refundCalls = (w) => w.rzCalls().filter((c) => c.path.endsWith('/refund'));

function assertRefundedAsExpired(w, paymentId, { attempts = 1 } = {}) {
  const calls = refundCalls(w);
  assert.equal(calls.length, attempts);
  assert.ok(calls.every((c) => c.path === `/v1/payments/${paymentId}/refund`));
  assert.ok(calls.every((c) => c.body.amount === 49900));
  for (const c of calls) assert.deepEqual(c.body.notes, { reason: 'expired' });
  assert.equal(w.refunds.length, 1);
  assert.equal(w.payments.get(paymentId).status, 'refunded');
  assert.equal(w.passes.length, 1);
  const row = w.passes[0];
  assert.equal(row.payment_id, paymentId);
  assert.equal(row.user_id, UA);
  assert.equal(row.exam, 'upsc');
  assert.equal(row.mode, 'live');
  assert.equal(row.valid_until, '2027-05-24');
  assert.equal(row.amount_paise, 49900);
  assert.equal(row.status, 'refunded');
  assert.equal(row.note, 'expired');
  assert.equal(row.refunded_at, AFTER_END.toISOString());
  assert.equal(w.passes.filter((p) => p.status === 'active').length, 0);
}

test('late: a payment confirmed after the pass has ended is refunded in full, recorded, and switches nothing on', async (t) => {
  const w = setup(t, { now: AFTER_END });
  const orderId = lateOrder(w);
  const paymentId = w.pay(orderId);
  const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { expired: true });
  assertRefundedAsExpired(w, paymentId);
  const last = w.inserts().at(-1);
  assert.match(last.search, /on_conflict=payment_id/);
  assert.match(last.headers.get('prefer'), /resolution=ignore-duplicates/);

  // Seen again (a confirm retry, then the webhook): no second refund or row.
  const again = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(again.status, 200, again.text);
  assert.deepEqual(again.body, { expired: true });
  const hook = await call(w, webhookReq(capturedEvent(w, paymentId)));
  assert.equal(hook.status, 200);
  assert.deepEqual(hook.body, { ok: true });
  assertRefundedAsExpired(w, paymentId);
});

test('late: the webhook after the pass has ended refunds once, records it, and answers 200', async (t) => {
  const w = setup(t, { now: AFTER_END });
  const orderId = lateOrder(w);
  const paymentId = w.pay(orderId);
  const captured = capturedEvent(w, paymentId); // the payload as captured
  const r = await call(w, webhookReq(captured));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true });
  assertRefundedAsExpired(w, paymentId);

  // At-least-once delivery, then the student's page confirms late.
  assert.equal((await call(w, webhookReq(captured))).status, 200);
  const conf = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(conf.status, 200, conf.text);
  assert.deepEqual(conf.body, { expired: true });
  assertRefundedAsExpired(w, paymentId);
});

test('late: an authorized payment after the pass has ended is captured once, then refunded in full', async (t) => {
  const w = setup(t, { now: AFTER_END });
  const paymentId = w.pay(lateOrder(w), { status: 'authorized' });
  const authorized = authorizedEvent(w, paymentId);
  assert.equal((await call(w, webhookReq(authorized))).status, 200);
  assert.equal(captures(w).length, 1);
  assertRefundedAsExpired(w, paymentId);
  assert.equal((await call(w, webhookReq(authorized))).status, 200);
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  assert.equal(captures(w).length, 1);
  assertRefundedAsExpired(w, paymentId);
});

test('late: confirm and webhook racing after the pass has ended refund once and make one record', async (t) => {
  const w = setup(t, { now: AFTER_END });
  const orderId = lateOrder(w);
  const paymentId = w.pay(orderId);
  const [a, b] = await Promise.all([
    call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a')),
    call(w, webhookReq(capturedEvent(w, paymentId))),
  ]);
  assert.equal(a.status, 200, a.text);
  assert.deepEqual(a.body, { expired: true });
  assert.equal(b.status, 200, b.text);
  assert.equal(w.refunds.length, 1);
  assert.equal(w.passes.length, 1);
  assert.equal(w.passes[0].note, 'expired');
  assert.equal(w.passes[0].status, 'refunded');
});

test('late: a failed refund is 500 so Razorpay retries, and the retry refunds once', async (t) => {
  const w = setup(t, { now: AFTER_END });
  const orderId = lateOrder(w);
  const paymentId = w.pay(orderId);
  w.failRazorpay = (method, path) => (path.endsWith('/refund') ? 502 : null);
  const hook = await call(w, webhookReq(capturedEvent(w, paymentId)));
  assert.equal(hook.status, 500);
  assert.ok(!hook.text.includes(UPSTREAM_DETAIL));
  const conf = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(conf.status, 502);
  assert.equal(w.passes.length, 0);
  assert.equal(w.refunds.length, 0);
  w.failRazorpay = null;
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  // Two failed attempts, then the one refund that went through.
  assertRefundedAsExpired(w, paymentId, { attempts: 3 });
});

test('late: a late payment whose account was deleted is refunded and recorded with no user, once', async (t) => {
  const w = setup(t, { now: AFTER_END });
  const paymentId = w.pay(lateOrder(w));
  w.users.delete(UA);
  const captured = capturedEvent(w, paymentId);
  const r = await call(w, webhookReq(captured));
  assert.equal(r.status, 200, r.text);
  assert.equal((await call(w, webhookReq(captured))).status, 200);
  assert.equal(refundCalls(w).length, 1);
  assert.equal(w.payments.get(paymentId).status, 'refunded');
  assert.equal(w.passes.length, 1);
  assert.equal(w.passes[0].user_id, null);
  assert.equal(w.passes[0].status, 'refunded');
  assert.equal(w.passes[0].note, 'expired');
});

test('late: at 23:59:59 IST on the last valid day a payment still switches the pass on', async (t) => {
  const w = setup(t, { now: LAST_MOMENT });
  const orderId = lateOrder(w);
  const paymentId = w.pay(orderId);
  const r = await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { pass: { exam: 'upsc', validUntil: '2027-05-24', status: 'active' } });
  assert.equal(w.refunds.length, 0);
});

test('late: a pass switched on before it ended is never refunded when its payment is seen again after', async (t) => {
  const w = setup(t, { now: LAST_MOMENT });
  const orderId = lateOrder(w);
  const paymentId = w.pay(orderId);
  assert.equal((await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'))).status, 200);
  w.deps.now = () => new Date(AFTER_END.getTime());
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  assert.equal(refundCalls(w).length, 0);
  assert.equal(w.passes.length, 1);
  assert.equal(w.passes[0].status, 'active');
  assert.equal(w.passes[0].note, null);
});

test('webhook: a payment whose user was deleted before settlement is 200, inserts nothing, refunds nothing', async (t) => {
  const w = setup(t);
  const { paymentId } = await buy(w);
  w.users.delete(UA); // the account is deleted before the webhook arrives
  const r = await call(w, webhookReq(capturedEvent(w, paymentId)));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal(w.passes.length, 0);
  assert.equal(w.refunds.length, 0);
  assert.ok(w.logs.some((l) => l.includes('user_gone')));
});

// --- webhook ---

test('webhook: a bad signature is 400 and touches nothing', async (t) => {
  const w = setup(t);
  const { paymentId } = await buy(w);
  const before = w.calls.length;
  const r = await call(w, webhookReq(capturedEvent(w, paymentId), 'a'.repeat(64)));
  assert.equal(r.status, 400);
  const none = await handle(
    new Request(fnUrl('webhook'), { method: 'POST', body: JSON.stringify(capturedEvent(w, paymentId)) }),
    w.deps,
  );
  assert.equal(none.status, 400);
  assert.equal(w.calls.length, before);
});

test('webhook: an unknown event is 200 with no calls', async (t) => {
  const w = setup(t);
  for (const event of ['payment.failed', 'order.paid']) {
    const r = await call(w, webhookReq({ entity: 'event', event, payload: {} }));
    assert.equal(r.status, 200, event);
    assert.deepEqual(r.body, { ok: true });
  }
  assert.equal(w.calls.length, 0);
});

test('webhook: payment.authorized captures the payment once and switches the pass on', async (t) => {
  const w = setup(t);
  const { paymentId } = await buy(w, 'token-a', { status: 'authorized' });
  const r = await call(w, webhookReq(authorizedEvent(w, paymentId)));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.body, { ok: true });
  const cap = captures(w);
  assert.equal(cap.length, 1);
  assert.equal(cap[0].path, `/v1/payments/${paymentId}/capture`);
  assert.deepEqual(cap[0].body, { amount: 49900, currency: 'INR' });
  assert.equal(w.payments.get(paymentId).status, 'captured');
  assert.equal(w.passes.length, 1);
  assert.equal(w.passes[0].status, 'active');
  assert.equal(w.passes[0].user_id, UA);
  assert.equal(w.passes[0].payment_id, paymentId);
});

test('webhook: the payment.captured that follows payment.authorized makes no second row or capture', async (t) => {
  const w = setup(t);
  const { paymentId } = await buy(w, 'token-a', { status: 'authorized' });
  const authorized = authorizedEvent(w, paymentId); // the payload as authorised
  assert.equal((await call(w, webhookReq(authorized))).status, 200);
  assert.equal(captures(w).length, 1);
  assert.equal(w.passes.length, 1);
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  // At-least-once delivery: the authorized event again, payload still 'authorized'.
  assert.equal((await call(w, webhookReq(authorized))).status, 200);
  assert.equal(captures(w).length, 1);
  assert.equal(w.passes.length, 1);
  assert.equal(w.passes[0].status, 'active');
  assert.equal(w.refunds.length, 0);
});

test('webhook: a rejected authorized payment is 200 and is never captured', async (t) => {
  const w = setup(t);
  const wrongAmount = await buy(w, 'token-a', { amount: 100, status: 'authorized' });
  const noNotes = w.pay(w.addOrder({ notes: [] }), { status: 'authorized' });
  for (const paymentId of [wrongAmount.paymentId, noNotes]) {
    const r = await call(w, webhookReq(authorizedEvent(w, paymentId)));
    assert.equal(r.status, 200, paymentId);
    assert.equal(w.payments.get(paymentId).status, 'authorized');
  }
  assert.equal(captures(w).length, 0);
  assert.equal(w.inserts().length, 0);
  assert.equal(w.refunds.length, 0);
});

test('webhook: a captured payment whose order has no notes is 200 and inserts nothing', async (t) => {
  const w = setup(t);
  for (const notes of [[], {}, { user_id: UA }, { exam: 'upsc' }, { user_id: 'not-a-uuid', exam: 'upsc' }, { user_id: UA, exam: 'nope' }]) {
    const orderId = w.addOrder({ notes });
    const paymentId = w.pay(orderId);
    const r = await call(w, webhookReq(capturedEvent(w, paymentId)));
    assert.equal(r.status, 200, JSON.stringify(notes));
  }
  assert.equal(w.inserts().length, 0);
  assert.equal(w.refunds.length, 0);
});

test('webhook: a captured payment with no order id is 200 and touches nothing', async (t) => {
  const w = setup(t);
  const ev = { entity: 'event', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_X', order_id: null } } } };
  const r = await call(w, webhookReq(ev));
  assert.equal(r.status, 200);
  assert.equal(w.calls.length, 0);
});

test('webhook: a captured payment of the wrong amount is 200 and inserts nothing', async (t) => {
  const w = setup(t);
  const { paymentId } = await buy(w, 'token-a', { amount: 100 });
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  assert.equal(w.inserts().length, 0);
});

test('webhook: the payload is never trusted; the payment is fetched from Razorpay', async (t) => {
  const w = setup(t);
  const { paymentId } = await buy(w, 'token-a', { status: 'failed' });
  const ev = capturedEvent(w, paymentId);
  ev.payload.payment.entity.status = 'captured';
  ev.payload.payment.entity.amount = 49900;
  assert.equal((await call(w, webhookReq(ev))).status, 200);
  assert.equal(w.inserts().length, 0);
});

test('webhook: a Razorpay or database failure is 500 so Razorpay retries, and leaks nothing', async (t) => {
  const w = setup(t);
  const { paymentId } = await buy(w);
  w.failRazorpay = () => 502;
  const r = await call(w, webhookReq(capturedEvent(w, paymentId)));
  assert.equal(r.status, 500);
  assert.ok(!r.text.includes(UPSTREAM_DETAIL));
  assert.equal(w.passes.length, 0);
  // The retry, once Razorpay is back, switches the pass on.
  w.failRazorpay = null;
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  assert.equal(w.passes.length, 1);
});

test('webhook: refund.created marks the active pass refunded', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  const r = await call(w, webhookReq(refundEvent(paymentId)));
  assert.equal(r.status, 200);
  assert.equal(w.passes[0].status, 'refunded');
  assert.equal(w.passes[0].refunded_at, NOW.toISOString());
  const patch = w.writes().find((c) => c.method === 'PATCH');
  assert.match(patch.search, new RegExp(`payment_id=eq\\.${paymentId}`));
  assert.match(patch.search, /status=eq\.active/);
  assert.equal(w.rzCalls().filter((c) => c.method !== 'GET' && !c.path.endsWith('/orders')).length, 0);
});

test('webhook: a refund for an unknown payment is 200 and changes nothing', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  const snapshot = structuredClone(w.passes);
  const r = await call(w, webhookReq(refundEvent('pay_UNKNOWN')));
  assert.equal(r.status, 200);
  assert.deepEqual(w.passes, snapshot);
});

test('webhook: a captured event after a refund does not switch the pass back on', async (t) => {
  const w = setup(t);
  const { orderId, paymentId } = await buy(w);
  await call(w, post('confirm', confirmBody(orderId, paymentId), 'token-a'));
  // The owner refunds in the dashboard.
  const p = w.payments.get(paymentId);
  p.status = 'refunded';
  p.amount_refunded = p.amount;
  await call(w, webhookReq(refundEvent(paymentId)));
  assert.equal((await call(w, webhookReq(capturedEvent(w, paymentId)))).status, 200);
  assert.equal(w.passes.length, 1);
  assert.equal(w.passes[0].status, 'refunded');
  // And the user may buy again.
  assert.equal((await call(w, post('create-order', { exam: 'upsc' }, 'token-a'))).status, 200);
});
