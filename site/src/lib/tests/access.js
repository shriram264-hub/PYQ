// The one place that decides who may take a test or see analytics. Every way
// into a test asks canStartTest first (the Start button on a paper, the
// practice-set form); the analytics page and the subject and topic lines ask
// canSeeAnalytics. No other code may decide this (spec, "Future upgrade check").
//
// The rules, in order:
//   - payments not `on` (off, or only the "from [date]" notice): yes, as before;
//   - an active pass for the exam (this account, this site mode): yes;
//   - otherwise a test may start once per kind (the free taster, see taster.js)
//     and analytics are not shown.
// Only the Start of a NEW test asks; one begun before the paywall can still be
// resumed and submitted, and results are always viewable.
//
// Async because callers already await it. Everything it reads is on the device
// and passed in as `deps`, so tests can drive it; defaultDeps reads the real
// ones and never throws.
import { activePassFor, loadPassCache } from '../payments/pass-cache.js';
import { currentPayments } from '../payments/switch.js';
import { tasterUsed } from '../payments/taster.js';
import { SUPABASE_URL, authEnabled, storageKeyFor, storedUserId } from '../accounts/config.js';
import { loadTests } from './store.js';

function safely(read, fallback) {
  try {
    return read();
  } catch {
    return fallback;
  }
}

/** The real inputs: payments settings, cached pass, signed-in user, attempts, now. */
export function defaultDeps() {
  return {
    payments: safely(() => currentPayments(), { state: 'off', from: null, mode: null, keyId: null }),
    cache: safely(() => loadPassCache(), null),
    // Sign-in off, or storage blocked: nobody is known, so no cached pass counts.
    userId: safely(() => (authEnabled ? storedUserId(globalThis.localStorage, storageKeyFor(SUPABASE_URL)) : null), null),
    tests: safely(() => loadTests(), { attempts: {} }),
    now: new Date(),
  };
}

const passOf = (exam, { payments, cache, userId, now }) =>
  activePassFor(cache, { userId, mode: payments.mode, exam, now });

/**
 * Whether the student holds an active pass for `exam` right now. This is about
 * the pass alone, not the switch: with payments off it is false because nobody
 * can have a pass of a mode that is not selling. For Plans and the You line.
 */
export async function hasPass(exam, deps = defaultDeps()) {
  return passOf(exam, deps) !== null;
}

/**
 * Whether a new test of `kind` may start. `kind` is required: 'paper' (the
 * take page's Start) or 'custom' (the practice-set form). Each kind has its own
 * taster, so it is taken as given and never stands in for the other.
 */
export async function canStartTest(exam, kind, deps = defaultDeps()) {
  if (deps.payments.state !== 'on') return true;
  if (passOf(exam, deps)) return true;
  return !tasterUsed(deps.tests, { exam, kind, from: deps.payments.from, now: deps.now });
}

/** Whether analytics for `exam` may be shown. */
export async function canSeeAnalytics(exam, deps = defaultDeps()) {
  if (deps.payments.state !== 'on') return true;
  return passOf(exam, deps) !== null;
}
