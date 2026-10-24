// SawaalBox payments: the one Supabase Edge Function that sells the paid pass
// through Razorpay.
//
// This is deliberately ONE self-contained file with no imports: the Supabase
// dashboard's "deploy via editor" takes a single file, so it can be pasted there
// as index.ts unchanged. That means plain modern JavaScript only (no TypeScript
// syntax) and only globals both Deno and Node 22 provide: fetch, crypto.subtle,
// TextEncoder, Request, Response. The same code therefore runs in production
// (Deno) and under the site's Node test runner, which imports it directly.
//
// The Deno.serve call at the bottom is guarded, so importing this file under
// Node starts nothing.
//
// Nothing here may hold a secret. The Razorpay key secret and webhook secret are
// read from the function's environment at request time and never written down.

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

/** Placeholder until the routes land: every request is a 404. */
export async function handle(req, deps) {
  return new Response(JSON.stringify({ error: 'not_found' }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  });
}

// The real dependencies, read from the Deno runtime. Handlers take them as an
// argument so tests can pass fakes instead.
function denoDeps() {
  return {
    env: (name) => Deno.env.get(name),
    fetch,
    now: () => new Date(),
  };
}

if (globalThis.Deno) Deno.serve((req) => handle(req, denoDeps()));
