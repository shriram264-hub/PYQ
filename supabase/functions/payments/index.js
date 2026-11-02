// SawaalBox payments: the one Supabase Edge Function that sells the paid pass
// through Razorpay.
//
// This is deliberately ONE self-contained file with no imports: the Supabase
// dashboard's "deploy via editor" takes a single file, so it can be pasted there
// as index.ts unchanged. That means plain modern JavaScript only (no TypeScript
// syntax) and only globals both Deno and Node 22 provide: fetch, crypto.subtle,
// TextEncoder, Request, Response, Headers, URL, btoa. The same code therefore
// runs in production (Deno) and under the site's Node test runner, which
// imports it directly.
//
// The Deno.serve call at the bottom is guarded, so importing this file under
// Node starts nothing.
//
// Nothing here may hold a secret. The Razorpay key secret and webhook secret are
// read from the function's environment at request time and never written down.
//
// Environment (see envFrom near the bottom): Supabase injects SUPABASE_URL and
// the keys (SUPABASE_PUBLISHABLE_KEYS / SUPABASE_SECRET_KEYS, falling back to
// the legacy SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY). The owner sets
// only RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET.
// The function must be deployed with JWT verification off: Razorpay's webhook
// carries no Supabase token, and the browser routes check the caller
// themselves through /auth/v1/user.

// The pass as it is sold. This is a copy of site/src/lib/passes.js (the function
// cannot import it), kept honest by a test that compares the two. Amounts are
// decided here and never taken from the browser. Prices are in paise.
export const PASS_FACTS = Object.freeze({
  upsc: Object.freeze({
    name: 'UPSC Prelims pass',
    amountPaise: 49900,
    currency: 'INR',
    validUntil: '2027-05-24',
    salesClose: '2027-05-23',
  }),
});

// Dates are India dates. Asia/Kolkata is UTC+05:30 all year (no daylight
// saving), so a fixed offset is exact. Same rule as site/src/lib/payments/switch.js,
// duplicated because this file has no imports.
const IST_OFFSET_MS = 330 * 60 * 1000;

/** The Asia/Kolkata calendar date of an instant, as 'YYYY-MM-DD'. */
export function istDate(now) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 'live' for a rzp_live_ key id, otherwise 'test'. Test is the safe default. */
export function modeOf(keyId) {
  return typeof keyId === 'string' && keyId.startsWith('rzp_live_') ? 'live' : 'test';
}

/** Lowercase hex HMAC-SHA256 of `message` under `secret`. */
export async function hmacHex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
  let hex = '';
  for (const b of sig) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Constant-time string compare: XOR every char code over equal lengths so the
 * time does not reveal where two signatures first differ. Unequal lengths are
 * not equal (the length of a hex digest is not secret).
 */
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Razorpay Checkout's signature: HMAC-SHA256 of `${order_id}|${payment_id}`
 * under the key secret, as lowercase hex.
 */
export async function verifyCheckoutSignature({ orderId, paymentId, signature }, keySecret) {
  if (!orderId || !paymentId || !signature || !keySecret) return false;
  return safeEqual(await hmacHex(keySecret, `${orderId}|${paymentId}`), signature);
}

/**
 * Razorpay's webhook signature: HMAC-SHA256 of the exact raw request body under
 * the webhook secret. The body must be the untouched text, not re-serialised
 * JSON, or whitespace changes would break (or forge) the match.
 */
export async function verifyWebhookSignature(rawBody, signature, webhookSecret) {
  if (typeof rawBody !== 'string' || !signature || !webhookSecret) return false;
  return safeEqual(await hmacHex(webhookSecret, rawBody), signature);
}

const LIVE_ORIGINS = ['https://sawaalbox.in', 'https://upsc-pyq-search-s778.onrender.com'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/**
 * CORS headers for a browser call from `origin`. Only our own sites are
 * allowed, plus local dev servers in test mode (never against live keys).
 * For any other origin there is no Access-Control-Allow-Origin, so the browser
 * refuses to hand the response to that page.
 */
export function corsHeaders(origin, mode) {
  const headers = {
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const allowed =
    typeof origin === 'string' &&
    (LIVE_ORIGINS.includes(origin) || (mode === 'test' && LOCAL_ORIGIN.test(origin)));
  if (allowed) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

// ---------------------------------------------------------------------------
// Routes
//
// HTTP contract (the browser code depends on it):
//   POST /create-order  Bearer <user token>, { exam }
//     200 { orderId, amount, currency, keyId, name, validUntil }
//     401 not_signed_in | 400 unknown_exam | 410 sales_closed
//     409 { error: 'already_active', validUntil } | 502 razorpay
//   POST /confirm       Bearer <user token>, { exam, orderId, paymentId, signature }
//     200 { pass: { exam, validUntil, status } } | 200 { duplicate: true }
//     200 { expired: true } (settled after the pass ended: refunded in full)
//     400 bad_signature | 403 not_your_order | 422 payment_mismatch
//     409 not_captured | 401 | 502 razorpay | 500 server
//   POST /webhook       X-Razorpay-Signature over the raw body
//     Handles payment.authorized, payment.captured and refund.created.
//     400 bad signature; otherwise 200 { ok: true } (ignored events too, so
//     Razorpay does not retry them), or 500 on an upstream failure so it does.
//   OPTIONS anything → 204 with CORS. Every JSON reply carries CORS headers.
//
// The one rule all of this protects: a passes row is inserted only by
// settlePayment, only after a verified signature (Checkout's or the
// webhook's), and only for a payment fetched from Razorpay that is captured,
// belongs to the signed order, whose order notes name the user and exam, and
// whose payment and order amounts and currency equal PASS_FACTS. Amounts never
// come from the browser or from the webhook payload.
// ---------------------------------------------------------------------------

// Razorpay REST API, Basic auth with key id and key secret.
// Orders:   https://razorpay.com/docs/api/orders/create/ , /fetch-with-id/
// Payments: https://razorpay.com/docs/api/payments/fetch-with-id/ , /capture/
// Refunds:  https://razorpay.com/docs/api/refunds/create-normal/
const RAZORPAY_API = 'https://api.razorpay.com/v1';

// Razorpay ids are short alphanumerics with a prefix. Checking the shape keeps
// anything odd (slashes, dots) out of the URL paths we build from them.
const PAYMENT_ID = /^pay_[A-Za-z0-9]{1,40}$/;
const ORDER_ID = /^order_[A-Za-z0-9]{1,40}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A failed call to Razorpay, PostgREST or Supabase Auth. It carries only the
 * service name and HTTP status (0 for a network error): never a body, header
 * or URL, so nothing upstream can leak into a reply or a log.
 */
class UpstreamError extends Error {
  constructor(service, status) {
    super(`${service} ${status}`);
    this.service = service;
    this.status = status;
  }
}

const hasOwn = (obj, key) => typeof key === 'string' && Object.prototype.hasOwnProperty.call(obj, key);

function json(status, body, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

async function send(deps, service, url, init) {
  try {
    return await deps.fetch(url, init);
  } catch {
    throw new UpstreamError(service, 0);
  }
}

async function razorpay(deps, method, path, body) {
  const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret } = deps.env;
  const headers = { Authorization: `Basic ${btoa(`${id}:${secret}`)}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const res = await send(deps, 'razorpay', `${RAZORPAY_API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new UpstreamError('razorpay', res.status);
  return res.json();
}

/**
 * PostgREST headers for the service key. The new sb_secret_ keys are not JWTs
 * and go on `apikey` only ("Send publishable and secret keys on the apikey
 * header, not on Authorization: Bearer",
 * https://supabase.com/docs/guides/api/api-keys); the gateway maps them to the
 * service_role. A legacy service_role key is a JWT and also goes on
 * Authorization, which is what sets the role for legacy keys.
 */
function serviceHeaders(env) {
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const headers = { apikey: key };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  return headers;
}

async function passesApi(deps, method, query, { body, prefer } = {}) {
  const headers = serviceHeaders(deps.env);
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  return send(deps, 'postgrest', `${deps.env.SUPABASE_URL}/rest/v1/passes${query}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function selectPasses(deps, query) {
  const res = await passesApi(deps, 'GET', query);
  if (!res.ok) throw new UpstreamError('postgrest', res.status);
  return res.json();
}

const eq = (v) => `eq.${encodeURIComponent(v)}`;

/**
 * The signed-in caller, from Supabase Auth: GET /auth/v1/user with the
 * publishable (or legacy anon) key as apikey and the caller's own access token
 * as the bearer. Null when there is no token or Auth rejects it.
 */
async function userFrom(req, deps) {
  const m = /^Bearer (\S+)$/.exec(req.headers.get('authorization') ?? '');
  if (!m) return null;
  const res = await send(deps, 'auth', `${deps.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: deps.env.SUPABASE_ANON_KEY, Authorization: `Bearer ${m[1]}` },
  });
  if (res.status === 400 || res.status === 401 || res.status === 403) return null;
  if (!res.ok) throw new UpstreamError('auth', res.status);
  const user = await res.json();
  return user && typeof user.id === 'string' && UUID.test(user.id)
    ? { id: user.id, email: typeof user.email === 'string' ? user.email : null }
    : null;
}

/** An active pass of this mode that is still valid today (IST), or null. */
async function activePass(deps, userId, exam, mode) {
  const rows = await selectPasses(
    deps,
    `?select=valid_until,status&user_id=${eq(userId)}&exam=${eq(exam)}&mode=${eq(mode)}` +
      `&status=eq.active&valid_until=gte.${istDate(deps.now())}&order=valid_until.desc&limit=1`,
  );
  return rows[0] ?? null;
}

async function passByPayment(deps, paymentId) {
  const rows = await selectPasses(deps, `?select=*&payment_id=${eq(paymentId)}&limit=1`);
  return rows[0] ?? null;
}

/** What settlePayment returns for a row it found or wrote. */
function settled(row) {
  if (row.note === 'duplicate') return { duplicate: true };
  if (row.note === 'expired') return { expired: true };
  return { pass: row };
}

/**
 * Refunds a captured payment in full and records it as a refunded row with
 * `note` ('duplicate' or 'expired'), so seeing it again reports the same
 * outcome. If the refund call fails because a parallel request already
 * refunded it, carry on to record it; the record is idempotent on payment_id.
 */
async function refundAndRecord(deps, row, facts, note) {
  try {
    await razorpay(deps, 'POST', `/payments/${row.payment_id}/refund`, {
      amount: facts.amountPaise,
      notes: { reason: note },
    });
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
    const again = await razorpay(deps, 'GET', `/payments/${row.payment_id}`);
    if (again.status !== 'refunded') throw e;
  }
  const record = (userId) =>
    passesApi(deps, 'POST', '?on_conflict=payment_id', {
      body: { ...row, user_id: userId, status: 'refunded', note, refunded_at: deps.now().toISOString() },
      prefer: 'resolution=ignore-duplicates,return=minimal',
    });
  let rec = await record(row.user_id);
  if (rec.status === 409) {
    // 23503: the account was deleted before this settled. The money has gone
    // back, so keep the record detached, as deleting an account leaves one.
    const err = await rec.json().catch(() => null);
    if (err && err.code === '23503') rec = await record(null);
  }
  if (!rec.ok) throw new UpstreamError('postgrest', rec.status);
}

/**
 * Turns a Razorpay payment into a pass row, exactly once. Shared by /confirm
 * (expectUserId and exam set) and /webhook (both null). The caller has already
 * verified a signature over (orderId, paymentId) or over the webhook body.
 *
 * Returns { pass: row } | { duplicate: true } | { expired: true } |
 * { error: code }; throws UpstreamError when Razorpay or the database fails.
 *
 * The order of checks differs from the plan's sketch in one place: the order
 * notes and amounts are checked BEFORE an authorized payment is captured, so we
 * never take money for a payment we are about to reject.
 */
async function settlePayment(deps, { paymentId, orderId, expectUserId, exam }) {
  // 1. The payment, from Razorpay, must belong to the signed order.
  const payment = await razorpay(deps, 'GET', `/payments/${paymentId}`);
  if (payment.order_id !== orderId) return { error: 'payment_mismatch' };

  // 2. The order's notes, which only create-order writes, name the user and
  //    exam. Razorpay returns an empty notes as [], hence the array check.
  const order = await razorpay(deps, 'GET', `/orders/${orderId}`);
  const notes = order.notes && typeof order.notes === 'object' && !Array.isArray(order.notes) ? order.notes : {};
  const userId = notes.user_id;
  const noteExam = notes.exam;
  if (typeof userId !== 'string' || !UUID.test(userId) || !hasOwn(PASS_FACTS, noteExam)) {
    return { error: 'not_your_order' };
  }
  if (expectUserId !== null && userId !== expectUserId) return { error: 'not_your_order' };
  if (exam !== null && noteExam !== exam) return { error: 'not_your_order' };

  // 3. Amount and currency of both payment and order are the server's.
  const facts = PASS_FACTS[noteExam];
  if (
    payment.amount !== facts.amountPaise ||
    payment.currency !== facts.currency ||
    order.amount !== facts.amountPaise ||
    order.currency !== facts.currency
  ) {
    return { error: 'payment_mismatch' };
  }

  // 4. Captured, capturing an authorized payment ourselves (POST
  //    /payments/:id/capture {amount, currency}). If the capture call fails,
  //    a parallel request may have captured it first: re-read before failing.
  let status = payment.status;
  if (status === 'authorized') {
    try {
      status = (
        await razorpay(deps, 'POST', `/payments/${paymentId}/capture`, {
          amount: facts.amountPaise,
          currency: facts.currency,
        })
      ).status;
    } catch (e) {
      if (!(e instanceof UpstreamError)) throw e;
      const again = await razorpay(deps, 'GET', `/payments/${paymentId}`);
      if (again.status !== 'captured') throw e;
      status = 'captured';
    }
  }
  if (status !== 'captured') {
    // Already settled earlier and since refunded (by us as a duplicate, or by
    // the owner): report what was recorded rather than "not captured".
    const existing = await passByPayment(deps, paymentId);
    return existing ? settled(existing) : { error: 'not_captured' };
  }

  const row = {
    user_id: userId,
    exam: noteExam,
    mode: modeOf(deps.env.RAZORPAY_KEY_ID),
    valid_until: facts.validUntil,
    payment_id: paymentId,
    order_id: orderId,
    amount_paise: facts.amountPaise,
    status: 'active',
  };

  // 5. Too late: the pass has already ended (its validUntil day is over,
  //    India time). Sales close before that, so this is an order made in time
  //    whose payment settled only now. A pass that is already over is worth
  //    nothing, so refund in full, record it with note 'expired', and switch
  //    nothing on. A row already recorded for this payment (switched on in
  //    time, or refunded here before) is reported as it stands, so a payment
  //    is never refunded twice and a pass that was switched on is never taken
  //    back.
  if (istDate(deps.now()) > facts.validUntil) {
    const existing = await passByPayment(deps, paymentId);
    if (existing) return settled(existing);
    await refundAndRecord(deps, row, facts, 'expired');
    console.error('payments: refunded a payment made after the pass ended: expired');
    return { expired: true };
  }

  // 6. Insert. The database decides races: payment_id is unique, and
  //    passes_one_active allows one active row per user, exam, mode and
  //    valid_until.
  const res = await passesApi(deps, 'POST', '', { body: row, prefer: 'return=representation' });
  if (res.ok) {
    const [saved] = await res.json();
    return { pass: saved };
  }
  // PostgREST maps a unique violation (23505) and a foreign-key violation
  // (23503) to HTTP 409 (https://docs.postgrest.org/en/v12/references/errors.html).
  // Anything else is a failure.
  const err = res.status === 409 ? await res.json().catch(() => null) : null;
  // 23503: the order's user was deleted before the payment settled. There is
  // no account to give a pass to; retrying cannot help. Ignored (the webhook
  // logs the code and answers 200); the owner handles any refund by hand.
  if (err && err.code === '23503') return { error: 'user_gone' };
  if (!err || err.code !== '23505') throw new UpstreamError('postgrest', res.status);

  // 7a. This payment is already recorded: idempotent.
  const existing = await passByPayment(deps, paymentId);
  if (existing) return settled(existing);

  // 7b. Otherwise the user already holds an active pass: refund this payment
  //     in full and record it.
  //
  //     Belt and braces before any refund: the clash must be with a pass that
  //     is active and still valid today. If it is not (the day turned after
  //     step 5, so the clashing row with the same valid_until has just
  //     ended), this is not a duplicate purchase: never refund, fail instead
  //     so the webhook is retried (step 5 then refunds it as expired) and the
  //     owner is alerted.
  if (!(await activePass(deps, userId, noteExam, row.mode))) {
    console.error('payments: no_active_pass');
    throw new UpstreamError('conflict', 409);
  }
  await refundAndRecord(deps, row, facts, 'duplicate');
  return { duplicate: true };
}

async function readJson(req) {
  try {
    const body = await req.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  } catch {
    return {};
  }
}

function logUpstream(where, e) {
  // Only the service name and HTTP status: never a header, body or secret.
  console.error(`payments: ${where} failed: ${e.service} ${e.status}`);
}

/** Maps an upstream failure on a browser route to its reply. */
function upstreamReply(where, e, cors) {
  if (!(e instanceof UpstreamError)) throw e;
  logUpstream(where, e);
  return e.service === 'razorpay' ? json(502, { error: 'razorpay' }, cors) : json(500, { error: 'server' }, cors);
}

async function createOrder(req, deps, cors) {
  try {
    const user = await userFrom(req, deps);
    if (!user) return json(401, { error: 'not_signed_in' }, cors);
    // Only the exam is read from the body; any amount sent is ignored.
    const { exam } = await readJson(req);
    if (!hasOwn(PASS_FACTS, exam)) return json(400, { error: 'unknown_exam' }, cors);
    const facts = PASS_FACTS[exam];
    // Sales are open through the whole of the salesClose day, India time.
    if (istDate(deps.now()) > facts.salesClose) return json(410, { error: 'sales_closed' }, cors);
    const mode = modeOf(deps.env.RAZORPAY_KEY_ID);
    const active = await activePass(deps, user.id, exam, mode);
    if (active) return json(409, { error: 'already_active', validUntil: active.valid_until }, cors);
    // receipt: at most 40 chars and unique per account (Razorpay orders docs);
    // 'upsc-' + 8 + '-' + 13 ms digits is 27.
    const order = await razorpay(deps, 'POST', '/orders', {
      amount: facts.amountPaise,
      currency: facts.currency,
      receipt: `${exam}-${user.id.slice(0, 8)}-${deps.now().getTime()}`,
      notes: { user_id: user.id, exam },
    });
    return json(
      200,
      {
        orderId: order.id,
        amount: facts.amountPaise,
        currency: facts.currency,
        keyId: deps.env.RAZORPAY_KEY_ID,
        name: facts.name,
        validUntil: facts.validUntil,
      },
      cors,
    );
  } catch (e) {
    return upstreamReply('create-order', e, cors);
  }
}

const CONFIRM_ERRORS = { not_your_order: 403, payment_mismatch: 422, not_captured: 409 };
// user_gone cannot reach confirm (its caller just signed in), but if it ever
// did, the account no longer exists, so it is answered as signed out.

async function confirm(req, deps, cors) {
  try {
    const user = await userFrom(req, deps);
    if (!user) return json(401, { error: 'not_signed_in' }, cors);
    const { exam, orderId, paymentId, signature } = await readJson(req);
    if (!hasOwn(PASS_FACTS, exam)) return json(400, { error: 'unknown_exam' }, cors);
    const signed =
      typeof orderId === 'string' &&
      typeof paymentId === 'string' &&
      typeof signature === 'string' &&
      ORDER_ID.test(orderId) &&
      PAYMENT_ID.test(paymentId) &&
      (await verifyCheckoutSignature({ orderId, paymentId, signature }, deps.env.RAZORPAY_KEY_SECRET));
    if (!signed) return json(400, { error: 'bad_signature' }, cors);
    const out = await settlePayment(deps, { paymentId, orderId, expectUserId: user.id, exam });
    if (out.error === 'user_gone') return json(401, { error: 'not_signed_in' }, cors);
    if (out.error) return json(CONFIRM_ERRORS[out.error], { error: out.error }, cors);
    if (out.duplicate) return json(200, { duplicate: true }, cors);
    if (out.expired) return json(200, { expired: true }, cors);
    const { exam: e, valid_until: validUntil, status } = out.pass;
    return json(200, { pass: { exam: e, validUntil, status } }, cors);
  } catch (e) {
    return upstreamReply('confirm', e, cors);
  }
}

/**
 * Razorpay webhooks (https://razorpay.com/docs/webhooks/payments/ and
 * /docs/webhooks/refunds/): payment.authorized and payment.captured carry
 * payload.payment.entity, refund.created carries payload.refund.entity.
 *
 * payment.authorized is settled exactly like payment.captured. If automatic
 * capture is off in the Razorpay dashboard, it is the only event that arrives,
 * and /delivery promises the pass switches on even when the page closed before
 * /confirm ran. settlePayment captures an authorized payment only after the
 * order notes, user and amounts check out, and re-fetches the status, so the
 * payment.captured that follows finds the row already there (idempotent).
 *
 * Delivery is at-least-once and
 * any non-2xx is retried with backoff for 24 hours, after which the webhook is
 * disabled (https://razorpay.com/docs/webhooks/faqs/), so only real upstream
 * failures return non-2xx. The payload is only a pointer: settlePayment
 * re-fetches the payment and order from Razorpay.
 */
async function webhook(req, deps, cors) {
  const raw = await req.text();
  const ok = await verifyWebhookSignature(raw, req.headers.get('x-razorpay-signature'), deps.env.RAZORPAY_WEBHOOK_SECRET);
  if (!ok) return json(400, { error: 'bad_signature' }, cors);
  let event;
  try {
    event = JSON.parse(raw);
  } catch {
    return json(400, { error: 'bad_request' }, cors);
  }
  try {
    if (event && (event.event === 'payment.captured' || event.event === 'payment.authorized')) {
      const p = event.payload && event.payload.payment && event.payload.payment.entity;
      if (p && PAYMENT_ID.test(String(p.id)) && ORDER_ID.test(String(p.order_id))) {
        const out = await settlePayment(deps, { paymentId: p.id, orderId: p.order_id, expectUserId: null, exam: null });
        if (out.error) console.error(`payments: webhook ignored a payment: ${out.error}`);
      }
    } else if (event && event.event === 'refund.created') {
      const r = event.payload && event.payload.refund && event.payload.refund.entity;
      if (r && PAYMENT_ID.test(String(r.payment_id))) {
        const res = await passesApi(deps, 'PATCH', `?payment_id=${eq(r.payment_id)}&status=eq.active`, {
          body: { status: 'refunded', refunded_at: deps.now().toISOString() },
          prefer: 'return=minimal',
        });
        if (!res.ok) throw new UpstreamError('postgrest', res.status);
      }
    }
  } catch (e) {
    if (!(e instanceof UpstreamError)) throw e;
    logUpstream('webhook', e);
    return json(500, { error: 'server' }, cors);
  }
  return json(200, { ok: true }, cors);
}

const ROUTES = { 'create-order': createOrder, confirm, webhook };

/** The function's entry point, routed on the URL path's last segment. */
export async function handle(req, deps) {
  const env = deps.env ?? {};
  const cors = corsHeaders(req.headers.get('origin'), modeOf(env.RAZORPAY_KEY_ID));
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const name = new URL(req.url).pathname.split('/').filter(Boolean).pop();
  if (!hasOwn(ROUTES, name)) return json(404, { error: 'not_found' }, cors);
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' }, cors);
  try {
    return await ROUTES[name](req, deps, cors);
  } catch (e) {
    // Anything unexpected: a bare 500, logging only the error's type.
    console.error(`payments: unexpected ${e && e.name}`);
    return json(500, { error: 'server' }, cors);
  }
}

/**
 * The first key in one of Supabase's key dictionaries: the one named
 * 'default', or else the first string value. Null when unset or not JSON.
 */
function keyFromDict(raw) {
  try {
    const dict = JSON.parse(raw ?? '');
    if (!dict || typeof dict !== 'object') return null;
    if (typeof dict.default === 'string' && dict.default) return dict.default;
    return Object.values(dict).find((v) => typeof v === 'string' && v) ?? null;
  } catch {
    return null;
  }
}

/**
 * deps.env from the function's environment (`get` is Deno.env.get).
 *
 * Supabase injects these into every Edge Function; the owner sets none of them
 * (https://supabase.com/docs/guides/functions/secrets):
 *   SUPABASE_URL
 *   SUPABASE_PUBLISHABLE_KEYS, SUPABASE_SECRET_KEYS  (JSON dictionaries of the
 *     new sb_publishable_/sb_secret_ keys; we take 'default')
 *   SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY     (legacy keys, used only as
 *     a fallback; Supabase is deprecating them by the end of 2026)
 * The owner sets these three as Edge Function secrets:
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 *
 * The slot names SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY inside deps.env
 * mean "the public key" and "the server key", whichever system supplies them.
 */
export function envFrom(get) {
  return {
    SUPABASE_URL: get('SUPABASE_URL'),
    SUPABASE_ANON_KEY: keyFromDict(get('SUPABASE_PUBLISHABLE_KEYS')) ?? get('SUPABASE_ANON_KEY'),
    SUPABASE_SERVICE_ROLE_KEY: keyFromDict(get('SUPABASE_SECRET_KEYS')) ?? get('SUPABASE_SERVICE_ROLE_KEY'),
    RAZORPAY_KEY_ID: get('RAZORPAY_KEY_ID'),
    RAZORPAY_KEY_SECRET: get('RAZORPAY_KEY_SECRET'),
    RAZORPAY_WEBHOOK_SECRET: get('RAZORPAY_WEBHOOK_SECRET'),
  };
}

// The real dependencies, read from the Deno runtime. Handlers take them as an
// argument so tests can pass fakes instead.
function denoDeps() {
  return {
    env: envFrom((name) => Deno.env.get(name)),
    fetch,
    now: () => new Date(),
  };
}

if (globalThis.Deno) Deno.serve((req) => handle(req, denoDeps()));
