import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { canSeeAnalytics, canStartTest, defaultDeps, hasPass } from '../src/lib/tests/access.js';
import { PASS_KEY, activePassFor, loadPassCache, parsePassCache, savePassCache } from '../src/lib/payments/pass-cache.js';
import { tasterUsed } from '../src/lib/payments/taster.js';
import { refreshPass } from '../src/scripts/pass-state.js';
import { paywallStart, paymentsState } from '../src/lib/payments/switch.js';

const FROM = '2026-11-10';
const START = paywallStart(FROM);
const settings = { from: FROM, keyId: 'rzp_live_X', allowTest: false };
const LATER = new Date('2026-12-01T00:00:00Z');
const stateAt = (now) => paymentsState(settings, now);

const attempt = (over = {}) => ({
  id: 'a1',
  exam: 'upsc',
  kind: 'paper',
  status: 'abandoned',
  startedAt: new Date(START).toISOString(),
  ...over,
});
const testsOf = (...as) => ({ attempts: Object.fromEntries(as.map((a, i) => [`a${i}`, { ...a, id: `a${i}` }])) });
const cacheOf = (over = {}) => ({ userId: 'A', mode: 'live', passes: [{ exam: 'upsc', validUntil: '2027-05-24' }], ...over });
const deps = (over = {}) => ({
  payments: stateAt(LATER),
  cache: null,
  userId: 'A',
  tests: testsOf(),
  now: LATER,
  ...over,
});

// --- The switch is not on: nothing is gated. ---

test('with payments off, both checks are true and nothing is read', async () => {
  const d = deps({ payments: paymentsState({ from: '', keyId: '', allowTest: false }, LATER), tests: testsOf(attempt(), attempt({ kind: 'custom' })) });
  assert.equal(await canStartTest('upsc', 'paper', d), true);
  assert.equal(await canSeeAnalytics('upsc', d), true);
});

test('during the notice, both checks are true', async () => {
  const now = new Date(START - 1);
  const d = deps({ payments: stateAt(now), now, tests: testsOf(attempt({ startedAt: new Date(START - 5).toISOString() })) });
  assert.equal(d.payments.state, 'notice');
  assert.equal(await canStartTest('upsc', 'paper', d), true);
  assert.equal(await canSeeAnalytics('upsc', d), true);
});

// --- On, without a pass: the taster. ---

test('on, with no pass and no attempts: both kinds may start, analytics may not be seen', async () => {
  assert.equal(await canStartTest('upsc', 'paper', deps()), true);
  assert.equal(await canStartTest('upsc', 'custom', deps()), true);
  assert.equal(await canSeeAnalytics('upsc', deps()), false);
});

test('a paper started at the paywall uses the paper taster, whatever its status, and not the custom one', async () => {
  for (const status of ['abandoned', 'in_progress', 'submitted']) {
    const d = deps({ tests: testsOf(attempt({ status })) });
    assert.equal(await canStartTest('upsc', 'paper', d), false, status);
    assert.equal(await canStartTest('upsc', 'custom', d), true, status);
  }
});

test('a custom set started after the paywall uses the custom taster only', async () => {
  const d = deps({ tests: testsOf(attempt({ kind: 'custom' })) });
  assert.equal(await canStartTest('upsc', 'custom', d), false);
  assert.equal(await canStartTest('upsc', 'paper', d), true);
});

test('an attempt started 1 ms before the paywall does not use the taster', async () => {
  const d = deps({ tests: testsOf(attempt({ startedAt: new Date(START - 1).toISOString() })) });
  assert.equal(await canStartTest('upsc', 'paper', d), true);
});

test("another exam's attempt has no effect", async () => {
  const d = deps({ tests: testsOf(attempt({ exam: 'other' })) });
  assert.equal(await canStartTest('upsc', 'paper', d), true);
});

test('an unspecified kind counts as custom (callers pass one argument until Task 6)', async () => {
  const used = deps({ tests: testsOf(attempt({ kind: 'custom' })) });
  assert.equal(await canStartTest('upsc', undefined, used), false);
  const paperOnly = deps({ tests: testsOf(attempt()) });
  assert.equal(await canStartTest('upsc', undefined, paperOnly), true);
});

test('tasterUsed reads the exam, the kind and the start time', () => {
  const tests = testsOf(attempt());
  assert.equal(tasterUsed(tests, { exam: 'upsc', kind: 'paper', from: FROM, now: LATER }), true);
  assert.equal(tasterUsed(tests, { exam: 'upsc', kind: 'custom', from: FROM, now: LATER }), false);
  assert.equal(tasterUsed(tests, { exam: 'upsc', kind: 'paper', from: '', now: LATER }), false);
});

// --- On, with a pass. ---

test('a pass lasts through the whole of its last day in India, then the taster rules apply again', async () => {
  const used = testsOf(attempt(), attempt({ kind: 'custom' }));
  const lastSecond = new Date('2027-05-24T18:29:59Z');
  const d1 = deps({ cache: cacheOf(), now: lastSecond, payments: stateAt(lastSecond), tests: used });
  assert.equal(await canStartTest('upsc', 'paper', d1), true);
  assert.equal(await canStartTest('upsc', 'custom', d1), true);
  assert.equal(await canSeeAnalytics('upsc', d1), true);
  assert.equal(await hasPass('upsc', d1), true);

  const expired = new Date('2027-05-24T18:30:00Z');
  const d2 = deps({ cache: cacheOf(), now: expired, payments: stateAt(expired), tests: used });
  assert.equal(await canStartTest('upsc', 'paper', d2), false);
  assert.equal(await canStartTest('upsc', 'custom', d2), false);
  assert.equal(await canSeeAnalytics('upsc', d2), false);
  assert.equal(await hasPass('upsc', d2), false);
});

test("a pass is for its own exam", async () => {
  const d = deps({ cache: cacheOf({ passes: [{ exam: 'other', validUntil: '2027-05-24' }] }) });
  assert.equal(await canSeeAnalytics('upsc', d), false);
});

test("another account's cached pass on a shared browser gives nothing", async () => {
  assert.equal(await canSeeAnalytics('upsc', deps({ cache: cacheOf({ userId: 'A' }), userId: 'B' })), false);
  assert.equal(await canSeeAnalytics('upsc', deps({ cache: cacheOf({ userId: 'A' }), userId: null })), false);
  assert.equal(await hasPass('upsc', deps({ cache: cacheOf({ userId: 'A' }), userId: null })), false);
  assert.equal(await canSeeAnalytics('upsc', deps({ cache: cacheOf({ userId: 'A' }), userId: 'A' })), true);
});

test('a test-mode pass does not count on a live site', async () => {
  assert.equal(await canSeeAnalytics('upsc', deps({ cache: cacheOf({ mode: 'test' }) })), false);
  assert.equal(activePassFor(cacheOf({ mode: 'test' }), { userId: 'A', mode: 'live', exam: 'upsc', now: LATER }), null);
  assert.deepEqual(activePassFor(cacheOf(), { userId: 'A', mode: 'live', exam: 'upsc', now: LATER }), { exam: 'upsc', validUntil: '2027-05-24' });
});

test('activePassFor with no cache is null', () => {
  assert.equal(activePassFor(null, { userId: 'A', mode: 'live', exam: 'upsc', now: LATER }), null);
});

// --- The cache on the device. ---

test('parsePassCache accepts a good cache and rejects the rest', () => {
  assert.deepEqual(parsePassCache(JSON.stringify(cacheOf())), cacheOf());
  assert.deepEqual(parsePassCache(JSON.stringify(cacheOf({ passes: [] }))), cacheOf({ passes: [] }));
  assert.equal(parsePassCache('not json'), null);
  assert.equal(parsePassCache(null), null);
  assert.equal(parsePassCache(JSON.stringify(cacheOf({ userId: undefined }))), null);
  assert.equal(parsePassCache(JSON.stringify(cacheOf({ userId: '' }))), null);
  assert.equal(parsePassCache(JSON.stringify(cacheOf({ mode: 'staging' }))), null);
  assert.equal(parsePassCache(JSON.stringify(cacheOf({ passes: [{ exam: 'upsc', validUntil: '2027-13-40' }] }))), null);
  assert.equal(parsePassCache(JSON.stringify(cacheOf({ passes: [{ exam: 'upsc', validUntil: 'soon' }] }))), null);
  assert.equal(parsePassCache(JSON.stringify(cacheOf({ passes: { exam: 'upsc' } }))), null);
  assert.equal(parsePassCache(JSON.stringify(cacheOf({ passes: [{ validUntil: '2027-05-24' }] }))), null);
});

test('savePassCache and loadPassCache round-trip through a storage, and never throw', () => {
  const m = new Map();
  const storage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
  assert.equal(loadPassCache(storage), null);
  assert.equal(savePassCache(cacheOf(), storage), true);
  assert.ok(m.has(PASS_KEY));
  assert.deepEqual(loadPassCache(storage), cacheOf());
  const refusing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(savePassCache(cacheOf(), refusing), false);
  assert.equal(loadPassCache(refusing), null);
});

// --- Browser fakes for defaultDeps and refreshPass. ---

const GLOBALS = ['document', 'localStorage'];
let originals;
let store;
let blocked;
let passEvents;

function define(name, value) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

beforeEach(() => {
  originals = GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  store = new Map();
  blocked = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      if (blocked) throw new Error('SecurityError: storage is blocked');
      return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
      };
    },
  });
  define('document', new EventTarget());
  passEvents = 0;
  document.addEventListener('sawaalbox:pass', () => passEvents++);
});

afterEach(() => {
  mock.restoreAll();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
});

test('defaultDeps never throws: blocked storage, sign-in off', () => {
  blocked = true;
  const d = defaultDeps();
  assert.equal(d.userId, null);
  assert.equal(d.cache, null);
  assert.deepEqual(d.tests, { attempts: {} });
  assert.ok(d.now instanceof Date);
  assert.equal(d.payments.state, 'off'); // no settings under the test runner
});

test('the default checks are open when payments are off, which is the state under the test runner', async () => {
  assert.equal(await canStartTest('upsc'), true);
  assert.equal(await canSeeAnalytics('upsc'), true);
  assert.equal(await hasPass('upsc'), false);
});

// A minimal client for the one table refreshPass reads.
function passesClient(rows, { fail = false } = {}) {
  const calls = [];
  const client = {
    calls,
    from(name) {
      assert.equal(name, 'passes');
      const call = { table: name, columns: null, filters: [] };
      calls.push(call);
      const q = {
        select: (c) => ((call.columns = c), q),
        eq: (col, val) => (call.filters.push([col, val]), q),
        then: (resolve, reject) => {
          const data = rows.filter((r) => call.filters.every(([c, v]) => r[c] === v));
          return Promise.resolve(fail ? { data: null, error: { message: 'boom' } } : { data, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return client;
}

const ON_LIVE = stateAt(LATER);
const USER = { id: 'A' };

test('refreshPass asks for active passes of the site mode, saves them for the user and announces the change', async () => {
  const client = passesClient([
    { exam: 'upsc', valid_until: '2027-05-24', status: 'active', mode: 'live' },
    { exam: 'upsc', valid_until: '2027-05-24', status: 'refunded', mode: 'live' },
    { exam: 'upsc', valid_until: '2027-05-24', status: 'active', mode: 'test' },
  ]);
  await refreshPass(client, USER, { payments: ON_LIVE });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].columns, 'exam,valid_until');
  assert.deepEqual(client.calls[0].filters, [['status', 'active'], ['mode', 'live']]);
  assert.deepEqual(loadPassCache(), { userId: 'A', mode: 'live', passes: [{ exam: 'upsc', validUntil: '2027-05-24' }] });
  assert.equal(passEvents, 1);
});

test('refreshPass announces only when the cache changed', async () => {
  const client = passesClient([{ exam: 'upsc', valid_until: '2027-05-24', status: 'active', mode: 'live' }]);
  await refreshPass(client, USER, { payments: ON_LIVE });
  await refreshPass(client, USER, { payments: ON_LIVE });
  assert.equal(passEvents, 1);
  const none = passesClient([]);
  await refreshPass(none, USER, { payments: ON_LIVE });
  assert.equal(passEvents, 2);
  assert.deepEqual(loadPassCache(), { userId: 'A', mode: 'live', passes: [] });
});

test('another account on the same browser replaces the cache and announces it', async () => {
  const mine = passesClient([{ exam: 'upsc', valid_until: '2027-05-24', status: 'active', mode: 'live' }]);
  await refreshPass(mine, USER, { payments: ON_LIVE });
  await refreshPass(passesClient([]), { id: 'B' }, { payments: ON_LIVE });
  assert.deepEqual(loadPassCache(), { userId: 'B', mode: 'live', passes: [] });
  assert.equal(passEvents, 2);
});

test('on a request error refreshPass keeps the old cache and throws', async () => {
  const good = passesClient([{ exam: 'upsc', valid_until: '2027-05-24', status: 'active', mode: 'live' }]);
  await refreshPass(good, USER, { payments: ON_LIVE });
  const before = store.get(PASS_KEY);
  await assert.rejects(refreshPass(passesClient([], { fail: true }), USER, { payments: ON_LIVE }), { message: 'boom' });
  assert.equal(store.get(PASS_KEY), before);
  assert.equal(passEvents, 1);
});

test('with payments off refreshPass makes no request and saves nothing', async () => {
  const client = passesClient([]);
  await refreshPass(client, USER); // the build under test has no payment settings
  await refreshPass(client, USER, { payments: paymentsState({ from: '', keyId: '', allowTest: false }, LATER) });
  assert.equal(client.calls.length, 0);
  assert.equal(store.has(PASS_KEY), false);
  assert.equal(passEvents, 0);
});

test('refreshPass throws when the device refuses the cache, so sync logs it', async () => {
  const client = passesClient([{ exam: 'upsc', valid_until: '2027-05-24', status: 'active', mode: 'live' }]);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get: () => ({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); } }),
  });
  await assert.rejects(refreshPass(client, USER, { payments: ON_LIVE }), /could not be saved/);
  assert.equal(passEvents, 0);
});
