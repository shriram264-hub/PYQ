import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, emptyState, enqueue, loadState, saveState, setMark } from '../src/lib/accounts/progress-store.js';
import { toggleKey } from '../src/lib/accounts/lists.js';
import { OWNER_KEY } from '../src/lib/accounts/pull.js';
import { SYNC_MARKER_KEY, startSync, syncProgress } from '../src/scripts/sync.js';
import { LISTS_MARKER_KEY, syncLists } from '../src/scripts/sync-lists.js';
import { finishSyncing } from '../src/scripts/auth.js';

const USER = { id: 'user-1' };
const OLD = '2026-10-01T10:00:00.000Z';
const NEW = '2026-10-02T10:00:00.000Z';
const NEWER = '2026-10-03T10:00:00.000Z';
const MIN = 60 * 1000;

// Marks are kept only under question keys of the shape the account accepts
// (parseState drops any other), so the progress tests use real ones.
const A = 'upsc-2019-1';
const B = 'upsc-2019-2';
const C = 'upsc-2019-3';
const D = 'upsc-2019-4';
const X = 'upsc-2020-1';
const GONE = 'upsc-2019-9';

const entry = (status, updatedAt, synced = false) => ({ status, updatedAt, synced });
const row = (question_key, status, updated_at, user = USER) => ({ user_id: user.id, question_key, status, updated_at });

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
 *  - user: whose account this is. Row-level security shows each account only
 *    its own rows, so two accounts are two clients, and every write must name
 *    this one as the owner.
 *  - bookmark_sets enforces unique(user_id, name) and a bookmark needs its set
 */
function fakeClient(rows = [], { maxRows = 1000, user = USER } = {}) {
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
        assert.equal(r.user_id, user.id, 'every inserted row names its owner');
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
        assert.equal(r.user_id, user.id, 'every uploaded row names its owner');
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
const writeListsMarker = (ageMs, user = USER.id) =>
  store.set(LISTS_MARKER_KEY, JSON.stringify({ user, at: new Date(Date.now() - ageMs).toISOString() }));
// The fake network settles on microtasks, so one timer turn lets everything finish.
const idle = () => new Promise((resolve) => setTimeout(resolve, 5));
function slowNetwork(client) {
  let release;
  client.hold = new Promise((resolve) => (release = resolve));
  return release;
}

// --- What a sync does. ---

test('an unsynced local mark is uploaded and becomes synced', async () => {
  mark(A, 'done', OLD);
  const client = fakeClient();
  await syncProgress(client, USER);
  const [upload] = kinds(client, 'upsert');
  assert.deepEqual(upload.rows, [{ question_key: A, status: 'done', updated_at: OLD, user_id: USER.id }]);
  assert.deepEqual(upload.options, { onConflict: 'user_id,question_key' });
  assert.deepEqual(loadState().entries, { [A]: entry('done', OLD, true) });
  assert.deepEqual(loadState().pending, []);
  assert.equal(synced, 1);
});

test('account marks arrive on this device, and marks cleared elsewhere leave it', async () => {
  seed({ entries: { [GONE]: entry('done', OLD, true) } });
  await syncProgress(fakeClient([row(B, 'review', NEW)]), USER);
  assert.deepEqual(loadState().entries, { [B]: entry('review', NEW, true) });
  assert.equal(synced, 1);
});

test('a pending delete newer than the account row issues a conditional delete and the entry stays gone', async () => {
  mark(A, 'done', OLD);
  mark(A, null, NEW);
  const client = fakeClient([row(A, 'done', OLD)]);
  await syncProgress(client, USER);
  const [del] = kinds(client, 'delete');
  assert.deepEqual(del.filters, [
    ['eq', 'user_id', USER.id],
    ['eq', 'question_key', A],
    ['lt', 'updated_at', NEW],
  ]);
  assert.deepEqual(statuses(client), {});
  assert.deepEqual(loadState().entries, {});
  assert.deepEqual(loadState().pending, []);
});

test('a newer edit another device makes before the delete lands survives it', async () => {
  mark(A, 'done', OLD);
  mark(A, null, NEW);
  const client = fakeClient([row(A, 'done', OLD)]);
  const release = slowNetwork(client);
  const run = syncProgress(client, USER);
  client.table.set(A, row(A, 'review', NEWER)); // the other device, after our read
  release();
  await run;
  assert.deepEqual(statuses(client), { [A]: 'review' });
  assert.deepEqual(loadState().pending, []);
});

test('an account row newer than a pending delete wins and the pending delete is cleared', async () => {
  mark(A, 'done', OLD);
  mark(A, null, NEW);
  const client = fakeClient([row(A, 'review', NEWER)]);
  await syncProgress(client, USER);
  assert.deepEqual(kinds(client, 'delete'), []);
  assert.deepEqual(loadState().entries, { [A]: entry('review', NEWER, true) });
  assert.deepEqual(loadState().pending, []);
});

test('a mark made while a run awaits the network survives the run and stays pending', async () => {
  mark(A, 'done', OLD);
  const client = fakeClient();
  const release = slowNetwork(client);
  const run = syncProgress(client, USER);
  mark(B, 'review', NEW); // the person taps while the account is being read
  release();
  await run;
  assert.deepEqual(loadState().entries, { [A]: entry('done', OLD, true), [B]: entry('review', NEW, false) });
  assert.deepEqual(loadState().pending, [{ type: 'upsert', key: B, status: 'review', at: NEW }]);
});

test('marks made during a run trigger exactly one follow-up run, which uploads them', async () => {
  mark(A, 'done', OLD);
  const client = fakeClient();
  const release = slowNetwork(client);
  const first = startSync(client, USER);
  click(B, 'review', NEW);
  click(C, 'done', NEW); // two taps, one follow-up
  release();
  await first;
  assert.equal(synced, 2);
  const targeted = kinds(client, 'select').filter((c) => c.filters.length);
  assert.equal(targeted.length, 1);
  assert.deepEqual(targeted[0].filters, [['in', 'question_key', [B, C]]]);
  assert.deepEqual(statuses(client), { [A]: 'done', [B]: 'review', [C]: 'done' });
  assert.deepEqual(loadState().pending, []);
});

test('re-marking a question during a run is not overwritten by the run', async () => {
  mark(A, 'done', OLD);
  const client = fakeClient();
  const release = slowNetwork(client);
  const first = startSync(client, USER);
  click(A, 'review', NEW);
  release();
  await first;
  assert.deepEqual(statuses(client), { [A]: 'review' });
  assert.deepEqual(loadState().entries, { [A]: entry('review', NEW, true) });
});

// --- Failure. ---

for (const failing of ['select', 'upsert', 'delete']) {
  test(`a failed ${failing} request leaves storage untouched and fires no synced event`, async () => {
    mark(A, 'done', OLD);
    mark(A, null, NEW); // a pending delete, for the account's older copy
    mark(B, 'review', NEW); // and a mark to upload
    const client = fakeClient([row(A, 'done', OLD)]);
    client.failOn = failing;
    const before = store.get(STORAGE_KEY);
    await assert.rejects(syncProgress(client, USER), { message: `${failing} refused` });
    assert.equal(store.get(STORAGE_KEY), before);
    assert.equal(store.has(SYNC_MARKER_KEY), false);
    assert.equal(synced, 0);
  });
}

test('a failed run is logged, and the next trigger retries it', async () => {
  mark(A, 'done', OLD);
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
  assert.deepEqual(statuses(client), { [A]: 'done' });
});

test('a save that storage refuses is a failure: no event, no marker', async () => {
  mark(A, 'done', OLD);
  failWrites = true;
  await assert.rejects(syncProgress(fakeClient([row(B, 'done', OLD)]), USER), /could not be saved/);
  assert.equal(synced, 0);
  assert.equal(store.has(SYNC_MARKER_KEY), false);
});

test('blocked storage is a failure too, not a crash', async () => {
  blocked = true;
  await assert.rejects(syncProgress(fakeClient([row(B, 'done', OLD)]), USER), /could not be saved/);
  assert.equal(synced, 0);
});

// --- Full or targeted. ---

test('with a recent full pull, a run asks only about the pending questions and leaves the rest alone', async () => {
  writeMarker(MIN);
  const marker = store.get(SYNC_MARKER_KEY);
  seed({ entries: { [C]: entry('done', OLD, false), [D]: entry('review', OLD, true) } });
  mark(A, 'done', NEW);
  const client = fakeClient([row(A, 'review', OLD), row(X, 'done', OLD)]);
  await syncProgress(client, USER);
  const selects = kinds(client, 'select');
  assert.equal(selects.length, 1);
  assert.deepEqual(selects[0].filters, [['in', 'question_key', [A]]]);
  assert.equal(selects[0].range, undefined);
  assert.deepEqual(loadState().entries, {
    [A]: entry('done', NEW, true),
    [C]: entry('done', OLD, false), // not asked about: not uploaded, flag unchanged
    [D]: entry('review', OLD, true), // not asked about: not dropped for being absent from the reply
  });
  assert.deepEqual(statuses(client), { [A]: 'done', [X]: 'done' });
  assert.equal(store.get(SYNC_MARKER_KEY), marker, 'only a full pull renews the marker');
  assert.equal(synced, 1);
});

test('with a recent full pull and nothing pending, a run does nothing', async () => {
  writeMarker(MIN);
  seed({ entries: { [C]: entry('done', OLD, true) } });
  const client = fakeClient([row(X, 'done', OLD)]);
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
    mark(A, 'done', NEW);
    const client = fakeClient([row(X, 'done', OLD)]);
    await syncProgress(client, USER);
    const [first] = kinds(client, 'select');
    assert.deepEqual(first.filters, []);
    assert.deepEqual(first.range, [0, 999]);
    assert.deepEqual(loadState().entries, { [A]: entry('done', NEW, true), [X]: entry('done', OLD, true) });
    const written = JSON.parse(store.get(SYNC_MARKER_KEY));
    assert.equal(written.user, USER.id);
    assert.ok(Date.now() - Date.parse(written.at) < MIN);
  });
}

// Many distinct keys, all of the accepted shape: question n of 2010.
const nth = (i) => `upsc-2010-${i}`;

test('up to 100 pending questions are asked about by key; more than that pulls everything', async () => {
  writeMarker(MIN);
  for (let i = 0; i < 100; i++) mark(nth(i), 'done', NEW);
  const client = fakeClient();
  await syncProgress(client, USER);
  const [targeted] = kinds(client, 'select');
  assert.equal(targeted.filters[0][2].length, 100);

  mark(nth(100), 'done', NEWER);
  for (let i = 0; i < 100; i++) mark(nth(i), 'review', NEWER);
  const again = fakeClient();
  await syncProgress(again, USER);
  const [full] = kinds(again, 'select');
  assert.deepEqual(full.filters, []);
  assert.deepEqual(full.range, [0, 999]);
});

// More rows than one page holds: a thousand questions a year, from 2000.
const many = (n) => Array.from({ length: n }, (_, i) => `upsc-${2000 + Math.floor(i / 1000)}-${i % 1000}`);

test('a full pull reads every page of the account', async () => {
  const keys = many(2500);
  const client = fakeClient(keys.map((k) => row(k, 'done', OLD)));
  const late = 'upsc-2002-400'; // sorts into the third page
  assert.ok(keys.includes(late));
  seed({ entries: { [late]: entry('done', OLD, true) } });
  await syncProgress(client, USER);
  assert.equal(Object.keys(loadState().entries).length, 2500);
  assert.ok(loadState().entries[late], 'a synced mark beyond the first page is not mistaken for one cleared elsewhere');
  assert.deepEqual(kinds(client, 'select').map((c) => c.range), [[0, 999], [1000, 1999], [2000, 2999], [2500, 3499]]);
});

test('a server row cap below the page size neither skips rows nor ends the pull early', async () => {
  const rows = many(1000).map((k) => row(k, 'done', OLD));
  await syncProgress(fakeClient(rows, { maxRows: 400 }), USER);
  assert.equal(Object.keys(loadState().entries).length, 1000);
});

// --- Lifecycle. ---

test('startSync syncs at once, and a second startSync adds no second set of listeners', async () => {
  const client = fakeClient();
  mark(A, 'done', OLD);
  await startSync(client, USER);
  assert.equal(synced, 1);
  await startSync(client, USER); // nothing pending, recent pull: nothing to do
  assert.equal(synced, 1);

  click(B, 'done', NEW);
  await idle();
  assert.equal(synced, 2, 'one tap, one run');
  assert.deepEqual(statuses(client), { [A]: 'done', [B]: 'done' });
});

test('coming back online starts a run', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  mark(A, 'done', NEW); // made while offline: queued, nothing sent
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.deepEqual(statuses(client), { [A]: 'done' });
});

test('sign-out stops syncing and forgets the pull marker', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  assert.ok(store.has(SYNC_MARKER_KEY));
  const calls = client.calls.length;

  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  assert.equal(store.has(SYNC_MARKER_KEY), false);
  click(A, 'done', NEW);
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.equal(client.calls.length, calls);
});

test('a run that outlives sign-out leaves no marker and queues no follow-up', async () => {
  const client = fakeClient();
  const release = slowNetwork(client);
  const run = startSync(client, USER);
  click(A, 'done', NEW);
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
  mark(A, 'done', NEW);
  await startSync(client, USER);
  assert.deepEqual(statuses(client), { [A]: 'done' });
});

// --- Revision lists. ---

const list = (name, keys = [], remoteId = null, syncedKeys = []) => ({ name, keys, remoteId, syncedKeys });
const lists = () => loadState().lists;

// An account that already has this set (and its bookmarks), as another device left it.
function remoteSet(client, id, name, keys = [], user = USER) {
  client.sets.set(id, { id, user_id: user.id, name });
  for (const k of keys) client.bookmarks.set(`${id}|${k}`, { set_id: id, question_key: k, user_id: user.id });
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
  await syncLists(client, USER);
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
  await syncLists(client, USER);
  assert.equal(lists().L1.keys.length, 1500, 'a key beyond the first page is not mistaken for one removed elsewhere');
  const [first] = kinds(client, 'select', 'bookmarks');
  assert.deepEqual(first.order, ['set_id', 'question_key'], 'paged in primary-key order');
  assert.deepEqual(first.range, [0, 999]);
  assert.equal(kinds(client, 'select', 'bookmarks').length, 5, 'four pages of at most 400, then the empty one');
  assert.deepEqual(listCalls(client).filter((c) => c.kind !== 'select'), []);
});

test('a key removed here is deleted from the account', async () => {
  seed({ lists: { L1: list('Polity', ['a'], 'R1', ['a', 'b']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a', 'b']);
  await syncLists(client, USER);
  const [del] = kinds(client, 'delete', 'bookmarks');
  assert.deepEqual(del.filters, [
    ['eq', 'set_id', 'R1'],
    ['eq', 'user_id', USER.id],
    ['in', 'question_key', ['b']],
  ]);
  assert.deepEqual(remoteKeys(client, 'R1'), ['a']);
  assert.deepEqual(lists().L1, list('Polity', ['a'], 'R1', ['a']));
  assert.deepEqual(kinds(client, 'upsert', 'bookmarks'), []);
});

test('removals are one delete per set, not one per bookmark', async () => {
  seed({
    lists: {
      L1: list('Polity', ['keep'], 'R1', ['keep', 'a', 'b']),
      L2: list('Maps', [], 'R2', ['c']),
    },
  });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['keep', 'a', 'b']);
  remoteSet(client, 'R2', 'Maps', ['c']);
  await syncLists(client, USER);
  const dels = kinds(client, 'delete', 'bookmarks');
  assert.deepEqual(
    dels.map((d) => [d.filters[0][2], d.filters[2][2]]),
    [['R1', ['a', 'b']], ['R2', ['c']]]
  );
  assert.deepEqual(remoteKeys(client, 'R1'), ['keep']);
  assert.deepEqual(remoteKeys(client, 'R2'), []);
});

test('a long run of removals is split so the request URL stays short', async () => {
  const keys = Array.from({ length: 250 }, (_, i) => `k${String(i).padStart(3, '0')}`);
  seed({ lists: { L1: list('Big', [], 'R1', keys) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Big', keys);
  await syncLists(client, USER);
  assert.deepEqual(kinds(client, 'delete', 'bookmarks').map((d) => d.filters[2][2].length), [100, 100, 50]);
  assert.deepEqual(remoteKeys(client, 'R1'), []);
  assert.deepEqual(lists().L1, list('Big', [], 'R1', []));
});

test('a key removed on another device leaves this one, and nothing is written', async () => {
  seed({ lists: { L1: list('Polity', ['a', 'b'], 'R1', ['a', 'b']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a']);
  await syncLists(client, USER);
  assert.deepEqual(lists().L1, list('Polity', ['a'], 'R1', ['a']));
  assert.deepEqual(remoteKeys(client, 'R1'), ['a']);
  assert.deepEqual(listCalls(client).filter((c) => c.kind !== 'select'), []);
  assert.equal(synced, 1);
});

test('a list deleted on another device leaves this one', async () => {
  seed({ lists: { L1: list('Gone', ['a'], 'R9', ['a']), L2: list('Kept', ['k'], 'R2', ['k']) } });
  const client = fakeClient();
  remoteSet(client, 'R2', 'Kept', ['k']);
  await syncLists(client, USER);
  assert.deepEqual(Object.keys(lists()), ['L2']);
  assert.deepEqual(setNames(client), ['Kept'], 'and is not recreated on the account');
});

test('lists from another account are dropped, and this account sets arrive', async () => {
  seed({ lists: { L1: list('Theirs', ['a'], 'OTHER', ['a']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Mine', ['z']);
  await syncLists(client, USER);
  assert.deepEqual(lists(), { R1: list('Mine', ['z'], 'R1', ['z']) });
});

test('first sign-in: a list joins the account list of its name and the keys are unioned', async () => {
  seed({ lists: { L1: list('Polity', ['mine', 'both']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['both', 'theirs']);
  await syncLists(client, USER);
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
  await syncLists(client, USER);
  assert.deepEqual(lists(), { R1: list('Maps', ['q'], 'R1', ['q']) });
  assert.equal(synced, 1);
});

test('a run with nothing to change saves nothing and fires no event', async () => {
  seed({ lists: { L1: list('Polity', ['a'], 'R1', ['a']) } });
  const before = store.get(STORAGE_KEY);
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a']);
  await syncLists(client, USER);
  assert.equal(store.get(STORAGE_KEY), before);
  assert.equal(synced, 0);
});

test('a lists save keeps the marks and the queue as they are', async () => {
  mark(A, 'done', OLD);
  const queued = loadState().pending;
  const client = fakeClient();
  remoteSet(client, 'R1', 'Maps', ['q']);
  await syncLists(client, USER);
  assert.deepEqual(loadState().pending, queued);
  assert.deepEqual(loadState().entries, { [A]: entry('done', OLD, false) });
  assert.ok(lists().R1);
});

// --- Lists: full or targeted. ---

test('a clean targeted run does not touch the list tables', async () => {
  writeMarker(MIN);
  writeListsMarker(MIN);
  seed({ lists: { L1: list('Polity', ['a', 'b'], 'R1', ['b', 'a']) } });
  mark(X, 'done', NEW); // progress has something to ask about, so a run happens
  const client = fakeClient();
  await startSync(client, USER);
  assert.equal(kinds(client, 'select').length, 1, 'the progress question was asked');
  assert.deepEqual(listCalls(client), []);
  assert.deepEqual(statuses(client), { [X]: 'done' });
});

test('syncLists on its own does nothing, and says nothing, for clean lists while its marker is fresh', async () => {
  writeListsMarker(MIN);
  seed({ lists: { L1: list('Polity', ['a'], 'R1', ['a']) } });
  const client = fakeClient();
  await syncLists(client, USER);
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
    writeListsMarker(MIN);
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
    await assert.rejects(syncLists(client, USER), { message: `${failing.split(':')[0]} refused` });
    assert.equal(store.get(STORAGE_KEY), before);
    assert.equal(store.has(LISTS_MARKER_KEY), false, 'a failed pull is not a pull');
    assert.equal(synced, 0);
  });
}

test('a lists save that storage refuses is a failure: no event', async () => {
  const client = fakeClient();
  remoteSet(client, 'R1', 'Maps', ['q']);
  failWrites = true;
  await assert.rejects(syncLists(client, USER), /lists could not be saved/);
  assert.equal(synced, 0);
});

test('a lists step that keeps failing is retried each run, and never makes the progress step pull everything again', async () => {
  const client = fakeClient();
  client.failOn = 'select:bookmark_sets';
  await startSync(client, USER); // the first run: progress pulls everything, lists fail
  const [warning] = takeWarnings();
  assert.equal(warning[0], 'SawaalBox: will retry syncing lists');
  assert.ok(store.has(SYNC_MARKER_KEY), 'the progress marker stands');
  assert.equal(store.has(LISTS_MARKER_KEY), false, 'nothing was pulled, so no lists marker');
  assert.equal(kinds(client, 'select', 'bookmark_sets').length, 1);

  for (const key of [A, B]) {
    mark(key, 'done', NEW);
    window.dispatchEvent(new Event('online'));
    await idle();
    assert.equal(takeWarnings().length, 1, 'the lists step failed again');
    const last = kinds(client, 'select').at(-1);
    assert.deepEqual(last.filters, [['in', 'question_key', [key]]], `run for ${key}: progress asked only about its key`);
    assert.equal(last.range, undefined);
  }
  assert.equal(kinds(client, 'select', 'bookmark_sets').length, 3, 'and lists were retried on every run');
  assert.equal(kinds(client, 'select').filter((c) => c.range).length, 1, 'there was one full progress pull, the first');

  client.failOn = null;
  remoteSet(client, 'R1', 'Maps', ['q']);
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.deepEqual(takeWarnings(), []);
  assert.deepEqual(lists(), { R1: list('Maps', ['q'], 'R1', ['q']) });
  assert.ok(store.has(LISTS_MARKER_KEY), 'a successful full lists pull writes it');
});

const LISTS_FULL_PULL_CASES = {
  'no marker': () => {},
  'a marker older than 10 minutes': () => writeListsMarker(11 * MIN),
  'a marker for another user': () => writeListsMarker(MIN, 'someone-else'),
  'a marker dated in the future': () => writeListsMarker(-MIN),
  'an unreadable marker': () => store.set(LISTS_MARKER_KEY, '{nope'),
};
for (const [name, setup] of Object.entries(LISTS_FULL_PULL_CASES)) {
  test(`${name}: the lists step pulls even though nothing is dirty, and writes its own marker`, async () => {
    setup();
    seed({ lists: { L1: list('Polity', ['a'], 'R1', ['a']) } });
    const client = fakeClient();
    remoteSet(client, 'R1', 'Polity', ['a']);
    await syncLists(client, USER);
    assert.ok(kinds(client, 'select', 'bookmark_sets').length > 0);
    const written = JSON.parse(store.get(LISTS_MARKER_KEY));
    assert.equal(written.user, USER.id);
    assert.ok(Date.now() - Date.parse(written.at) < MIN);
    assert.equal(store.has(SYNC_MARKER_KEY), false, 'the progress marker is not the lists step\'s to write');
  });
}

test('the lists marker is written only by a full pull that also saved: a targeted run leaves it, a failure does not write it', async () => {
  writeListsMarker(MIN);
  const marker = store.get(LISTS_MARKER_KEY);
  seed({ lists: { L1: list('New', ['n']) } }); // dirty: a targeted pull
  const client = fakeClient();
  await syncLists(client, USER);
  assert.equal(kinds(client, 'insert', 'bookmark_sets').length, 1);
  assert.equal(store.get(LISTS_MARKER_KEY), marker, 'only a full pull renews it');

  store.delete(LISTS_MARKER_KEY);
  failWrites = true;
  remoteSet(client, 'R9', 'Maps', ['q']);
  await assert.rejects(syncLists(client, USER), /lists could not be saved/);
  assert.equal(store.has(LISTS_MARKER_KEY), false, 'the pull worked but the save did not');
});

test('sign-out forgets both pull markers, and a run that outlives it leaves neither', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  assert.ok(store.has(SYNC_MARKER_KEY) && store.has(LISTS_MARKER_KEY));
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  assert.equal(store.has(SYNC_MARKER_KEY) || store.has(LISTS_MARKER_KEY), false);

  const slow = fakeClient();
  const release = slowNetwork(slow);
  const run = startSync(slow, USER);
  document.dispatchEvent(new Event('sawaalbox:signed-out'));
  release();
  await run;
  assert.equal(store.has(SYNC_MARKER_KEY) || store.has(LISTS_MARKER_KEY), false);
});

test('after the set was created and the bookmarks refused, the next run adds them without creating the set again', async () => {
  seed({ lists: { L1: list('New', ['n']) } });
  const client = fakeClient();
  client.failOn = 'upsert:bookmarks';
  await assert.rejects(syncLists(client, USER), { message: 'upsert refused' });
  assert.deepEqual(setNames(client), ['New'], 'the set was created before the refusal');
  assert.deepEqual(lists().L1, list('New', ['n']), 'locally nothing changed');

  client.failOn = null;
  await syncLists(client, USER);
  assert.equal(kinds(client, 'insert', 'bookmark_sets').length, 1, 'no second insert');
  assert.deepEqual(setNames(client), ['New']);
  assert.deepEqual(remoteKeys(client, 'S1'), ['n']);
  assert.deepEqual(lists().L1, list('New', ['n'], 'S1', ['n']));
});

test('after a refused delete the next run sends it, and what was added stays added', async () => {
  seed({ lists: { L1: list('Old', ['keep', 'fresh'], 'R1', ['keep', 'old']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Old', ['keep', 'old']);
  client.failOn = 'delete';
  await assert.rejects(syncLists(client, USER), { message: 'delete refused' });
  assert.deepEqual(remoteKeys(client, 'R1'), ['fresh', 'keep', 'old'], 'the add landed, the delete did not');
  assert.deepEqual(lists().L1, list('Old', ['keep', 'fresh'], 'R1', ['keep', 'old']), 'locally nothing changed');

  client.failOn = null;
  await syncLists(client, USER);
  assert.deepEqual(remoteKeys(client, 'R1'), ['fresh', 'keep']);
  assert.deepEqual(lists().L1, list('Old', ['keep', 'fresh'], 'R1', ['keep', 'fresh']));
});

test('progress failing does not hold the lists back, and lists failing does not undo progress', async () => {
  mark(A, 'done', OLD);
  seed({ ...loadState(), lists: { L1: list('Polity', ['x']) } });
  const client = fakeClient();
  client.failOn = 'select:question_progress';
  await startSync(client, USER);
  assert.equal(takeWarnings().length, 1);
  assert.deepEqual(remoteKeys(client, 'S1'), ['x']);
  assert.equal(lists().L1.remoteId, 'S1');

  client.failOn = 'select:bookmark_sets';
  tick('L1', 'y'); // a change the lists step has to send
  await idle();
  assert.equal(takeWarnings().length, 1);
  assert.deepEqual(statuses(client), { [A]: 'done' }, 'the progress step ran on its own');
});

// --- Lists: changes made while a run is in flight. ---

test('a key saved while a lists run awaits the network survives it and is sent by the next run', async () => {
  seed({ lists: { L1: list('Polity', ['a']) } });
  const client = fakeClient();
  const release = slowNetwork(client);
  const run = syncLists(client, USER);
  tick('L1', 'during'); // the person ticks another box while the account is being read
  release();
  await run;
  assert.deepEqual(remoteKeys(client, 'S1'), ['a'], 'the run sent only what it had seen');
  assert.deepEqual(lists().L1, list('Polity', ['a', 'during'], 'S1', ['a']), 'kept, and still unsynced');

  await syncLists(client, USER);
  assert.deepEqual(remoteKeys(client, 'S1'), ['a', 'during']);
  assert.deepEqual(lists().L1, list('Polity', ['a', 'during'], 'S1', ['a', 'during']));
});

test('a key unticked while a lists run is in flight stays unticked and is deleted by the next run', async () => {
  seed({ lists: { L1: list('Polity', ['a', 'b'], 'R1', ['a', 'b']) } });
  const client = fakeClient();
  remoteSet(client, 'R1', 'Polity', ['a', 'b']);
  const release = slowNetwork(client);
  const run = syncLists(client, USER);
  tick('L1', 'b');
  release();
  await run;
  assert.deepEqual(lists().L1, list('Polity', ['a'], 'R1', ['a', 'b']));
  await syncLists(client, USER);
  assert.deepEqual(remoteKeys(client, 'R1'), ['a']);
  assert.deepEqual(lists().L1, list('Polity', ['a'], 'R1', ['a']));
});

test('a list created while a lists run awaits the network is kept as made, and the next run creates it', async () => {
  const client = fakeClient();
  remoteSet(client, 'R1', 'Maps', ['q']);
  const release = slowNetwork(client);
  const run = syncLists(client, USER);
  seed({ ...loadState(), lists: { fresh: list('Fresh', ['f']) } });
  release();
  await run;
  assert.deepEqual(setNames(client), ['Maps'], 'the run had not seen it');
  assert.deepEqual(lists(), { fresh: list('Fresh', ['f']), R1: list('Maps', ['q'], 'R1', ['q']) });

  await syncLists(client, USER);
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
  const run = syncLists(client, USER);
  await idle(); // the reads are done and held
  remoteSet(client, 'R7', 'Polity', ['theirs']); // the other device, after our read
  release();
  await assert.rejects(run, { code: '23505' }); // unique(user_id, name)
  assert.deepEqual(lists().L1, list('Polity', ['mine']), 'untouched');

  await syncLists(client, USER); // the next run joins it by name
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
  await syncLists(client, USER);
  assert.deepEqual(remoteKeys(client, 'R1'), ['a']);

  store.delete(LISTS_MARKER_KEY); // device A has its own storage, and its own marker
  seed({ lists: { L1: list('Polity', ['a', 'b'], 'R1', ['a', 'b']) } }); // device A
  await syncLists(client, USER);
  assert.deepEqual(remoteKeys(client, 'R1'), ['a'], 'the account still lacks b');
  assert.deepEqual(lists().L1.keys, ['a'], 'and A dropped it');
});

// --- A shared browser: one account after another. ---

const USER_B = { id: 'user-2' };
const S = 'upsc-2018-1'; // a question both accounts have marked
const S2 = 'upsc-2018-2';
const S3 = 'upsc-2018-3';
const S4 = 'upsc-2018-4';
const Q = 'upsc-2016-1';
const W = 'upsc-2017-1'; // marked while nobody was signed in
const V = 'upsc-2017-2';
const signOutEvent = () => document.dispatchEvent(new Event('sawaalbox:signed-out'));
const rowsOf = (client) => Object.fromEntries([...client.table.values()].map((r) => [r.question_key, [r.status, r.updated_at]]));

test('the account that signs in claims this browser at its first run, even one that reaches nothing, and sign-out keeps the claim', async () => {
  const client = fakeClient();
  client.failOn = 'select';
  await startSync(client, USER);
  assert.equal(takeWarnings().length, 2, 'both steps failed');
  assert.equal(store.get(OWNER_KEY), USER.id, 'the device now holds only this account\'s data and work to join it');

  client.failOn = null;
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.equal(store.get(OWNER_KEY), USER.id);
  signOutEvent();
  assert.equal(store.get(OWNER_KEY), USER.id, 'kept after sign-out, to recognise the next account');
});

test('a successful step writes the owner again', async () => {
  const client = fakeClient();
  const release = slowNetwork(client);
  const run = startSync(client, USER);
  store.delete(OWNER_KEY); // lost while the run waits (cleared by hand, say)
  release();
  await run;
  assert.equal(store.get(OWNER_KEY), USER.id);
});

test("a shared browser: A, sign-out, B, sign-out, A. Neither account takes on the other's marks or lists, and signed-out work goes to whoever signs in next", async () => {
  // Both accounts hold S, S2, S3 and S4, at different times, so whichever
  // account's copy leaks into the other would win somewhere.
  const accountA = fakeClient([row(A, 'done', OLD), row(S, 'done', NEWER), row(S2, 'done', OLD), row(S3, 'done', OLD), row(S4, 'done', OLD)]);
  remoteSet(accountA, 'SA', 'Polity', [A]);
  const accountB = fakeClient(
    [
      row(B, 'review', OLD, USER_B),
      row(S, 'review', OLD, USER_B),
      row(S2, 'done', OLD, USER_B),
      row(S3, 'review', NEWER, USER_B),
      row(S4, 'review', OLD, USER_B),
    ],
    { user: USER_B }
  );
  remoteSet(accountB, 'SB', 'Polity', [B], USER_B);

  // A signs in. Then, offline, A clears S2, and signs out before that reaches A.
  await startSync(accountA, USER);
  assert.equal(store.get(OWNER_KEY), USER.id);
  accountA.failOn = 'select';
  click(S2, null, NEW);
  await idle();
  takeWarnings();
  signOutEvent();
  const aAfterSignOut = rowsOf(accountA);

  // Nobody is signed in; someone marks W.
  mark(W, 'done', NEW);

  // B signs in on the same browser.
  await startSync(accountB, USER_B);
  assert.deepEqual(rowsOf(accountB), {
    [B]: ['review', OLD],
    [S]: ['review', OLD], // A's newer copy of S was A's, not B's: not uploaded
    [S2]: ['done', OLD], // A's queued clear of S2 was A's: not sent to B
    [S3]: ['review', NEWER],
    [S4]: ['review', OLD],
    [W]: ['done', NEW], // signed-out work joins the account that signs in
  });
  assert.deepEqual(setNames(accountB), ['Polity']);
  assert.deepEqual(remoteKeys(accountB, 'SB'), [B], "A's list did not fold into B's");
  assert.deepEqual(Object.keys(loadState().entries).sort(), [B, S, S2, S3, S4, W].sort());
  assert.equal(loadState().entries[S].status, 'review', "this browser now shows B's marks");
  assert.deepEqual(Object.values(lists()).map((l) => [l.name, l.remoteId, l.keys]), [['Polity', 'SB', [B]]]);
  assert.equal(store.get(OWNER_KEY), USER_B.id);
  assert.deepEqual(rowsOf(accountA), aAfterSignOut, "and A's account was not touched");

  // Offline, B clears S4, and signs out before that reaches B.
  accountB.failOn = 'select';
  click(S4, null, NEWER);
  await idle();
  takeWarnings();
  signOutEvent();
  const bAfterSignOut = rowsOf(accountB);

  // V is marked signed out; A signs back in.
  mark(V, 'review', NEWER);
  accountA.failOn = null;
  await startSync(accountA, USER);
  assert.deepEqual(rowsOf(accountA), {
    [A]: ['done', OLD],
    [S]: ['done', NEWER],
    // A cleared S2 while offline and signed out before it was sent. That clear
    // went with A's synced copy when B signed in, so A's account keeps S2.
    [S2]: ['done', OLD],
    [S3]: ['done', OLD], // B's newer synced copy of S3 was B's: not uploaded to A
    [S4]: ['done', OLD], // B's queued clear of S4 was B's: not sent to A
    [V]: ['review', NEWER],
  });
  assert.deepEqual(setNames(accountA), ['Polity']);
  assert.deepEqual(remoteKeys(accountA, 'SA'), [A]);
  assert.deepEqual(rowsOf(accountB), bAfterSignOut, "and B's account was not touched");
  assert.deepEqual(Object.keys(loadState().entries).sort(), [A, S, S2, S3, S4, V].sort());
  assert.deepEqual(Object.values(lists()).map((l) => [l.name, l.remoteId, l.keys]), [['Polity', 'SA', [A]]]);
  assert.equal(store.get(OWNER_KEY), USER.id);
});

test('a different account always starts with a full pull, whatever the markers say', async () => {
  store.set(OWNER_KEY, 'someone-else');
  writeMarker(MIN);
  writeListsMarker(MIN);
  seed({ entries: { [X]: entry('done', OLD, true) } });
  const client = fakeClient([row(A, 'done', OLD)]);
  await startSync(client, USER);
  const [first] = kinds(client, 'select');
  assert.deepEqual(first.filters, [], 'every row, not just pending keys');
  assert.ok(kinds(client, 'select', 'bookmark_sets').length > 0, 'and the lists');
  assert.deepEqual(Object.keys(loadState().entries), [A]);
});

test('no owner stored (first sign-in here, or data from before owners were kept): everything merges, as on any first sign-in', async () => {
  seed({ entries: { [A]: entry('done', NEWER, true), [B]: entry('review', NEW, false) }, lists: { L1: list('Polity', ['k']) } });
  const client = fakeClient([row(A, 'review', OLD)]);
  await startSync(client, USER);
  assert.deepEqual(statuses(client), { [A]: 'done', [B]: 'review' });
  assert.deepEqual(setNames(client), ['Polity']);
  assert.equal(store.get(OWNER_KEY), USER.id);
});

test("when the device cannot be cleared of the previous account's copy, the run stops before merging it", async () => {
  store.set(OWNER_KEY, 'someone-else');
  seed({ entries: { [A]: entry('done', NEWER, true) } });
  const before = store.get(STORAGE_KEY);
  const client = fakeClient([row(A, 'review', OLD)]);
  failWrites = true;
  await startSync(client, USER);
  const [warning] = takeWarnings();
  assert.equal(warning[0], 'SawaalBox: will retry syncing');
  assert.deepEqual(client.calls, []);
  assert.deepEqual(statuses(client), { [A]: 'review' });
  assert.equal(store.get(STORAGE_KEY), before);
  assert.equal(store.get(OWNER_KEY), 'someone-else', 'the device still holds their copy, so it is still theirs');
});

// The reviewer's probes: an account whose first syncs fail must not be
// rebased again and again (losing its own queued changes), and must not
// leave its queued changes looking like the previous account's.

test("a new account whose first syncs fail keeps its own queued clear, and sends it when the network returns", async () => {
  const accountA = fakeClient([row(A, 'done', OLD)]);
  await startSync(accountA, USER);
  signOutEvent();

  const accountB = fakeClient([row(Q, 'review', OLD, USER_B)], { user: USER_B });
  accountB.failOn = 'select'; // B signs in on A's browser, offline
  await startSync(accountB, USER_B);
  assert.equal(takeWarnings().length, 2);
  assert.equal(store.get(OWNER_KEY), USER_B.id, 'claimed at once: the device now holds only B\'s work');
  click(Q, 'done', NEW);
  await idle();
  click(Q, null, NEWER); // later than B's account copy
  await idle();
  takeWarnings();
  assert.deepEqual(loadState().pending.map((op) => [op.type, op.key]), [['delete', Q]]);

  accountB.failOn = null;
  window.dispatchEvent(new Event('online'));
  await idle();
  assert.deepEqual(statuses(accountB), {}, 'Q is cleared in B\'s account');
  assert.deepEqual(statuses(accountA), { [A]: 'done' });
});

test("a new account whose request hangs and who signs out leaves nothing that A's next sign-in sends to A", async () => {
  const accountA = fakeClient([row(A, 'done', OLD), row(Q, 'done', OLD)]);
  await startSync(accountA, USER);
  signOutEvent();

  const accountB = fakeClient([], { user: USER_B });
  slowNetwork(accountB); // B's first request never answers
  startSync(accountB, USER_B);
  mark(Q, 'done', NEW);
  mark(Q, null, NEWER); // B clears Q, later than A's copy of it
  await finishSyncing(50); // sign-out gives up on the hung run
  signOutEvent();

  await startSync(accountA, USER);
  assert.deepEqual(statuses(accountA), { [A]: 'done', [Q]: 'done' }, "B's clear of Q did not delete A's row");
  assert.deepEqual(kinds(accountA, 'delete'), []);
  assert.equal(store.get(OWNER_KEY), USER.id);
});

// --- Sign-out: one last run first. ---

test('signing out first gives the sync one last run, so changes still queued reach the account they were made under', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  mark(A, 'done', NEW); // queued, no run yet (made offline, say)
  await finishSyncing();
  assert.deepEqual(statuses(client), { [A]: 'done' });
  assert.deepEqual(loadState().pending, []);
});

test('the last run joins a run in flight: one follow-up, which sends what was queued during it', async () => {
  const client = fakeClient();
  const release = slowNetwork(client);
  startSync(client, USER);
  mark(B, 'review', NEW);
  const done = finishSyncing();
  release();
  await done;
  assert.deepEqual(statuses(client), { [B]: 'review' });
});

test('sign-out waits for the last run at most its time limit', async () => {
  const client = fakeClient();
  await startSync(client, USER);
  mark(A, 'done', NEW);
  slowNetwork(client); // a request that never answers
  const started = Date.now();
  await finishSyncing(50);
  assert.ok(Date.now() - started < 1000, 'gave up on the hung request');
});

// --- /account: always the whole account. ---

test('a sync started with full: true pulls every row and every list, however recent the markers', async () => {
  writeMarker(MIN);
  writeListsMarker(MIN);
  seed({ entries: { [C]: entry('done', OLD, true) }, lists: { L1: list('Polity', ['a'], 'R1', ['a']) } });
  const client = fakeClient([row(C, 'done', OLD), row(X, 'review', NEW)]); // X: marked on another device
  remoteSet(client, 'R1', 'Polity', ['a', 'b']); // b: saved on another device
  await startSync(client, USER, { full: true });
  const [progress] = kinds(client, 'select');
  assert.deepEqual(progress.filters, []);
  assert.deepEqual(progress.range, [0, 999]);
  assert.deepEqual(loadState().entries, { [C]: entry('done', OLD, true), [X]: entry('review', NEW, true) });
  assert.deepEqual(lists().L1.keys, ['a', 'b']);
  const renewed = JSON.parse(store.get(SYNC_MARKER_KEY));
  assert.ok(Date.now() - Date.parse(renewed.at) < MIN / 2, 'and the markers are renewed');
});

test('only the run asked for is full: later runs on the page are targeted again', async () => {
  const client = fakeClient();
  await startSync(client, USER, { full: true });
  click(A, 'done', NEW);
  await idle();
  const last = kinds(client, 'select').at(-1);
  assert.deepEqual(last.filters, [['in', 'question_key', [A]]]);
});

test('a full pull asked for while a run is in flight is the follow-up run', async () => {
  writeMarker(MIN);
  writeListsMarker(MIN);
  mark(A, 'done', NEW);
  const client = fakeClient([row(X, 'done', OLD)]);
  const release = slowNetwork(client);
  const first = startSync(client, USER); // targeted: A is pending
  startSync(client, USER, { full: true });
  release();
  await first;
  const [targeted, ...rest] = kinds(client, 'select');
  assert.deepEqual(targeted.filters, [['in', 'question_key', [A]]], 'the run in flight was targeted');
  // X, and A, which the first run uploaded: one page, then the empty one.
  assert.deepEqual(rest.map((c) => [c.filters, c.range]), [[[], [0, 999]], [[], [2, 1001]]], 'the follow-up read every page');
  assert.ok(loadState().entries[X]);
  assert.ok(kinds(client, 'select', 'bookmark_sets').length > 0);
});

test('with no sync running, sign-out does not wait', async () => {
  const started = Date.now();
  await finishSyncing(5000);
  assert.ok(Date.now() - started < 1000);
  const client = fakeClient();
  await startSync(client, USER);
  signOutEvent();
  const again = Date.now();
  await finishSyncing(5000);
  assert.ok(Date.now() - again < 1000, 'a stopped sync asks for no last run');
});
