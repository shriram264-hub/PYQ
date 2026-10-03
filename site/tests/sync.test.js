import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyState, enqueue, loadState, saveState, setMark } from '../src/lib/accounts/progress-store.js';
import { toggleKey } from '../src/lib/accounts/lists.js';
import { SYNC_MARKER_KEY, startSync, syncLists, syncProgress } from '../src/scripts/sync.js';

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
 * A fake Supabase client for the three tables a sync touches, applying the
 * calls it records to in-memory tables: `.select()`, `.in()`, `.order()` (any
 * number), `.range()`, `.upsert(rows, options)`, `.insert(rows).select(cols)`
 * and `.delete().eq().lt()`, each awaitable to `{ data, error }`.
 *  - hold: a promise the next select waits on after reading, i.e. a slow network
 *  - failOn: 'select' | 'insert' | 'upsert' | 'delete' returns an error for that
 *    call on any table; 'upsert:bookmarks' names one table
 *  - maxRows: the server's row cap per request
 *  - bookmark_sets enforces unique(user_id, name) and a bookmark needs its set
 */
function fakeClient(rows = [], { maxRows = 1000 } = {}) {
  const tables = {
    question_progress: new Map(rows.map((r) => [r.question_key, { ...r }])),
    bookmark_sets: new Map(),
    bookmarks: new Map(),
  };
  const calls = [];
  const client = { calls, table: tables.question_progress, sets: tables.bookmark_sets, bookmarks: tables.bookmarks, hold: null, failOn: null };
  let serial = 0;

  const matches = (call, r) =>
    call.filters.every(([op, col, val]) => {
      if (op === 'eq') return r[col] === val;
      if (op === 'lt') return Date.parse(r[col]) < Date.parse(val);
      return val.includes(r[col]); // 'in'
    });
  const bookmarkId = (r) => `${r.set_id}|${r.question_key}`;
  const refuse = (message, code) => ({ data: null, error: { message, code } });

  async function execute(call) {
    const table = tables[call.table];
    if (client.failOn === call.kind || client.failOn === `${call.kind}:${call.table}`) {
      return refuse(`${call.kind} refused`);
    }
    if (call.kind === 'select') {
      let out = [...table.values()].filter((r) => matches(call, r));
      out.sort((a, b) => {
        for (const col of call.order) if (a[col] !== b[col]) return a[col] < b[col] ? -1 : 1;
        return 0;
      });
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
    if (call.kind === 'insert') {
      const made = [];
      for (const r of call.rows) {
        assert.equal(r.user_id, USER.id, 'every inserted row names its owner');
        const taken = [...table.values(), ...made].some((s) => s.name === r.name);
        if (taken) return refuse('duplicate key value violates unique constraint', '23505');
        made.push({ id: `S${++serial}`, ...r });
      }
      for (const s of made) table.set(s.id, s);
      const columns = (call.returning ?? '').split(',').filter(Boolean);
      return { data: columns.length ? made.map((s) => Object.fromEntries(columns.map((c) => [c, s[c]]))) : null, error: null };
    }
    if (call.kind === 'upsert') {
      for (const r of call.rows) {
        assert.equal(r.user_id, USER.id, 'every uploaded row names its owner');
        if (call.table === 'bookmarks') {
          if (!tables.bookmark_sets.has(r.set_id)) return refuse('a bookmark needs one of your sets');
          if (call.options?.ignoreDuplicates && table.has(bookmarkId(r))) continue;
          table.set(bookmarkId(r), { ...r });
        } else {
          table.set(r.question_key, { ...r });
        }
      }
    } else {
      for (const [k, r] of table) if (matches(call, r)) table.delete(k);
    }
    return { data: null, error: null };
  }

  function query(kind, table, extra = {}) {
    const call = { kind, table, filters: [], order: [], ...extra };
    calls.push(call);
    const q = {
      eq: (col, val) => (call.filters.push(['eq', col, val]), q),
      lt: (col, val) => (call.filters.push(['lt', col, val]), q),
      in: (col, vals) => (call.filters.push(['in', col, vals]), q),
      order: (col) => (call.order.push(col), q),
      range: (from, to) => ((call.range = [from, to]), q),
      select: (columns) => ((call.returning = columns), q), // after an insert
      then: (resolve, reject) => execute(call).then(resolve, reject),
    };
    return q;
  }

  client.from = (name) => {
    assert.ok(name in tables, `unexpected table ${name}`);
    return {
      select: (columns) => query('select', name, { columns }),
      insert: (insRows) => query('insert', name, { rows: insRows }),
      upsert: (upRows, options) => query('upsert', name, { rows: upRows, options }),
      delete: () => query('delete', name),
    };
  };
  return client;
}

const kinds = (client, kind, table = 'question_progress') => client.calls.filter((c) => c.kind === kind && c.table === table);
const listCalls = (client) => client.calls.filter((c) => c.table !== 'question_progress');
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
  assert.deepEqual(listCalls(client), [], 'and the lists step does not start for a signed-out page');
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

// --- Revision lists. ---

const list = (name, keys = [], remoteId = null, syncedKeys = []) => ({ name, keys, remoteId, syncedKeys });
const lists = () => loadState().lists;
const full = { full: true };

// An account that already has this set (and its bookmarks), as another device left it.
function remoteSet(client, id, name, keys = []) {
  client.sets.set(id, { id, user_id: USER.id, name });
  for (const k of keys) client.bookmarks.set(`${id}|${k}`, { set_id: id, question_key: k, user_id: USER.id });
}
function dropRemoteSet(client, id) {
  client.sets.delete(id);
  for (const [k, b] of client.bookmarks) if (b.set_id === id) client.bookmarks.delete(k);
}
const remoteKeys = (client, id) =>
  [...client.bookmarks.values()].filter((b) => b.set_id === id).map((b) => b.question_key).sort();
const setNames = (client) => [...client.sets.values()].map((s) => s.name).sort();

// What save-to-list.js does on a tick, minus the DOM: the change, one save, the event.
function tick(listId, key) {
  const { state, added } = toggleKey(loadState(), listId, key);
  assert.ok(saveState(state));
  document.dispatchEvent(new CustomEvent('sawaalbox:list', { detail: { listId, key, added } }));
}

test('a new list is created on the account first, then its bookmarks are added', async () => {
  seed({ lists: { L1: list('Polity', ['a', 'b']) } });
  const client = fakeClient();
  await syncLists(client, USER, full);
  assert.deepEqual(
    listCalls(client).map((c) => `${c.kind}:${c.table}`),
    ['select:bookmark_sets', 'select:bookmarks', 'insert:bookmark_sets', 'upsert:bookmarks']
  );
  const [insert] = kinds(client, 'insert', 'bookmark_sets');
  assert.deepEqual(insert.rows, [{ name: 'Polity', user_id: USER.id }]);
  assert.equal(insert.returning, 'id,name');
  const [upsert] = kinds(client, 'upsert', 'bookmarks');
  assert.deepEqual(upsert.rows, [
    { set_id: 'S1', question_key: 'a', user_id: USER.id },
    { set_id: 'S1', question_key: 'b', user_id: USER.id },
  ]);
  assert.deepEqual(upsert.options, { onConflict: 'set_id,question_key', ignoreDuplicates: true });
  assert.deepEqual(remoteKeys(client, 'S1'), ['a', 'b']);
  assert.deepEqual(lists(), { L1: list('Polity', ['a', 'b'], 'S1', ['a', 'b']) }, 'same local id, now with the set id and a base');
  assert.equal(synced, 1);
});

test('the lists pull reads every page of sets and of bookmarks', async () => {
  const client = fakeClient([], { maxRows: 400 });
  const keys = Array.from({ length: 1500 }, (_, i) => `k${String(i).padStart(4, '0')}`);
  remoteSet(client, 'R1', 'Big', keys);
  seed({ lists: { L1: list('Big', keys, 'R1', keys) } });
  await syncLists(client, USER, full);
  assert.equal(lists().L1.keys.length, 1500, 'a key beyond the first page is not mistaken for one removed elsewhere');
  const [first] = kinds(client, 'select', 'bookmarks');
  assert.deepEqual(first.order, ['set_id', 'question_key'], 'paged in primary-key order');
  assert.deepEqual(first.range, [0, 999]);
  assert.equal(kinds(client, 'select', 'bookmarks').length, 5, 'four pages of at most 400, then the empty one');
  assert.deepEqual(listCalls(client).filter((c) => c.kind !== 'select'), []);
});

test('a key removed here is deleted from the account, one bookmark per request', async () => {
  seed({ lists: { L1: list('Polity', ['a'], 'R1', ['a', 'b']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a', 'b']);
  await syncLists(client, USER, full);
  const [del] = kinds(client, 'delete', 'bookmarks');
  assert.deepEqual(del.filters, [
    ['eq', 'set_id', 'R1'],
    ['eq', 'question_key', 'b'],
  ]);
  assert.deepEqual(remoteKeys(client, 'R1'), ['a']);
  assert.deepEqual(lists().L1, list('Polity', ['a'], 'R1', ['a']));
  assert.deepEqual(kinds(client, 'upsert', 'bookmarks'), []);
});

test('a key removed on another device leaves this one, and nothing is written', async () => {
  seed({ lists: { L1: list('Polity', ['a', 'b'], 'R1', ['a', 'b']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a']);
  await syncLists(client, USER, full);
  assert.deepEqual(lists().L1, list('Polity', ['a'], 'R1', ['a']));
  assert.deepEqual(remoteKeys(client, 'R1'), ['a']);
  assert.deepEqual(listCalls(client).filter((c) => c.kind !== 'select'), []);
  assert.equal(synced, 1);
});

test('a list deleted on another device leaves this one', async () => {
  seed({ lists: { L1: list('Gone', ['a'], 'R9', ['a']), L2: list('Kept', ['k'], 'R2', ['k']) } });
  const client = fakeClient();
  remoteSet(client, 'R2', 'Kept', ['k']);
  await syncLists(client, USER, full);
  assert.deepEqual(Object.keys(lists()), ['L2']);
  assert.deepEqual(setNames(client), ['Kept'], 'and is not recreated on the account');
});

test('lists from another account are dropped, and this account sets arrive', async () => {
  seed({ lists: { L1: list('Theirs', ['a'], 'OTHER', ['a']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Mine', ['z']);
  await syncLists(client, USER, full);
  assert.deepEqual(lists(), { R1: list('Mine', ['z'], 'R1', ['z']) });
});

test('first sign-in: a list joins the account list of its name and the keys are unioned', async () => {
  seed({ lists: { L1: list('Polity', ['mine', 'both']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['both', 'theirs']);
  await syncLists(client, USER, full);
  assert.deepEqual(remoteKeys(client, 'R1'), ['both', 'mine', 'theirs']);
  assert.deepEqual(kinds(client, 'insert', 'bookmark_sets'), [], 'no second set of that name');
  assert.deepEqual(kinds(client, 'upsert', 'bookmarks')[0].rows, [{ set_id: 'R1', question_key: 'mine', user_id: USER.id }]);
  assert.deepEqual(Object.keys(lists()), ['L1']);
  assert.equal(lists().L1.remoteId, 'R1');
  assert.deepEqual([...lists().L1.keys].sort(), ['both', 'mine', 'theirs']);
});

test('a set made on another device arrives as a list', async () => {
  const client = fakeClient();
  remoteSet(client, 'R1', 'Maps', ['q']);
  await syncLists(client, USER, full);
  assert.deepEqual(lists(), { R1: list('Maps', ['q'], 'R1', ['q']) });
  assert.equal(synced, 1);
});

test('a run with nothing to change saves nothing and fires no event', async () => {
  seed({ lists: { L1: list('Polity', ['a'], 'R1', ['a']) } });
  const before = store.get(STORAGE_KEY);
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a']);
  await syncLists(client, USER, full);
  assert.equal(store.get(STORAGE_KEY), before);
  assert.equal(synced, 0);
});

test('a lists save keeps the marks and the queue as they are', async () => {
  mark('a', 'done', OLD);
  const queued = loadState().pending;
  const client = fakeClient();
  remoteSet(client, 'R1', 'Maps', ['q']);
  await syncLists(client, USER, full);
  assert.deepEqual(loadState().pending, queued);
  assert.deepEqual(loadState().entries, { a: entry('done', OLD, false) });
  assert.ok(lists().R1);
});

// --- Lists: full or targeted. ---

test('a clean targeted run does not touch the list tables', async () => {
  writeMarker(MIN);
  seed({ lists: { L1: list('Polity', ['a', 'b'], 'R1', ['b', 'a']) } });
  mark('x', 'done', NEW); // progress has something to ask about, so a run happens
  const client = fakeClient();
  await startSync(client, USER);
  assert.equal(kinds(client, 'select').length, 1, 'the progress question was asked');
  assert.deepEqual(listCalls(client), []);
  assert.deepEqual(statuses(client), { x: 'done' });
});

test('syncLists on its own does nothing, and says nothing, for clean lists when not full', async () => {
  seed({ lists: { L1: list('Polity', ['a'], 'R1', ['a']) } });
  const client = fakeClient();
  await syncLists(client, USER, { full: false });
  assert.deepEqual(client.calls, []);
  assert.equal(synced, 0);
});

for (const [name, dirty] of Object.entries({
  'a list never uploaded': list('New', ['a']),
  'a key added since the last sync': list('Polity', ['a', 'b'], 'R1', ['a']),
  'a key removed since the last sync': list('Polity', [], 'R1', ['a']),
})) {
  test(`${name} makes a targeted run pull the lists`, async () => {
    writeMarker(MIN);
    seed({ lists: { L1: dirty } });
    const client = fakeClient();
    remoteSet(client, 'R1', 'Polity', ['a']);
    await startSync(client, USER);
    assert.deepEqual(kinds(client, 'select', 'bookmark_sets').length, 2);
    assert.equal(kinds(client, 'select').length, 0, 'progress had nothing to ask');
    assert.equal(lists().L1.syncedKeys.length, lists().L1.keys.length);
    assert.ok(lists().L1.remoteId);
  });
}

test('a full run pulls the lists even when none is dirty', async () => {
  const client = fakeClient();
  remoteSet(client, 'R1', 'Maps', ['q']);
  await startSync(client, USER);
  assert.deepEqual(lists(), { R1: list('Maps', ['q'], 'R1', ['q']) });
});

// --- Lists: failure. ---

for (const failing of ['select:bookmark_sets', 'select:bookmarks', 'insert', 'upsert', 'delete']) {
  test(`a failed ${failing} request leaves the lists untouched and fires no event`, async () => {
    seed({
      lists: {
        L1: list('New', ['n']),
        L2: list('Old', ['a'], 'R2', ['a', 'gone']),
      },
    });
    const client = fakeClient();
    remoteSet(client, 'R2', 'Old', ['a', 'gone']);
    client.failOn = failing;
    const before = store.get(STORAGE_KEY);
    await assert.rejects(syncLists(client, USER, full), { message: `${failing.split(':')[0]} refused` });
    assert.equal(store.get(STORAGE_KEY), before);
    assert.equal(synced, 0);
  });
}

test('a lists save that storage refuses is a failure: no event', async () => {
  const client = fakeClient();
  remoteSet(client, 'R1', 'Maps', ['q']);
  failWrites = true;
  await assert.rejects(syncLists(client, USER, full), /lists could not be saved/);
  assert.equal(synced, 0);
});

test('a failed lists pull on a full run makes the next run pull everything again', async () => {
  const client = fakeClient();
  client.failOn = 'select:bookmarks';
  await startSync(client, USER);
  const [warning] = takeWarnings();
  assert.equal(warning[0], 'SawaalBox: will retry syncing lists');
  assert.equal(store.has(SYNC_MARKER_KEY), false, 'the progress step renewed it; the failure took it back');

  client.failOn = null;
  remoteSet(client, 'R1', 'Maps', ['q']);
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.deepEqual(lists(), { R1: list('Maps', ['q'], 'R1', ['q']) });
});

test('progress failing does not hold the lists back, and lists failing does not undo progress', async () => {
  mark('a', 'done', OLD);
  seed({ ...loadState(), lists: { L1: list('Polity', ['x']) } });
  const client = fakeClient();
  client.failOn = 'select:question_progress';
  await startSync(client, USER);
  assert.equal(takeWarnings().length, 1);
  assert.deepEqual(remoteKeys(client, 'S1'), ['x']);
  assert.equal(lists().L1.remoteId, 'S1');

  client.failOn = 'select:bookmark_sets';
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.equal(takeWarnings().length, 1);
  assert.deepEqual(statuses(client), { a: 'done' }, 'the progress step ran on its own');
});

// --- Lists: changes made while a run is in flight. ---

test('a key saved while a lists run awaits the network survives it and is sent by the next run', async () => {
  seed({ lists: { L1: list('Polity', ['a']) } });
  const client = fakeClient();
  const release = slowNetwork(client);
  const run = syncLists(client, USER, full);
  tick('L1', 'during'); // the person ticks another box while the account is being read
  release();
  await run;
  assert.deepEqual(remoteKeys(client, 'S1'), ['a'], 'the run sent only what it had seen');
  assert.deepEqual(lists().L1, list('Polity', ['a', 'during'], 'S1', ['a']), 'kept, and still unsynced');

  await syncLists(client, USER, { full: false });
  assert.deepEqual(remoteKeys(client, 'S1'), ['a', 'during']);
  assert.deepEqual(lists().L1, list('Polity', ['a', 'during'], 'S1', ['a', 'during']));
});

test('a key unticked while a lists run is in flight stays unticked and is deleted by the next run', async () => {
  seed({ lists: { L1: list('Polity', ['a', 'b'], 'R1', ['a', 'b']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a', 'b']);
  const release = slowNetwork(client);
  const run = syncLists(client, USER, full);
  tick('L1', 'b');
  release();
  await run;
  assert.deepEqual(lists().L1, list('Polity', ['a'], 'R1', ['a', 'b']));
  await syncLists(client, USER, { full: false });
  assert.deepEqual(remoteKeys(client, 'R1'), ['a']);
  assert.deepEqual(lists().L1, list('Polity', ['a'], 'R1', ['a']));
});

test('a list created while a lists run awaits the network is kept as made, and the next run creates it', async () => {
  const client = fakeClient();
  remoteSet(client, 'R1', 'Maps', ['q']);
  const release = slowNetwork(client);
  const run = syncLists(client, USER, full);
  seed({ ...loadState(), lists: { fresh: list('Fresh', ['f']) } });
  release();
  await run;
  assert.deepEqual(setNames(client), ['Maps'], 'the run had not seen it');
  assert.deepEqual(lists(), { fresh: list('Fresh', ['f']), R1: list('Maps', ['q'], 'R1', ['q']) });

  await syncLists(client, USER, { full: false });
  assert.deepEqual(setNames(client), ['Fresh', 'Maps']);
  assert.deepEqual(lists().fresh, list('Fresh', ['f'], 'S1', ['f']));
});

test('a list made while the progress step runs is created by that run, and the follow-up finds nothing left', async () => {
  const client = fakeClient();
  const release = slowNetwork(client);
  const first = startSync(client, USER);
  seed({ ...loadState(), lists: { fresh: list('Fresh', ['f']) } });
  document.dispatchEvent(new CustomEvent('sawaalbox:list', { detail: { listId: 'fresh', key: 'f', added: true } }));
  release();
  await first;
  assert.deepEqual(setNames(client), ['Fresh']);
  assert.equal(kinds(client, 'insert', 'bookmark_sets').length, 1);
  assert.deepEqual(lists().fresh, list('Fresh', ['f'], 'S1', ['f']));
});

// --- Lists: wiring. ---

test('a list change starts a run, one per change, and not after sign-out', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  seed({ ...loadState(), lists: { L1: list('Polity', []) } });
  document.dispatchEvent(new CustomEvent('sawaalbox:list', { detail: { listId: 'L1', key: 'a', added: true } }));
  await idle();
  assert.deepEqual(setNames(client), ['Polity']);

  tick('L1', 'a');
  await idle();
  assert.deepEqual(remoteKeys(client, 'S1'), ['a']);
  tick('L1', 'a'); // un-ticked
  await idle();
  assert.deepEqual(remoteKeys(client, 'S1'), []);

  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  const calls = client.calls.length;
  tick('L1', 'b');
  await idle();
  assert.equal(client.calls.length, calls);
});

test('two devices creating the same list name end up on one set', async () => {
  // This device read the account before the other device made "Polity", then its insert was refused.
  seed({ lists: { L1: list('Polity', ['mine']) } });
  const client = fakeClient();
  const release = slowNetwork(client);
  const run = syncLists(client, USER, full);
  await idle(); // the reads are done and held
  remoteSet(client, 'R7', 'Polity', ['theirs']); // the other device, after our read
  release();
  await assert.rejects(run, { code: '23505' }); // unique(user_id, name)
  assert.deepEqual(lists().L1, list('Polity', ['mine']), 'untouched');

  await syncLists(client, USER, full); // the next run joins it by name
  assert.deepEqual(setNames(client), ['Polity']);
  assert.deepEqual(remoteKeys(client, 'R7'), ['mine', 'theirs']);
  assert.equal(lists().L1.remoteId, 'R7');
  assert.deepEqual([...lists().L1.keys].sort(), ['mine', 'theirs']);
});

test('removing a list key on one device and re-syncing another does not bring it back', async () => {
  // Device A and B both synced list R1 = {a, b}. B removes b and syncs. A, still holding b, syncs.
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a', 'b']);
  seed({ lists: { L1: list('Polity', ['a'], 'R1', ['a', 'b']) } }); // device B
  await syncLists(client, USER, full);
  assert.deepEqual(remoteKeys(client, 'R1'), ['a']);

  seed({ lists: { L1: list('Polity', ['a', 'b'], 'R1', ['a', 'b']) } }); // device A
  await syncLists(client, USER, full);
  assert.deepEqual(remoteKeys(client, 'R1'), ['a'], 'the account still lacks b');
  assert.deepEqual(lists().L1.keys, ['a'], 'and A dropped it');
});
