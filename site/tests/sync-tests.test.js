import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { RLS_REFUSAL, USER, fakeClient } from './support/fake-supabase.js';
import { MINUTE, abandonAttempt, chooseAnswer, newAttempt, submitAttempt } from '../src/lib/tests/attempt.js';
import { MAX_ATTEMPTS, TESTS_KEY, loadTests, putAttempt, saveTests, emptyTests } from '../src/lib/tests/store.js';
import { isDirty, toRow } from '../src/lib/tests/merge.js';
import { emptyState, loadState, saveState } from '../src/lib/accounts/progress-store.js';
import { OWNER_KEY } from '../src/lib/accounts/pull.js';
import { SYNC_MARKER_KEY, startSync } from '../src/scripts/sync.js';
import { LISTS_MARKER_KEY } from '../src/scripts/sync-lists.js';
import { TESTS_MARKER_KEY, syncTests } from '../src/scripts/sync-tests.js';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const ID3 = '00000000-0000-4000-8000-000000000003';
const KEYS = ['upsc-2019-1', 'upsc-2019-2'];
const T = (m) => new Date(Date.now() - (60 - m) * MINUTE).toISOString();
const RESULT = { scored: 2, right: 1, wrong: 0, blank: 1, score: 2, max: 4 };
const make = (id = ID1, minute = 0) =>
  newAttempt({ id, kind: 'paper', spec: { year: 2019 }, keys: KEYS, limitMs: 120 * MINUTE, now: T(minute) });
// As the account last confirmed it.
const confirmed = (a) => ({ ...a, syncedAt: a.updatedAt });
const seedTests = (...attempts) => assert.ok(saveTests(attempts.reduce(putAttempt, emptyTests())));
const stored = (id) => loadTests().attempts[id];
const attemptCalls = (client, kind) => client.calls.filter((c) => c.table === 'test_attempts' && c.kind === kind);
const uploaded = (client) => attemptCalls(client, 'upsert').flatMap((c) => c.rows);
const writeTestsMarker = (ageMs, user = USER.id) =>
  store.set(TESTS_MARKER_KEY, JSON.stringify({ user, at: new Date(Date.now() - ageMs).toISOString() }));
const writeMarker = (key, ageMs) => store.set(key, JSON.stringify({ user: USER.id, at: new Date(Date.now() - ageMs).toISOString() }));
// The fake network settles on microtasks, so one timer turn lets everything finish.
const idle = () => new Promise((resolve) => setTimeout(resolve, 5));
function slowNetwork(client) {
  let release;
  client.hold = new Promise((resolve) => (release = resolve));
  return release;
}

// --- Fakes: the browser globals sync.js touches. The Supabase client is in support/fake-supabase.js. ---

const GLOBALS = ['document', 'window', 'localStorage'];
let originals;
let store; // the Map behind the fake localStorage
let failWrites;
let blocked;
let synced; // how many sawaalbox:synced events the page has seen
let warnings;

function define(name, value) {
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
}

beforeEach(() => {
  originals = GLOBALS.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  store = new Map();
  failWrites = false;
  blocked = false;
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    get() {
      if (blocked) throw new Error('SecurityError: storage is blocked');
      return {
        getItem: (k) => (store.has(k) ? store.get(k) : null),
        setItem: (k, v) => {
          if (failWrites) throw new Error('QuotaExceededError');
          store.set(k, String(v));
        },
        removeItem: (k) => store.delete(k),
      };
    },
  });
  define('document', new EventTarget());
  define('window', new EventTarget());
  synced = 0;
  document.addEventListener('sawaalbox:synced', () => synced++);
  warnings = [];
  mock.method(console, 'warn', (...args) => warnings.push(args));
});

afterEach(() => {
  // Ends any sync this test started, so the next test begins with none.
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  mock.restoreAll();
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  }
  // A test that expects a warning takes it with takeWarnings(); any other is a bug.
  assert.deepEqual(warnings, []);
});

const takeWarnings = () => warnings.splice(0);

// Every account a test makes is checked when the test ends: no run, in any
// test here, ever asked to delete an attempt.
const accounts = [];
function account(rows = [], options = {}) {
  const client = fakeClient(rows, options);
  accounts.push(client);
  return client;
}
afterEach(() => {
  for (const client of accounts.splice(0)) assert.deepEqual(attemptCalls(client, 'delete'), [], 'an attempt is never deleted');
});

// --- What a tests sync does. ---

test('an attempt started here is uploaded under its own id, as this account, and becomes synced', async () => {
  const a = make();
  seedTests(a);
  const client = account();
  await syncTests(client, USER);
  const upserts = attemptCalls(client, 'upsert');
  assert.equal(upserts.length, 1);
  assert.deepEqual(upserts[0].rows, [toRow(a, USER.id)]);
  assert.equal(upserts[0].rows[0].user_id, USER.id);
  assert.deepEqual(upserts[0].options, { onConflict: 'id' });
  assert.equal(client.attempts.get(ID1).status, 'in_progress');
  assert.equal(stored(ID1).syncedAt, stored(ID1).updatedAt);
  assert.ok(store.has(TESTS_MARKER_KEY));
  assert.equal(synced, 1);
});

test('an attempt made on another device arrives here, and nothing is sent back', async () => {
  const theirs = submitAttempt(make(ID2), RESULT, T(5));
  const client = account([], { attempts: [toRow(theirs, USER.id)] });
  await syncTests(client, USER);
  assert.equal(stored(ID2).status, 'submitted');
  assert.deepEqual(stored(ID2), confirmed(theirs));
  assert.deepEqual(attemptCalls(client, 'upsert'), []);
  assert.equal(synced, 1);
});

test('a submit on another device beats answering here: the submitted copy stands, and nothing is sent', async () => {
  const base = make();
  const here = chooseAnswer(confirmed(base), KEYS[0], 'a', T(30));
  const there = submitAttempt(base, RESULT, T(20));
  seedTests(here);
  const client = account([], { attempts: [toRow(there, USER.id)] });
  await syncTests(client, USER);
  assert.equal(stored(ID1).status, 'submitted');
  assert.deepEqual(stored(ID1), confirmed(there));
  assert.deepEqual(attemptCalls(client, 'upsert'), []);
  assert.equal(client.attempts.get(ID1).status, 'submitted');
});

test("this device's submit beats the account's unfinished copy, though that was touched later", async () => {
  const base = confirmed(make());
  const here = submitAttempt(base, RESULT, T(20));
  const there = chooseAnswer(base, KEYS[1], 'c', T(30));
  seedTests(here);
  const client = account([], { attempts: [toRow(there, USER.id)] });
  await syncTests(client, USER);
  assert.equal(attemptCalls(client, 'upsert').length, 1);
  assert.equal(client.attempts.get(ID1).status, 'submitted');
  assert.deepEqual(client.attempts.get(ID1), toRow(here, USER.id));
  assert.equal(stored(ID1).syncedAt, here.updatedAt);
});

test('of two submits, the earlier one stands, on the device and on the account', async () => {
  const base = confirmed(make());
  const earlier = submitAttempt(base, RESULT, T(20));
  const later = submitAttempt(base, RESULT, T(25));

  seedTests(later);
  const client = account([], { attempts: [toRow(earlier, USER.id)] });
  await syncTests(client, USER);
  assert.equal(stored(ID1).submittedAt, earlier.submittedAt);
  assert.deepEqual(attemptCalls(client, 'upsert'), []);

  // The other way round: this device submitted first, so its copy goes up.
  seedTests(earlier);
  const other = account([], { attempts: [toRow(later, USER.id)] });
  await syncTests(other, USER);
  assert.equal(attemptCalls(other, 'upsert').length, 1);
  assert.equal(other.attempts.get(ID1).submitted_at, earlier.submittedAt);
  assert.equal(stored(ID1).submittedAt, earlier.submittedAt);
});

// --- Failure, and the run around the step. ---

test('offline, an attempt waits on the device; back online, the next run sends it', async () => {
  seedTests(make());
  const client = account();
  client.failOn = 'upsert';
  startSync(client, USER);
  await idle();
  const [warning, ...more] = takeWarnings();
  assert.deepEqual(more, [], 'progress and lists had nothing to send, so only the tests step failed');
  assert.equal(warning[0], 'SawaalBox: will retry syncing tests');
  assert.equal(stored(ID1).syncedAt, null);
  assert.equal(store.has(TESTS_MARKER_KEY), false);

  client.failOn = null;
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.ok(client.attempts.has(ID1));
  assert.notEqual(stored(ID1).syncedAt, null);
  assert.equal(isDirty(stored(ID1)), false);
});

test("a new account on a shared browser: the last account's attempts leave the device, and ones never synced join this account", async () => {
  store.set(OWNER_KEY, 'user-A');
  const theirs = confirmed(submitAttempt(make(ID1), RESULT, T(5)));
  const mine = make(ID2, 10);
  seedTests(theirs, mine);
  const client = account();
  startSync(client, USER);
  await idle();
  assert.equal(stored(ID1), undefined, "the last account's attempt is gone from this device");
  assert.equal(client.attempts.has(ID1), false, 'and was never uploaded to this one');
  assert.deepEqual(uploaded(client), [toRow(mine, USER.id)]);
  assert.equal(stored(ID2).syncedAt, mine.updatedAt);
  assert.equal(store.get(OWNER_KEY), USER.id);
});

test("when the device cannot be cleared of the last account's attempts, the run stops before any request", async () => {
  store.set(OWNER_KEY, 'user-A');
  seedTests(confirmed(make()));
  const before = store.get(TESTS_KEY);
  const client = account();
  failWrites = true;
  await startSync(client, USER);
  const [warning, ...more] = takeWarnings();
  assert.deepEqual(more, []);
  assert.equal(warning[0], 'SawaalBox: will retry syncing');
  assert.match(warning[1].message, /tests could not be cleared/);
  assert.deepEqual(client.calls, []);
  assert.equal(store.get(TESTS_KEY), before);
  assert.equal(store.get(OWNER_KEY), 'user-A', 'the device still holds their attempt, so it is still theirs');
});

test("when the last account's marks are cleared but its attempts cannot be, the page still hears that storage changed", async () => {
  store.set(OWNER_KEY, 'user-A');
  assert.ok(saveState({ ...emptyState(), entries: { [KEYS[0]]: { status: 'done', updatedAt: T(0), synced: true } } }));
  seedTests(confirmed(make()));
  const write = store.set.bind(store);
  store.set = (k, v) => {
    if (k === TESTS_KEY) throw new Error('QuotaExceededError');
    return write(k, v);
  };
  const client = account();
  await startSync(client, USER);
  const [warning, ...more] = takeWarnings();
  assert.deepEqual(more, []);
  assert.match(warning[1].message, /tests could not be cleared/);
  assert.deepEqual(loadState().entries, {}, "the last account's marks are gone");
  assert.equal(synced, 1, 'so marks redraw, though the run stopped');
  assert.deepEqual(client.calls, []);
});

test('an answer given while a run waits on the network is kept, still unsynced, and the next run sends it', async () => {
  const a = confirmed(make());
  seedTests(a);
  writeTestsMarker(60 * MINUTE); // long past: the run pulls everything
  const client = account([], { attempts: [toRow(a, USER.id)] });
  const release = slowNetwork(client);
  const run = syncTests(client, USER);
  assert.ok(saveTests(putAttempt(loadTests(), chooseAnswer(stored(ID1), KEYS[1], 'b', T(40)))));
  release();
  await run;
  assert.equal(stored(ID1).answers[KEYS[1]], 'b');
  assert.equal(isDirty(stored(ID1)), true);
  assert.deepEqual(attemptCalls(client, 'upsert'), [], 'the run had not seen it');

  await syncTests(client, USER);
  assert.equal(client.attempts.get(ID1).answers[KEYS[1]], 'b');
  assert.equal(isDirty(stored(ID1)), false);
});

// --- Full or targeted. ---

test('between full pulls a run asks only about the attempts changed here, and nothing when none has', async () => {
  writeTestsMarker(1000);
  const clean = confirmed(make(ID2));
  seedTests(clean);
  const client = account([], { attempts: [toRow(clean, USER.id)] });
  await syncTests(client, USER);
  assert.deepEqual(client.calls, [], 'nothing changed here: no request at all');
  assert.equal(synced, 0);

  const answered = chooseAnswer(confirmed(make(ID1)), KEYS[0], 'a', T(5));
  seedTests(clean, answered);
  await syncTests(client, USER);
  const [targeted, ...more] = attemptCalls(client, 'select');
  assert.deepEqual(more, []);
  assert.deepEqual(targeted.filters, [['in', 'id', [ID1]]]);
  assert.equal(targeted.range, undefined);
  assert.deepEqual(uploaded(client).map((r) => r.id), [ID1]);
  assert.deepEqual(stored(ID2), clean, 'not asked about, and left as it was');

  await syncTests(client, USER, { full: true });
  const full = attemptCalls(client, 'select').slice(1);
  assert.ok(full.length > 0);
  assert.ok(full.every((c) => c.filters.length === 0), 'full: every row, no id filter');
  assert.deepEqual(full[0].range, [0, 999]);
});

test('more changed attempts than one request should name are found by a full pull, and sent in batches', async () => {
  writeTestsMarker(1000);
  const ids = Array.from({ length: 51 }, (_, i) => `00000000-0000-4000-8000-${String(100 + i).padStart(12, '0')}`);
  seedTests(...ids.map((id) => make(id)));
  const client = account();
  await syncTests(client, USER);
  const [first] = attemptCalls(client, 'select');
  assert.deepEqual(first.filters, []);
  assert.deepEqual(first.range, [0, 999]);
  assert.deepEqual(attemptCalls(client, 'upsert').map((c) => c.rows.length), [50, 1]);
  assert.equal(client.attempts.size, 51);
});

test('an account holding more attempts than the device keeps: the newest stay here, and the next full pull changes nothing', async () => {
  const ids = Array.from({ length: MAX_ATTEMPTS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(1000 + i).padStart(12, '0')}`);
  const rows = ids.map((id, i) => toRow(make(id, i / 10), USER.id)); // the first is the oldest
  const client = account([], { attempts: rows });
  await syncTests(client, USER);
  assert.equal(Object.keys(loadTests().attempts).length, MAX_ATTEMPTS);
  assert.equal(stored(ids[0]), undefined, 'the oldest stays only in the account');
  assert.equal(synced, 1);

  const before = store.get(TESTS_KEY);
  await syncTests(client, USER, { full: true });
  assert.equal(store.get(TESTS_KEY), before);
  assert.equal(synced, 1, 'nothing changed, so nothing to redraw');
  assert.deepEqual(attemptCalls(client, 'upsert'), []);
});

// --- Never deleted. ---

test('no run ever deletes an attempt, and the account would refuse one', async () => {
  const open = make(ID1, 1);
  const elsewhere = submitAttempt(confirmed(make(ID2, 2)), RESULT, T(10));
  const base3 = confirmed(make(ID3, 3));
  const abandonedHere = abandonAttempt(base3, T(12));
  seedTests(open, abandonedHere);
  const client = account([], { attempts: [toRow(elsewhere, USER.id), toRow(base3, USER.id)] });

  await syncTests(client, USER); // full: no marker yet
  assert.ok(saveTests(putAttempt(loadTests(), chooseAnswer(stored(ID1), KEYS[0], 'd', T(20)))));
  await syncTests(client, USER); // targeted: ID1 changed
  await syncTests(client, USER, { full: true });

  assert.deepEqual(attemptCalls(client, 'delete'), []);
  assert.deepEqual([...client.attempts.keys()].sort(), [ID1, ID2, ID3]);
  assert.deepEqual(Object.keys(loadTests().attempts).sort(), [ID1, ID2, ID3]);
  assert.equal(client.attempts.get(ID3).status, 'abandoned', 'an abandoned attempt is a status, kept with its data');
  assert.equal(stored(ID3).status, 'abandoned');
  assert.equal(client.attempts.get(ID1).answers[KEYS[0]], 'd');

  // Not one of the accounts checked above: this delete is the point.
  const direct = fakeClient([], { attempts: [toRow(open, USER.id)] });
  const { error } = await direct.from('test_attempts').delete().eq('user_id', USER.id).eq('id', ID1);
  assert.equal(error.code, '42501');
  assert.ok(direct.attempts.has(ID1));
});

// --- An attempt another account holds. ---

const USER_A = { id: 'user-A' };
const USER_B = { id: 'user-B' };
const uploadedIds = (client) => attemptCalls(client, 'upsert').map((c) => c.rows.map((r) => r.id));

test("an attempt another account holds leaves this device instead of blocking the sync: A's upload landed but its save did not, then B signed in", async () => {
  // A, on this browser: the upload lands in A's account, the save here does not,
  // so the device still takes the attempt for one never sent.
  const accountA = account([], { user: USER_A });
  seedTests(make(ID1));
  const write = store.set.bind(store);
  store.set = (k, v) => {
    if (k === TESTS_KEY) throw new Error('QuotaExceededError');
    return write(k, v);
  };
  await startSync(accountA, USER_A);
  delete store.set;
  assert.deepEqual(takeWarnings().map((w) => w[0]), ['SawaalBox: will retry syncing tests']);
  assert.equal(accountA.attempts.get(ID1).user_id, USER_A.id);
  assert.equal(stored(ID1).syncedAt, null);
  document.dispatchEvent(new Event('sawaalbox:signed-out')); // offline: nothing more reaches A

  // Signed out, someone starts a test; then B signs in on the same browser.
  const mine = make(ID2, 10);
  assert.ok(saveTests(putAttempt(loadTests(), mine)));
  const accountB = account([], { user: USER_B, foreignAttempts: [...accountA.attempts.values()] });
  await startSync(accountB, USER_B);
  assert.deepEqual(takeWarnings(), [], 'the run did not fail');
  assert.deepEqual(uploadedIds(accountB), [[ID1, ID2], [ID1], [ID2]], 'refused as a batch, then sent one at a time');
  assert.equal(stored(ID1), undefined, "A's attempt left this device; A's account keeps it");
  assert.equal(accountB.attempts.get(ID1).user_id, USER_A.id, 'and was not overwritten');
  assert.equal(accountB.attempts.get(ID2).user_id, USER_B.id, "B's own attempt went up");
  assert.equal(isDirty(stored(ID2)), false);
  assert.equal(JSON.parse(store.get(TESTS_MARKER_KEY)).user, USER_B.id);

  // And it stays unblocked: the next run has nothing to send.
  await syncTests(accountB, USER_B, { full: true });
  assert.equal(attemptCalls(accountB, 'upsert').length, 3);
});

test('a batch with one attempt another account holds: the others upload, and that one leaves this device', async () => {
  const [a1, a2, a3] = [make(ID1, 1), make(ID2, 2), make(ID3, 3)];
  seedTests(a1, a2, a3);
  const client = account([], { foreignAttempts: [toRow(a2, USER_A.id)] });
  await syncTests(client, USER);
  assert.deepEqual(uploadedIds(client), [[ID1, ID2, ID3], [ID1], [ID2], [ID3]]);
  assert.equal(client.attempts.get(ID1).user_id, USER.id);
  assert.equal(client.attempts.get(ID2).user_id, USER_A.id);
  assert.equal(client.attempts.get(ID3).user_id, USER.id);
  assert.deepEqual(Object.keys(loadTests().attempts).sort(), [ID1, ID3]);
  assert.equal(isDirty(stored(ID1)), false);
  assert.equal(isDirty(stored(ID3)), false);
  assert.ok(store.has(TESTS_MARKER_KEY));
  assert.equal(synced, 1);
});

test('an attempt another account holds leaves this device even when it was answered here during the run', async () => {
  const a = make(ID1);
  seedTests(a);
  const client = account([], { foreignAttempts: [toRow(a, USER_A.id)] });
  const release = slowNetwork(client);
  const run = syncTests(client, USER);
  assert.ok(saveTests(putAttempt(loadTests(), chooseAnswer(stored(ID1), KEYS[0], 'a', T(40)))));
  release();
  await run;
  assert.deepEqual(uploadedIds(client), [[ID1]], 'a batch of one is judged as refused, not sent again');
  assert.equal(stored(ID1), undefined);
  assert.deepEqual(loadTests().attempts, {});
});

test('an upload refused because the session is gone is not taken for another account: the run fails, and every attempt stays to send', async () => {
  seedTests(make(ID1, 1), make(ID2, 2));
  const before = store.get(TESTS_KEY);
  const client = account(); // an empty account: the full pull is one request
  const release = slowNetwork(client);
  const run = syncTests(client, USER);
  await idle(); // the pull has been answered and is held
  client.anon = true; // signed out (here or in another tab) before the upload
  release();
  await assert.rejects(run, { code: '42501', message: 'permission denied for table test_attempts' });
  assert.deepEqual(uploadedIds(client), [[ID1, ID2]], 'not sent again one at a time');
  assert.equal(store.get(TESTS_KEY), before);
  assert.ok(isDirty(stored(ID1)) && isDirty(stored(ID2)));
  assert.equal(store.has(TESTS_MARKER_KEY), false);
});

test("a sign-out while the tests step uploads: the run warns and retries later, and no attempt leaves the device", async () => {
  // The path sign-out takes: its last run is still going when the session goes.
  writeMarker(SYNC_MARKER_KEY, 1000);
  writeMarker(LISTS_MARKER_KEY, 1000);
  seedTests(make(ID1));
  const before = store.get(TESTS_KEY);
  const client = account();
  const release = slowNetwork(client);
  const run = startSync(client, USER);
  await idle(); // the tests pull is in flight
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  client.anon = true;
  release();
  await run;
  assert.deepEqual(takeWarnings().map((w) => w[0]), ['SawaalBox: will retry syncing tests']);
  assert.deepEqual(uploadedIds(client), [[ID1]]);
  assert.equal(store.get(TESTS_KEY), before);
  assert.equal(isDirty(stored(ID1)), true);
  assert.equal(store.has(TESTS_MARKER_KEY), false);
});

// Refusals from a patched account, to reach what the fake never does by itself.
function refuseUpserts(client, errors) {
  const from = client.from;
  client.from = (name) => {
    const table = from(name);
    if (name !== 'test_attempts') return table;
    return { ...table, upsert: (rows, options) => (errors.length ? Promise.resolve({ data: null, error: errors.shift() }) : table.upsert(rows, options)) };
  };
}
const RLS = { code: '42501', message: RLS_REFUSAL };

test('only a refused attempt this account could not see is taken for another account\'s; any other refusal fails the run as before', async () => {
  // The account shows the row, so it is this account's: a refusal is something else.
  const base = confirmed(make(ID1));
  const answered = chooseAnswer(base, KEYS[0], 'a', T(5));
  seedTests(answered);
  const own = account([], { attempts: [toRow(base, USER.id)] });
  refuseUpserts(own, [RLS]);
  await assert.rejects(syncTests(own, USER), { code: '42501' });
  assert.deepEqual(stored(ID1), answered, 'kept, and still to send');

  // Refused as a batch, then for another reason one at a time.
  const second = make(ID2, 6);
  seedTests(answered, second);
  const other = account();
  refuseUpserts(other, [RLS, { code: 'XX000', message: 'internal error' }]);
  await assert.rejects(syncTests(other, USER), { code: 'XX000' });
  assert.deepEqual(stored(ID1), answered);
  assert.deepEqual(stored(ID2), second);
  assert.equal(store.has(TESTS_MARKER_KEY), false);
});

// --- Wiring. ---

test('a test started, submitted or abandoned (sawaalbox:test) starts a run', async () => {
  const client = account();
  startSync(client, USER);
  await idle();
  seedTests(make(ID2));
  assert.equal(client.attempts.has(ID2), false);
  document.dispatchEvent(new CustomEvent('sawaalbox:test'));
  await idle();
  assert.ok(client.attempts.has(ID2));
});

test('sign-out forgets the tests marker, and a test event after it starts no run', async () => {
  const client = account();
  await startSync(client, USER);
  assert.ok(store.has(TESTS_MARKER_KEY));
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  assert.equal(store.has(TESTS_MARKER_KEY), false);

  const calls = client.calls.length;
  seedTests(make());
  document.dispatchEvent(new CustomEvent('sawaalbox:test'));
  await idle();
  assert.equal(client.calls.length, calls);
});

test('a tests step that outlives sign-out leaves no tests marker', async () => {
  // Progress and lists have nothing to ask, so the first request is the tests pull.
  writeMarker(SYNC_MARKER_KEY, 1000);
  writeMarker(LISTS_MARKER_KEY, 1000);
  const client = account();
  const release = slowNetwork(client);
  const run = startSync(client, USER);
  await idle();
  assert.equal(attemptCalls(client, 'select').length, 1, 'the tests pull is in flight');
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  release();
  await run;
  assert.equal(store.has(TESTS_MARKER_KEY), false);
});

test('a sign-out while the lists step runs keeps the tests step from starting', async () => {
  // Progress has nothing to ask, so the first request is the lists pull.
  writeMarker(SYNC_MARKER_KEY, 1000);
  seedTests(make());
  const client = account();
  const release = slowNetwork(client);
  const run = startSync(client, USER);
  await idle();
  assert.ok(client.calls.some((c) => c.table === 'bookmark_sets'), 'the lists pull is in flight');
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  release();
  await run;
  assert.deepEqual(attemptCalls(client, 'select'), []);
  assert.equal(client.attempts.has(ID1), false);
});

test('a save that storage refuses is a failure, even when only syncedAt would change: no event, no marker', async () => {
  seedTests(make());
  const before = store.get(TESTS_KEY);
  const client = account();
  failWrites = true;
  await assert.rejects(syncTests(client, USER), /tests could not be saved/);
  assert.ok(client.attempts.has(ID1), 'the upload went through; the save did not');
  assert.equal(store.get(TESTS_KEY), before);
  assert.equal(synced, 0);
  assert.equal(store.has(TESTS_MARKER_KEY), false);
});
