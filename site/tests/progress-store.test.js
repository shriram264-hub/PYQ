import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, parseState, setMark, enqueue, dequeue, markAllSynced } from '../src/lib/accounts/progress-store.js';

const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-02T10:00:00.000Z';

test('setMark records an unsynced entry and an upsert op', () => {
  const { state, op } = setMark(emptyState(), 'upsc-2019-7', 'done', T1);
  assert.deepEqual(state.entries['upsc-2019-7'], { status: 'done', updatedAt: T1, synced: false });
  assert.deepEqual(op, { type: 'upsert', key: 'upsc-2019-7', status: 'done', at: T1 });
});

test('setMark with null clears the entry and emits a delete op', () => {
  const marked = setMark(emptyState(), 'upsc-2019-7', 'done', T1).state;
  const { state, op } = setMark(marked, 'upsc-2019-7', null, T2);
  assert.equal(state.entries['upsc-2019-7'], undefined);
  assert.deepEqual(op, { type: 'delete', key: 'upsc-2019-7', at: T2 });
});

test('enqueue keeps only the latest op per question', () => {
  let s = enqueue(emptyState(), { type: 'upsert', key: 'k', status: 'done', at: T1 });
  s = enqueue(s, { type: 'delete', key: 'k', at: T2 });
  assert.deepEqual(s.pending, [{ type: 'delete', key: 'k', at: T2 }]);
  assert.deepEqual(dequeue(s, s.pending[0]).pending, []);
});

test('parseState survives garbage and old shapes', () => {
  assert.deepEqual(parseState('not json'), emptyState());
  assert.deepEqual(parseState(null), emptyState());
  assert.deepEqual(parseState('{"entries":{},"pending":[]}').lists, {});
});

test('markAllSynced flags every entry', () => {
  const out = markAllSynced({ a: { status: 'done', updatedAt: T1, synced: false } });
  assert.equal(out.a.synced, true);
});

// Fix 1: localStorage access
import { loadState, saveState } from '../src/lib/accounts/progress-store.js';

test('saveState and loadState round-trip with a fake storage object', () => {
  const fakeStorage = {
    data: {},
    getItem(key) {
      return this.data[key] ?? null;
    },
    setItem(key, value) {
      this.data[key] = value;
    },
  };
  const state = { entries: { 'upsc-2019-7': { status: 'done', updatedAt: T1, synced: true } }, pending: [], lists: {} };
  assert.equal(saveState(state, fakeStorage), true);
  const loaded = loadState(fakeStorage);
  assert.deepEqual(loaded, state);
});

test('loadState returns emptyState when getItem throws', () => {
  const thrower = {};
  Object.defineProperty(thrower, 'getItem', {
    get() {
      throw new Error('blocked');
    },
    configurable: true,
  });
  try {
    const result = loadState(thrower);
    assert.deepEqual(result, emptyState());
  } finally {
    delete thrower.getItem;
  }
});

test('saveState does not throw, and returns false, when setItem throws', () => {
  const thrower = {};
  Object.defineProperty(thrower, 'setItem', {
    get() {
      throw new Error('blocked');
    },
    configurable: true,
  });
  try {
    let saved;
    assert.doesNotThrow(() => {
      saved = saveState(emptyState(), thrower);
    });
    assert.equal(saved, false);
  } finally {
    delete thrower.setItem;
  }
});

test('loadState and saveState handle blocked globalThis.localStorage', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  try {
    Object.defineProperty(globalThis, 'localStorage', {
      get() {
        throw new Error('SecurityError: localStorage access blocked');
      },
      configurable: true,
    });
    const result = loadState();
    assert.deepEqual(result, emptyState());
    let saved;
    assert.doesNotThrow(() => {
      saved = saveState(emptyState());
    });
    assert.equal(saved, false);
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'localStorage', originalDescriptor);
    } else {
      delete globalThis.localStorage;
    }
  }
});

// Fix 2: parseState validates all fields
test('parseState converts null entries/lists to {}', () => {
  const result = parseState('{"entries":null,"pending":[],"lists":null}');
  assert.deepEqual(result.entries, {});
  assert.deepEqual(result.lists, {});
  assert.deepEqual(result.pending, []);
});

test('parseState converts non-array pending to []', () => {
  const result = parseState('{"entries":{},"pending":{},"lists":{}}');
  assert.deepEqual(result.pending, []);
});

test('parseState converts array entries to {}', () => {
  const result = parseState('{"entries":[],"pending":[],"lists":{}}');
  assert.deepEqual(result.entries, {});
});

test('parseState drops invalid entries', () => {
  const input = {
    entries: {
      'upsc-2019-1': 'done',
      'upsc-2019-2': { status: 'done', updatedAt: T1, synced: true },
      'upsc-2019-3': { status: 'maybe', updatedAt: T1 },
      'upsc-2019-4': { status: 'done', updatedAt: 'invalid-date' },
      'upsc-2019-5': { status: 'review', updatedAt: T2, synced: false },
    },
    pending: [],
    lists: {},
  };
  const result = parseState(JSON.stringify(input));
  assert.deepEqual(Object.keys(result.entries).sort(), ['upsc-2019-2', 'upsc-2019-5']);
  assert.equal(result.entries['upsc-2019-2'].synced, true);
  assert.equal(result.entries['upsc-2019-5'].synced, false);
});

test('parseState coerces synced to boolean', () => {
  const input = { entries: { 'upsc-2019-1': { status: 'done', updatedAt: T1, synced: 1 } }, pending: [], lists: {} };
  const result = parseState(JSON.stringify(input));
  assert.equal(result.entries['upsc-2019-1'].synced, true);
});

test('parseState drops entries with missing updatedAt', () => {
  const input = {
    entries: { 'upsc-2019-1': { status: 'done' }, 'upsc-2019-2': { status: 'review', updatedAt: T1 } },
    pending: [],
    lists: {},
  };
  const result = parseState(JSON.stringify(input));
  assert.deepEqual(Object.keys(result.entries), ['upsc-2019-2']);
});

// The queue is the user's storage too. Anything in it that is not a well-formed
// change to a question the account would accept is dropped when it is read: a
// [null] used to break every Mark click (enqueue reads p.key), and a key the
// database refuses would fail every upload.
const parsePending = (pending) => parseState(JSON.stringify({ entries: {}, pending, lists: {} })).pending;

test('parseState keeps only well-formed queued changes', () => {
  const ok = [
    { type: 'upsert', key: 'upsc-2019-7', status: 'done', at: T1 },
    { type: 'delete', key: 'upsc-2019-8', at: T2 },
  ];
  const bad = [
    null,
    5,
    'upsc-2019-7',
    [],
    {},
    { type: 'upsert', key: 'upsc-2019-9' },
    { type: 'move', key: 'upsc-2019-9', at: T1 },
    { type: 'delete', key: 7, at: T1 },
    { type: 'delete', key: 'upsc-2019-9', at: 5 },
  ];
  assert.deepEqual(parsePending([bad[0], ok[0], ...bad.slice(1), ok[1]]), ok);
});

test('a stored [null] queue no longer breaks the next mark', () => {
  const state = parseState(JSON.stringify({ entries: {}, pending: [null], lists: {} }));
  const { state: marked, op } = setMark(state, 'upsc-2019-7', 'done', T1);
  assert.deepEqual(enqueue(marked, op).pending, [op]);
});

test('parseState drops marks and queued changes whose key the account would refuse', () => {
  const entry = { status: 'done', updatedAt: T1, synced: false };
  const keys = ['upsc-2019-7', 'upsc-2019-1000', 'UPSC-2019-7', 'upsc-19-7', 'a', 'upsc-2019-7 ', '__proto__'];
  const s = parseState(
    JSON.stringify({
      entries: Object.fromEntries(keys.map((k) => [k, entry])),
      pending: keys.map((key) => ({ type: 'upsert', key, status: 'done', at: T1 })),
      lists: {},
    })
  );
  assert.deepEqual(Object.keys(s.entries), ['upsc-2019-7']);
  assert.deepEqual(
    s.pending.map((op) => op.key),
    ['upsc-2019-7']
  );
});

// Lists: storage is the user's, so a malformed list is dropped, never trusted.
const parseLists = (lists) => parseState(JSON.stringify({ entries: {}, pending: [], lists })).lists;

test('parseState keeps a well-formed list, and gives an older one an empty base', () => {
  const lists = parseLists({
    a: { name: 'Polity', keys: ['k1', 'k2'], remoteId: 'R1', syncedKeys: ['k1'] },
    b: { name: 'Maps', keys: [], remoteId: null },
  });
  assert.deepEqual(lists, {
    a: { name: 'Polity', keys: ['k1', 'k2'], remoteId: 'R1', syncedKeys: ['k1'] },
    b: { name: 'Maps', keys: [], remoteId: null, syncedKeys: [] },
  });
});

test('parseState drops lists with a bad name, keys, remoteId or syncedKeys', () => {
  const lists = parseLists({
    ok: { name: 'Fine', keys: [], remoteId: null, syncedKeys: [] },
    noName: { keys: [], remoteId: null },
    emptyName: { name: '', keys: [], remoteId: null },
    longName: { name: 'x'.repeat(81), keys: [], remoteId: null },
    numName: { name: 7, keys: [], remoteId: null },
    noKeys: { name: 'A', remoteId: null },
    objKeys: { name: 'B', keys: {}, remoteId: null },
    mixedKeys: { name: 'C', keys: ['a', 1], remoteId: null },
    badRemote: { name: 'D', keys: [], remoteId: 5 },
    missingRemote: { name: 'E', keys: [] },
    badBase: { name: 'F', keys: [], remoteId: null, syncedKeys: 'a' },
    mixedBase: { name: 'G', keys: [], remoteId: null, syncedKeys: [null] },
    nullList: null,
    stringList: 'Polity',
    arrayList: [],
  });
  assert.deepEqual(Object.keys(lists), ['ok']);
  assert.equal(parseLists({ n: { name: 'x'.repeat(80), keys: [], remoteId: null } }).n.name.length, 80);
});

test('parseState removes duplicate keys and refuses a prototype-polluting id', () => {
  const lists = parseState(
    '{"entries":{},"pending":[],"lists":{"a":{"name":"A","keys":["k","k"],"remoteId":null,"syncedKeys":["s","s"]},"__proto__":{"name":"X","keys":[],"remoteId":null}}}'
  ).lists;
  assert.deepEqual(lists.a.keys, ['k']);
  assert.deepEqual(lists.a.syncedKeys, ['s']);
  assert.deepEqual(Object.keys(lists), ['a']);
  assert.equal(Object.getPrototypeOf(lists), Object.prototype);
});

test('parseState never throws on odd lists values', () => {
  for (const lists of [null, 5, 'x', [], true]) {
    assert.deepEqual(parseState(JSON.stringify({ entries: {}, pending: [], lists })).lists, {});
  }
});
