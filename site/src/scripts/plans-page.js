import { SUPABASE_URL } from '../lib/accounts/config.js';
import { LEGAL, longDate } from '../lib/legal.js';
import { passFor } from '../lib/passes.js';
import { savePassCache } from '../lib/payments/pass-cache.js';
import { DROPPED, RELOAD } from '../lib/payments/plans-copy.js';
import { safeReturn } from '../lib/payments/return-path.js';
import { currentPayments, paywallStart, salesOpen } from '../lib/payments/switch.js';
import { hasPass } from '../lib/tests/access.js';
import { currentUser, displayNameOf, getClient, mayHaveSession, signIn } from './auth.js';
import { refreshPass } from './pass-state.js';
import { onPassChange } from './upgrade.js';

// /plans when payments are configured (pages/plans.astro serves this only
// then). It picks the action area's state, starts sign-in, and buys the pass:
// an order from the payments function, Razorpay Checkout, then /confirm. What
// is charged comes only from the function's create-order reply: this page sends
// the exam and nothing else, and passes the reply's amount to Checkout as is.
//
// The function is called with plain fetch and only two headers (Authorization
// and Content-Type): its CORS allows nothing else, so supabase.functions.invoke,
// which adds its own headers, would fail the preflight.

const FUNCTION = `${SUPABASE_URL}/functions/v1/payments`;
const CHECKOUT_JS = 'https://checkout.razorpay.com/v1/checkout.js';
const REFRESH_MS = 4000;
const CHECKOUT_MS = 15000;
const RETRIES_MS = [30000, 120000];
const BACK_AFTER_MS = 1500;

const PENDING = 'Payment received. Switching on your pass…';
const FAILED = "Payment didn't go through. You haven't been charged for this attempt.";
const DUPLICATE = 'You already had the pass, so this second payment is being refunded in full.';
const REFUNDED = `This payment was refunded, so it doesn't switch on a pass. Questions: ${LEGAL.email}.`;
const NO_START = "Couldn't start the payment, and nothing was charged. Try again in a moment.";
const NO_CHECKOUT = "Razorpay's payment window didn't load, and nothing was charged. Check your connection and try again.";
const NO_SIGNIN = "Couldn't reach the sign-in service. Try again in a moment.";
const SIGNED_OUT = 'Your sign-in has ended. Sign in again to buy.';
const done = (validUntil) => `Your pass is active until ${longDate(validUntil)}`;

const root = document.querySelector('[data-plan]');
const pass = root && passFor(root.dataset.pass);

/** Rejects after `ms`, or settles as `promise` does, whichever is first. */
function within(promise, ms) {
  let timer;
  const late = new Promise((_, reject) => (timer = setTimeout(() => reject(new Error('timed out')), ms)));
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

let checkoutLoad;
/** Razorpay's checkout.js, added once, only when Buy is pressed. A failure may be retried. */
function loadCheckout() {
  if (typeof globalThis.Razorpay === 'function') return Promise.resolve(globalThis.Razorpay);
  checkoutLoad ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const fail = () => {
      clearTimeout(timer);
      script.remove();
      checkoutLoad = undefined;
      reject(new Error('checkout.js did not load'));
    };
    const timer = setTimeout(fail, CHECKOUT_MS);
    script.src = CHECKOUT_JS;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      if (typeof globalThis.Razorpay === 'function') resolve(globalThis.Razorpay);
      else fail();
    };
    script.onerror = fail;
    document.head.append(script);
  });
  return checkoutLoad;
}

// A real calendar date ('YYYY-MM-DD'), as the pass cache requires.
const isDay = (s) => typeof s === 'string' && !Number.isNaN(paywallStart(s));

/** The create-order reply, when it has everything Checkout needs, else null. */
function orderFrom(body, keyId) {
  if (!body || typeof body !== 'object') return null;
  const { orderId, amount, currency, keyId: key, name, validUntil } = body;
  const ok =
    typeof orderId === 'string' &&
    orderId &&
    Number.isInteger(amount) &&
    amount > 0 &&
    typeof currency === 'string' &&
    currency &&
    // The function's key must be this build's: a test-mode site must never
    // open a live checkout (or the reverse), whose pass it would not count.
    key === keyId &&
    typeof name === 'string' &&
    isDay(validUntil);
  return ok ? { orderId, amount, currency, keyId: key, name, validUntil } : null;
}

/** DESIGN.md's green, read from the token so Checkout matches the theme in use. */
function green() {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--field').trim();
  return /^#[0-9a-f]{3,8}$/i.test(value) ? value : undefined;
}

if (root && pass) {
  const states = root.querySelector('[data-plan-states]');
  const status = root.querySelector('[data-plan-status]');
  const buyBtn = root.querySelector('[data-plan-buy]');
  const signinBtn = root.querySelector('[data-plan-signin]');
  const links = root.querySelector('[data-plan-links]');
  const back = root.querySelector('[data-plan-back]');
  const backLink = root.querySelector('[data-plan-back-link]');
  const payments = currentPayments();

  let client = null;
  let user = null;
  // Set while an order, Checkout or a confirmation is under way: Buy does
  // nothing and a pass change does not redraw the state under it.
  let busy = false;
  // The server said this account holds the pass (confirm, a duplicate, or
  // already_active): shown as active even if this device could not save it.
  let known = false;
  // The pending timers (the return after paying, the checks after a dropped
  // confirmation), so signing out can stop them.
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const stopTimers = () => {
    for (const id of timers) clearTimeout(id);
    timers.clear();
  };

  /** The status line: `text`, and an optional second line under it. Plain text only. */
  const say = (text, more = '') => {
    if (more) status.replaceChildren(text, document.createElement('br'), more);
    else status.textContent = text;
  };
  const show = (state) => {
    states.dataset.state = state;
  };
  const setBusy = (on) => {
    busy = on;
    if (on) buyBtn.setAttribute('aria-disabled', 'true');
    else buyBtn.removeAttribute('aria-disabled');
  };

  /** Brings the cache up to date, waiting at most `ms`; on a failure or a timeout the cache stands. */
  async function refresh(ms = REFRESH_MS) {
    if (!client || !user) return;
    try {
      await within(refreshPass(client, user), ms);
    } catch {
      /* offline, or slow: decide from what the device already knows */
    }
  }

  /** Which state the area shows: the access check decides "active", nothing else here does. */
  async function decide() {
    if (known || (await hasPass(pass.exam))) return 'active';
    if (!salesOpen(pass, new Date())) return 'closed';
    return user ? 'buy' : 'signed-out';
  }

  async function redraw() {
    if (busy) return;
    show(await decide());
  }

  async function start() {
    if (mayHaveSession()) {
      try {
        client = await getClient();
        user = await currentUser();
        await refresh();
      } catch (e) {
        console.warn('SawaalBox: sign-in check failed', e);
        user = null;
      }
    }
    await redraw();
  }

  /** The active state, and the way back to where the Upgrade prompt was, if any. */
  function activated({ leave }) {
    known = true;
    show('active');
    const to = safeReturn(new URLSearchParams(location.search).get('return'));
    if (!to) return;
    backLink.href = to;
    links.hidden = true;
    back.hidden = false;
    if (leave) later(() => location.assign(to), BACK_AFTER_MS);
  }

  /** After a confirmation that did not come back: the webhook will usually settle it. */
  function dropped() {
    say(DROPPED);
    // Signed out while the confirmation was under way: there is no account
    // here to check for, so nothing is scheduled.
    if (!user) return;
    // Buy stays busy: the student was very likely charged, and a second order
    // now would only be a second payment to refund. A reload re-enables it,
    // and create-order then answers already_active if the pass has landed.
    RETRIES_MS.forEach((ms, i) => {
      later(async () => {
        if (known) return;
        await refresh();
        // Signed out while the check ran: it was for an account no longer here.
        if (known || !user) return;
        if (await hasPass(pass.exam)) {
          say(done(pass.validUntil));
          activated({ leave: false });
        } else if (i === RETRIES_MS.length - 1) {
          // The page has stopped checking by itself; say how to check again.
          say(DROPPED, RELOAD);
        }
      }, ms);
    });
  }

  async function token() {
    const { data } = await client.auth.getSession();
    return data.session?.access_token ?? null;
  }

  const call = (route, bearer, body) =>
    fetch(`${FUNCTION}/${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

  async function confirmPayment(response) {
    // A failed first attempt inside Checkout may have re-enabled Buy.
    setBusy(true);
    say(PENDING);
    let res;
    try {
      const bearer = await token();
      if (!bearer) return dropped();
      res = await call('confirm', bearer, {
        exam: pass.exam,
        orderId: response?.razorpay_order_id,
        paymentId: response?.razorpay_payment_id,
        signature: response?.razorpay_signature,
      });
    } catch {
      return dropped();
    }
    if (res.status !== 200) return dropped();
    const body = await res.json().catch(() => null);
    if (body?.duplicate === true) {
      say(DUPLICATE);
      activated({ leave: false });
      refresh().catch(() => {});
      return;
    }
    const got = body?.pass;
    if (got && got.status === 'active' && got.exam === pass.exam && isDay(got.validUntil)) {
      savePassCache({ userId: user.id, mode: payments.mode, passes: [{ exam: got.exam, validUntil: got.validUntil }] });
      document.dispatchEvent(new CustomEvent('sawaalbox:pass'));
      say(done(got.validUntil));
      activated({ leave: true });
      refreshPass(client, user).catch(() => {});
      return;
    }
    if (got && got.status === 'refunded') {
      say(REFUNDED);
      setBusy(false);
      await redraw();
      return;
    }
    dropped();
  }

  async function buy() {
    if (busy) return;
    setBusy(true);
    say('');
    // Every way out of here that is not Checkout opening re-enables Buy.
    const stop = (text) => {
      say(text);
      setBusy(false);
    };
    let res;
    try {
      const bearer = await token();
      if (!bearer) {
        user = null;
        stop(SIGNED_OUT);
        return redraw();
      }
      res = await call('create-order', bearer, { exam: pass.exam });
    } catch {
      return stop(NO_START);
    }
    const body = await res.json().catch(() => null);
    if (res.status === 409 && body?.error === 'already_active') {
      await refresh();
      setBusy(false);
      say(isDay(body.validUntil) ? done(body.validUntil) : '');
      return activated({ leave: false });
    }
    if (res.status === 410) {
      stop('');
      return show('closed');
    }
    if (res.status === 401) {
      user = null;
      stop(SIGNED_OUT);
      return redraw();
    }
    const order = res.status === 200 ? orderFrom(body, payments.keyId) : null;
    if (!order) return stop(NO_START);

    let Razorpay;
    try {
      Razorpay = await loadCheckout();
    } catch {
      return stop(NO_CHECKOUT);
    }

    let paid = false;
    const theme = green();
    const checkout = new Razorpay({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amount,
      currency: order.currency,
      name: 'SawaalBox',
      description: `${order.name}, valid until ${longDate(order.validUntil)}`,
      prefill: { name: displayNameOf(user), email: typeof user.email === 'string' ? user.email : '' },
      ...(theme ? { theme: { color: theme } } : {}),
      handler: (response) => {
        paid = true;
        confirmPayment(response);
      },
      modal: {
        ondismiss: () => {
          if (!paid) stop(FAILED);
        },
      },
    });
    // Checkout stays open after a failed attempt so the student can try
    // another way to pay; say so now, and leave Buy ready for after.
    checkout.on('payment.failed', () => {
      if (!paid) stop(FAILED);
    });
    checkout.open();
  }

  buyBtn.addEventListener('click', buy);
  // signIn comes back to this same address, ?return= included.
  signinBtn.addEventListener('click', () => signIn().catch(() => say(NO_SIGNIN)));
  onPassChange(() => redraw());
  document.addEventListener('sawaalbox:signed-out', () => {
    // Nothing started for the account that left may run on: no return
    // navigation, no further checks for its pass.
    stopTimers();
    setBusy(false);
    user = null;
    known = false;
    redraw();
  });

  if (payments.state !== 'off') start();
}
