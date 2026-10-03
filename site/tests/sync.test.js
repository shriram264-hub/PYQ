import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyState, enqueue, loadState, saveState, setMark } from '../src/lib/accounts/progress-store.js';
import { SYNC_MARKER_KEY, startSync, syncProgress } from '../src/scripts/sync.js';

const USER = { id: 'user-1' };
const OLD = '2026-10-01T10:00:00.000Z';
const NEW = '2026-10-02T10:00:00.000Z';
const NEWER = '2026-10-03T10:00:00.000Z';
const MIN = 60 * 1000;

const entry = (status, updatedAt, synced = false) => ({ status, updatedAt, synced });
const row = (question_key, status, updated_at) => ({ user_id: USER.id, question_key, status, updated_at });

// --- Fakes: the browser globals sync.js touches, and a Supabase client. ---

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

/**
 * A fake Supabase client for the one table, applying the calls it records to
 * an in-memory table: `.select()`, `.in()`, `.order()`, `.range()`,
 * `.upsert(rows, options)` and `.delete().eq().lt()`, each awaitable to
 * `{ data, error }`.
 *  - hold: a promise the next select waits on after reading, i.e. a slow network
 *  - failOn: 'select' | 'upsert' | 'delete' returns an error for that call
 *  - maxRows: the server's row cap per request
 */
function fakeClient(rows = [], { maxRows = 1000 } = {}) {
  const table = new Map(rows.map((r) => [r.question_key, { ...r }]));
  const calls = [];
  const client = { calls, table, hold: null, failOn: null };

  const matches = (call, r) =>
    call.filters.every(([op, col, val]) => {
      if (op === 'eq') return r[col] === val;
      if (op === 'lt') return Date.parse(r[col]) < Date.parse(val);
      return val.includes(r[col]); // 'in'
    });

  async function execute(call) {
    if (client.failOn === call.kind) return { data: null, error: { message: `${call.kind} refused` } };
    if (call.kind === 'select') {
      let out = [...table.values()].filter((r) => matches(call, r));
      if (call.order) out.sort((a, b) => (a[call.order] < b[call.order] ? -1 : 1));
      const [from, to] = call.range ?? [0, Infinity];
      out = out.slice(from, Math.min(to + 1, from + maxRows));
      const columns = call.columns.split(',');
      const result = { data: out.map((r) => Object.fromEntries(columns.map((c) => [c, r[c]]))), error: null };
      if (client.hold) {
        const gate = client.hold;
        client.hold = null;
        await gate;
      }
      return result;
    }
    if (call.kind === 'upsert') {
      for (const r of call.rows) {
        assert.equal(r.user_id, USER.id, 'every uploaded row names its owner');
        table.set(r.question_key, { ...r });
      }
    } else {
      for (const [k, r] of table) if (matches(call, r)) table.delete(k);
    }
    return { data: null, error: null };
  }

  function query(kind, extra = {}) {
    const call = { kind, filters: [], ...extra };
    calls.push(call);
    const q = {
      eq: (col, val) => (call.filters.push(['eq', col, val]), q),
      lt: (col, val) => (call.filters.push(['lt', col, val]), q),
      in: (col, vals) => (call.filters.push(['in', col, vals]), q),
      order: (col) => ((call.order = col), q),
      range: (from, to) => ((call.range = [from, to]), q),
      then: (resolve, reject) => execute(call).then(resolve, reject),
    };
    return q;
  }

  client.from = (name) => {
    assert.equal(name, 'question_progress');
    return {
      select: (columns) => query('select', { columns }),
      upsert: (upRows, options) => query('upsert', { rows: upRows, options }),
      delete: () => query('delete'),
    };
  };
  return client;
}

const kinds = (client, kind) => client.calls.filter((c) => c.kind === kind);
const statuses = (client) => Object.fromEntries([...client.table.values()].map((r) => [r.question_key, r.status]));

// What marks.js does on a click, minus the DOM: the mark and its op, one save.
function mark(key, status, at) {
  const { state, op } = setMark(loadState(), key, status, at);
  saveState(enqueue(state, op));
  return op;
}
const click = (key, status, at) => document.dispatchEvent(new CustomEvent('sawaalbox:mark', { detail: mark(key, status, at) }));
const seed = (state) => assert.ok(saveState({ ...emptyState(), ...state }));
const writeMarker = (ageMs, user = USER.id) =>
  store.set(SYNC_MARKER_KEY, JSON.stringify({ user, at: new Date(Date.now() - ageMs).toISOString() }));
// The fake network settles on microtasks, so one timer turn lets everything finish.
const idle = () => new Promise((resolve) => setTimeout(resolve, 5));
function slowNetwork(client) {
  let release;
  client.hold = new Promise((resolve) => (release = resolve));
  return release;
}

// --- What a sync does. ---

test('an unsynced local mark is uploaded and becomes synced', async () => {
  mark('a', 'done', OLD);
  const client = fakeClient();
  await syncProgress(client, USER);
  const [upload] = kinds(client, 'upsert');
  assert.deepEqual(upload.rows, [{ question_key: 'a', status: 'done', updated_at: OLD, user_id: USER.id }]);
  assert.deepEqual(upload.options, { onConflict: 'user_id,question_key' });
  assert.deepEqual(loadState().entries, { a: entry('done', OLD, true) });
  assert.deepEqual(loadState().pending, []);
  assert.equal(synced, 1);
});

test('account marks arrive on this device, and marks cleared elsewhere leave it', async () => {
  seed({ entries: { gone: entry('done', OLD, true) } });
  await syncProgress(fakeClient([row('b', 'review', NEW)]), USER);
  assert.deepEqual(loadState().entries, { b: entry('review', NEW, true) });
  assert.equal(synced, 1);
});

test('a pending delete newer than the account row issues a conditional delete and the entry stays gone', async () => {
  mark('a', 'done', OLD);
  mark('a', null, NEW);
  const client = fakeClient([row('a', 'done', OLD)]);
  await syncProgress(client, USER);
  const [del] = kinds(client, 'delete');
  assert.deepEqual(del.filters, [
    ['eq', 'user_id', USER.id],
    ['eq', 'question_key', 'a'],
    ['lt', 'updated_at', NEW],
  ]);
  assert.deepEqual(statuses(client), {});
  assert.deepEqual(loadState().entries, {});
  assert.deepEqual(loadState().pending, []);
});

test('a newer edit another device makes before the delete lands survives it', async () => {
  mark('a', 'done', OLD);
  mark('a', null, NEW);
  const client = fakeClient([row('a', 'done', OLD)]);
  const release = slowNetwork(client);
  const run = syncProgress(client, USER);
  client.table.set('a', row('a', 'review', NEWER)); // the other device, after our read
  release();
  await run;
  assert.deepEqual(statuses(client), { a: 'review' });
  assert.deepEqual(loadState().pending, []);
});

test('an account row newer than a pending delete wins and the pending delete is cleared', async () => {
  mark('a', 'done', OLD);
  mark('a', null, NEW);
  const client = fakeClient([row('a', 'review', NEWER)]);
  await syncProgress(client, USER);
  assert.deepEqual(kinds(client, 'delete'), []);
  assert.deepEqual(loadState().entries, { a: entry('review', NEWER, true) });
  assert.deepEqual(loadState().pending, []);
});

test('a mark made while a run awaits the network survives the run and stays pending', async () => {
  mark('a', 'done', OLD);
  const client = fakeClient();
  const release = slowNetwork(client);
  const run = syncProgress(client, USER);
  mark('b', 'review', NEW); // the person taps while the account is being read
  release();
  await run;
  assert.deepEqual(loadState().entries, { a: entry('done', OLD, true), b: entry('review', NEW, false) });
  assert.deepEqual(loadState().pending, [{ type: 'upsert', key: 'b', status: 'review', at: NEW }]);
});

test('marks made during a run trigger exactly one follow-up run, which uploads them', async () => {
  mark('a', 'done', OLD);
  const client = fakeClient();
  const release = slowNetwork(client);
  const first = startSync(client, USER);
  click('b', 'review', NEW);
  click('c', 'done', NEW); // two taps, one follow-up
  release();
  await first;
  assert.equal(synced, 2);
  const targeted = kinds(client, 'select').filter((c) => c.filters.length);
  assert.equal(targeted.length, 1);
  assert.deepEqual(targeted[0].filters, [['in', 'question_key', ['b', 'c']]]);
  assert.deepEqual(statuses(client), { a: 'done', b: 'review', c: 'done' });
  assert.deepEqual(loadState().pending, []);
});

test('re-marking a question during a run is not overwritten by the run', async () => {
  mark('a', 'done', OLD);
  const client = fakeClient();
  const release = slowNetwork(client);
  const first = startSync(client, USER);
  click('a', 'review', NEW);
  release();
  await first;
  assert.deepEqual(statuses(client), { a: 'review' });
  assert.deepEqual(loadState().entries, { a: entry('review', NEW, true) });
});

// --- Failure. ---

for (const failing of ['select', 'upsert', 'delete']) {
  test(`a failed ${failing} request leaves storage untouched and fires no synced event`, async () => {
    mark('a', 'done', OLD);
    mark('a', null, NEW); // a pending delete, for the account's older copy
    mark('b', 'review', NEW); // and a mark to upload
    const client = fakeClient([row('a', 'done', OLD)]);
    client.failOn = failing;
    const before = store.get(STORAGE_KEY);
    await assert.rejects(syncProgress(client, USER), { message: `${failing} refused` });
    assert.equal(store.get(STORAGE_KEY), before);
    assert.equal(store.has(SYNC_MARKER_KEY), false);
    assert.equal(synced, 0);
  });
}

test('a failed run is logged, and the next trigger retries it', async () => {
  mark('a', 'done', OLD);
  const client = fakeClient();
  client.failOn = 'select';
  await startSync(client, USER); // never rejects: the failure is logged
  const [warning] = takeWarnings();
  assert.equal(warning[0], 'SawaalBox: will retry syncing');
  assert.equal(synced, 0);

  client.failOn = null;
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.equal(synced, 1);
  assert.deepEqual(statuses(client), { a: 'done' });
});

test('a save that storage refuses is a failure: no event, no marker', async () => {
  mark('a', 'done', OLD);
  failWrites = true;
  await assert.rejects(syncProgress(fakeClient([row('b', 'done', OLD)]), USER), /could not be saved/);
  assert.equal(synced, 0);
  assert.equal(store.has(SYNC_MARKER_KEY), false);
});

test('blocked storage is a failure too, not a crash', async () => {
  blocked = true;
  await assert.rejects(syncProgress(fakeClient([row('b', 'done', OLD)]), USER), /could not be saved/);
  assert.equal(synced, 0);
});

// --- Full or targeted. ---

test('with a recent full pull, a run asks only about the pending questions and leaves the rest alone', async () => {
  writeMarker(MIN);
  const marker = store.get(SYNC_MARKER_KEY);
  seed({ entries: { c: entry('done', OLD, false), d: entry('review', OLD, true) } });
  mark('a', 'done', NEW);
  const client = fakeClient([row('a', 'review', OLD), row('x', 'done', OLD)]);
  await syncProgress(client, USER);
  const selects = kinds(client, 'select');
  assert.equal(selects.length, 1);
  assert.deepEqual(selects[0].filters, [['in', 'question_key', ['a']]]);
  assert.equal(selects[0].range, undefined);
  assert.deepEqual(loadState().entries, {
    a: entry('done', NEW, true),
    c: entry('done', OLD, false), // not asked about: not uploaded, flag unchanged
    d: entry('review', OLD, true), // not asked about: not dropped for being absent from the reply
  });
  assert.deepEqual(statuses(client), { a: 'done', x: 'done' });
  assert.equal(store.get(SYNC_MARKER_KEY), marker, 'only a full pull renews the marker');
  assert.equal(synced, 1);
});

test('with a recent full pull and nothing pending, a run does nothing', async () => {
  writeMarker(MIN);
  seed({ entries: { c: entry('done', OLD, true) } });
  const client = fakeClient([row('x', 'done', OLD)]);
  await syncProgress(client, USER);
  assert.deepEqual(client.calls, []);
  assert.equal(synced, 0);
});

const FULL_PULL_CASES = {
  'no marker': () => {},
  'a marker older than 10 minutes': () => writeMarker(11 * MIN),
  'a marker for another user': () => writeMarker(MIN, 'someone-else'),
  'a marker dated in the future': () => writeMarker(-MIN),
  'an unreadable marker': () => store.set(SYNC_MARKER_KEY, '{nope'),
};
for (const [name, setup] of Object.entries(FULL_PULL_CASES)) {
  test(`${name}: the run pulls every row and renews the marker`, async () => {
    setup();
    mark('a', 'done', NEW);
    const client = fakeClient([row('x', 'done', OLD)]);
    await syncProgress(client, USER);
    const [first] = kinds(client, 'select');
    assert.deepEqual(first.filters, []);
    assert.deepEqual(first.range, [0, 999]);
    assert.deepEqual(loadState().entries, { a: entry('done', NEW, true), x: entry('done', OLD, true) });
    const written = JSON.parse(store.get(SYNC_MARKER_KEY));
    assert.equal(written.user, USER.id);
    assert.ok(Date.now() - Date.parse(written.at) < MIN);
  });
}

test('up to 100 pending questions are asked about by key; more than that pulls everything', async () => {
  writeMarker(MIN);
  for (let i = 0; i < 100; i++) mark(`k${i}`, 'done', NEW);
  const client = fakeClient();
  await syncProgress(client, USER);
  const [targeted] = kinds(client, 'select');
  assert.equal(targeted.filters[0][2].length, 100);

  mark('k100', 'done', NEWER);
  for (let i = 0; i < 100; i++) mark(`k${i}`, 'review', NEWER);
  const again = fakeClient();
  await syncProgress(again, USER);
  const [full] = kinds(again, 'select');
  assert.deepEqual(full.filters, []);
  assert.deepEqual(full.range, [0, 999]);
});

test('a full pull reads every page of the account', async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => row(`k${String(i).padStart(4, '0')}`, 'done', OLD));
  const client = fakeClient(rows);
  seed({ entries: { k2400: entry('done', OLD, true) } });
  await syncProgress(client, USER);
  assert.equal(Object.keys(loadState().entries).length, 2500);
  assert.ok(loadState().entries.k2400, 'a synced mark beyond the first page is not mistaken for one cleared elsewhere');
  assert.deepEqual(kinds(client, 'select').map((c) => c.range), [[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
});

test('a server row cap below the page size neither skips rows nor ends the pull early', async () => {
  const rows = Array.from({ length: 1000 }, (_, i) => row(`k${String(i).padStart(4, '0')}`, 'done', OLD));
  await syncProgress(fakeClient(rows, { maxRows: 400 }), USER);
  assert.equal(Object.keys(loadState().entries).length, 1000);
});

// --- Lifecycle. ---

test('startSync syncs at once, and a second startSync adds no second set of listeners', async () => {
  const client = fakeClient();
  mark('a', 'done', OLD);
  await startSync(client, USER);
  assert.equal(synced, 1);
  await startSync(client, USER); // nothing pending, recent pull: nothing to do
  assert.equal(synced, 1);

  click('b', 'done', NEW);
  await idle();
  assert.equal(synced, 2, 'one tap, one run');
  assert.deepEqual(statuses(client), { a: 'done', b: 'done' });
});

test('coming back online starts a run', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  mark('a', 'done', NEW); // made while offline: queued, nothing sent
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.deepEqual(statuses(client), { a: 'done' });
});

test('sign-out stops syncing and forgets the pull marker', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  assert.ok(store.has(SYNC_MARKER_KEY));
  const calls = client.calls.length;

  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  assert.equal(store.has(SYNC_MARKER_KEY), false);
  click('a', 'done', NEW);
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.equal(client.calls.length, calls);
});

test('a run that outlives sign-out leaves no marker and queues no follow-up', async () => {
  const client = fakeClient();
  const release = slowNetwork(client);
  const run = startSync(client, USER);
  click('a', 'done', NEW);
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  release();
  await run;
  assert.equal(kinds(client, 'select').length, 1);
  assert.equal(store.has(SYNC_MARKER_KEY), false);
});

test('syncing can start again after a sign-out', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  mark('a', 'done', NEW);
  await startSync(client, USER);
  assert.deepEqual(statuses(client), { a: 'done' });
});
