// The payments switch: one place that says whether the site is selling passes.
//
// Three states, decided from build-time settings and the clock:
//   off     Payments are not live. Tests and analytics stay free. This is the
//           state whenever the start date or the Razorpay key is missing or
//           unusable, so a half-configured build can never show a paywall.
//   notice  Payments are configured and start on a future date. Pages show the
//           "from [date]" banner; nothing is gated yet.
//   on      The start date has arrived (00:00 India time). Gating applies.
//
// A test key (rzp_test_) on its own means off. Only a build that also sets
// PUBLIC_PAYMENTS_ALLOW_TEST=1 (a local or preview build) reaches test mode, so
// the live site, which never sets it, cannot be pushed into test mode by a
// stray key, and students there can never pay with test money.
//
// Dates are India dates: Asia/Kolkata is UTC+05:30 all year (no daylight
// saving), so a fixed 330-minute offset is exact and needs no Intl timezone data.

// Under plain Node (the test runner) `import.meta.env` is undefined, so the
// module has to import cleanly without it, as lib/accounts/config.js does.
const env = import.meta.env ?? {};

export const PAYMENTS = Object.freeze({
  from: String(env.PUBLIC_PAYMENTS_FROM ?? '').trim(),
  keyId: String(env.PUBLIC_RAZORPAY_KEY_ID ?? '').trim(),
  // Only the exact string '1' turns it on.
  allowTest: env.PUBLIC_PAYMENTS_ALLOW_TEST === '1',
});

const IST_OFFSET_MS = 330 * 60 * 1000;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The Asia/Kolkata calendar date of an instant, as 'YYYY-MM-DD'. */
export function istDate(now) {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The instant, in ms, when `from` ('YYYY-MM-DD') begins in India, or NaN if it
 * is not a real calendar date.
 */
export function paywallStart(from) {
  const m = ISO_DAY.exec(typeof from === 'string' ? from : '');
  if (!m) return NaN;
  const [, y, mo, d] = m;
  // Date.UTC rolls 2026-02-31 over to March, so check the date survives a round trip.
  const probe = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d)));
  if (probe.toISOString().slice(0, 10) !== from) return NaN;
  return Date.parse(`${from}T00:00:00+05:30`);
}

const OFF = Object.freeze({ state: 'off', from: null, mode: null, keyId: null });

/**
 * Where payments stand at `now`, given the settings. `mode` is 'live' for a
 * rzp_live_ key and 'test' for a rzp_test_ key (allowed only with allowTest).
 */
export function paymentsState({ from, keyId, allowTest }, now) {
  const start = paywallStart(from);
  if (Number.isNaN(start) || typeof keyId !== 'string') return { ...OFF };
  let mode = null;
  if (keyId.startsWith('rzp_live_')) mode = 'live';
  else if (keyId.startsWith('rzp_test_') && allowTest) mode = 'test';
  if (!mode) return { ...OFF };
  return { state: now.getTime() >= start ? 'on' : 'notice', from, mode, keyId };
}

/** paymentsState for this build's settings. */
export function currentPayments(now = new Date()) {
  return paymentsState(PAYMENTS, now);
}

/** Whether the pass can still be bought: open through the whole salesClose day, India time. */
export function salesOpen(pass, now) {
  return istDate(now) <= pass.salesClose;
}
