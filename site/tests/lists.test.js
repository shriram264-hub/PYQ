import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../src/lib/accounts/progress-store.js';
import {
  cleanName,
  createList,
  isDirty,
  listsEqual,
  mergeLists,
  newListId,
  settleLists,
  toggleKey,
} from '../src/lib/accounts/lists.js';

const list = (name, keys = [], remoteId = null, syncedKeys = []) => ({ name, keys, remoteId, syncedKeys });
const set = (id, name) => ({ id, name });
const bm = (set_id, question_key) => ({ set_id, question_key });
const sorted = (a) => [...a].sort();

// --- Creating and toggling. ---

test('create and toggle', () => {
  const s = createList(emptyState(), ' Polity ', 'L1');
  assert.deepEqual(s.lists.L1, { name: 'Polity', keys: [], remoteId: null, syncedKeys: [] });
  let r = toggleKey(s, 'L1', 'upsc-2019-7');
  assert.equal(r.added, true);
  assert.deepEqual(r.state.lists.L1.keys, ['upsc-2019-7']);
  r = toggleKey(r.state, 'L1', 'upsc-2019-7');
  assert.equal(r.added, false);
  assert.deepEqual(r.state.lists.L1.keys, []);
});

test('toggling does not touch the base the sync merges against', () => {
  const s = { ...emptyState(), lists: { L1: list('Polity', ['a'], 'R1', ['a']) } };
  const { state } = toggleKey(s, 'L1', 'b');
  assert.deepEqual(state.lists.L1, list('Polity', ['a', 'b'], 'R1', ['a']));
  assert.deepEqual(s.lists.L1.keys, ['a'], 'the input is not mutated');
});

test('toggling a list that is gone changes nothing', () => {
  const s = emptyState();
  const r = toggleKey(s, 'nope', 'a');
  assert.equal(r.state, s);
  assert.equal(r.added, false);
});

test('rejects empty and over-long names, in words a student can act on', () => {
  assert.throws(() => createList(emptyState(), '   ', 'L1'), { message: 'Give the list a name.' });
  assert.throws(() => createList(emptyState(), 'x'.repeat(81), 'L1'), /up to 80 characters/);
  assert.equal(cleanName('x'.repeat(80)).length, 80);
  assert.equal(cleanName('  Maps  '), 'Maps');
});

test('rejects a name another list already has, and says which', () => {
  const s = createList(emptyState(), 'Polity', 'L1');
  assert.throws(() => createList(s, ' Polity ', 'L2'), { message: 'You already have a list called "Polity".' });
  assert.equal(Object.keys(createList(s, 'polity', 'L2').lists).length, 2, 'the account compares names exactly');
});

test('a list id is unique and keeps the shape of a uuid even without randomUUID', () => {
  const ids = new Set(Array.from({ length: 50 }, newListId));
  assert.equal(ids.size, 50);
  const real = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const realCrypto = globalThis.crypto;
  const fake = { getRandomValues: (a) => realCrypto.getRandomValues(a) };
  Object.defineProperty(globalThis, 'crypto', { configurable: true, value: fake });
  try {
    assert.match(newListId(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  } finally {
    Object.defineProperty(globalThis, 'crypto', real);
  }
});

test('isDirty: never uploaded, or keys differ from the last sync (as a set)', () => {
  assert.equal(isDirty(list('A', [], null, [])), true);
  assert.equal(isDirty(list('A', ['a', 'b'], 'R', ['b', 'a'])), false);
  assert.equal(isDirty(list('A', ['a', 'b'], 'R', ['a'])), true);
  assert.equal(isDirty(list('A', ['a'], 'R', ['a', 'b'])), true);
});

test('listsEqual compares what a save would change', () => {
  const a = { L1: list('A', ['a', 'b'], 'R', ['a']) };
  assert.equal(listsEqual(a, { L1: list('A', ['a', 'b'], 'R', ['a']) }), true);
  assert.equal(listsEqual(a, { L1: list('A', ['b', 'a'], 'R', ['a']) }), false, 'key order is saved too');
  assert.equal(listsEqual(a, { L1: list('A', ['a', 'b'], null, ['a']) }), false);
  assert.equal(listsEqual(a, { L1: list('A', ['a', 'b'], 'R', []) }), false);
  assert.equal(listsEqual(a, { L2: list('A', ['a', 'b'], 'R', ['a']) }), false);
  assert.equal(listsEqual(a, {}), false);
  assert.equal(listsEqual({}, {}), true);
});

// --- The three-way merge of one list that exists on both sides. ---

const merge1 = (local, remoteKeys) =>
  mergeLists({ L1: local }, [set('R1', local.name)], remoteKeys.map((k) => bm('R1', k)));

test('in both: kept, nothing written', () => {
  const r = merge1(list('Polity', ['a'], 'R1', ['a']), ['a']);
  assert.deepEqual(r.lists.L1, list('Polity', ['a'], 'R1', ['a']));
  assert.deepEqual([r.createSets, r.addBookmarks, r.deleteBookmarks], [[], [], []]);
});

test('added here: kept and uploaded', () => {
  const r = merge1(list('Polity', ['a', 'b'], 'R1', ['a']), ['a']);
  assert.deepEqual(r.lists.L1.keys, ['a', 'b']);
  assert.deepEqual(r.addBookmarks, [{ listId: 'L1', key: 'b' }]);
  assert.deepEqual(r.deleteBookmarks, []);
  assert.deepEqual(r.lists.L1.syncedKeys, ['a', 'b'], 'the base is what the account holds once the write lands');
});

test('added on another device: kept, nothing uploaded', () => {
  const r = merge1(list('Polity', ['a'], 'R1', ['a']), ['a', 'c']);
  assert.deepEqual(r.lists.L1.keys, ['a', 'c']);
  assert.deepEqual(r.lists.L1.syncedKeys, ['a', 'c']);
  assert.deepEqual([r.addBookmarks, r.deleteBookmarks], [[], []]);
});

test('removed on another device: dropped here, and not sent back', () => {
  const r = merge1(list('Polity', ['a', 'b'], 'R1', ['a', 'b']), ['a']);
  assert.deepEqual(r.lists.L1.keys, ['a']);
  assert.deepEqual(r.lists.L1.syncedKeys, ['a']);
  assert.deepEqual([r.addBookmarks, r.deleteBookmarks], [[], []]);
});

test('removed here: deleted from the account, and not brought back', () => {
  const r = merge1(list('Polity', ['a'], 'R1', ['a', 'b']), ['a', 'b']);
  assert.deepEqual(r.lists.L1.keys, ['a']);
  assert.deepEqual(r.lists.L1.syncedKeys, ['a']);
  assert.deepEqual(r.deleteBookmarks, [{ listId: 'L1', key: 'b' }]);
  assert.deepEqual(r.addBookmarks, []);
});

test('every case at once, in one list', () => {
  const r = merge1(list('Polity', ['keep', 'mine', 'theirs-gone'], 'R1', ['keep', 'theirs-gone', 'mine-gone']), [
    'keep',
    'theirs-new',
    'mine-gone',
  ]);
  assert.deepEqual(sorted(r.lists.L1.keys), ['keep', 'mine', 'theirs-new']);
  assert.deepEqual(r.addBookmarks, [{ listId: 'L1', key: 'mine' }]);
  assert.deepEqual(r.deleteBookmarks, [{ listId: 'L1', key: 'mine-gone' }]);
  assert.deepEqual(sorted(r.lists.L1.syncedKeys), ['keep', 'mine', 'theirs-new']);
});

test('a union by name would resurrect removals; the base is what stops it', () => {
  // Device B removed 'b' and synced; device A still lists it, with the old base.
  const stale = merge1(list('Polity', ['a', 'b'], 'R1', ['a', 'b']), ['a']);
  assert.deepEqual(stale.lists.L1.keys, ['a']);
  assert.deepEqual(stale.addBookmarks, []);
});

// --- Lists and sets that exist on one side only. ---

test('first sign-in: a list with no remoteId joins the account list of the same name (a union)', () => {
  const r = mergeLists(
    { L1: list('Polity', ['mine', 'both']) },
    [set('R1', 'Polity')],
    [bm('R1', 'both'), bm('R1', 'theirs')]
  );
  assert.deepEqual(sorted(r.lists.L1.keys), ['both', 'mine', 'theirs']);
  assert.equal(r.lists.L1.remoteId, 'R1');
  assert.deepEqual(sorted(r.lists.L1.syncedKeys), ['both', 'mine', 'theirs']);
  assert.deepEqual(r.addBookmarks, [{ listId: 'L1', key: 'mine' }]);
  assert.deepEqual([r.createSets, r.deleteBookmarks], [[], []]);
  assert.deepEqual(Object.keys(r.lists), ['L1'], 'the local id stays; the set is not adopted a second time');
});

test('first sign-in: a list the account lacks is created, with all its keys uploaded', () => {
  const r = mergeLists({ L1: list('Maps', ['x', 'y']) }, [], []);
  assert.deepEqual(r.createSets, [{ listId: 'L1', name: 'Maps' }]);
  assert.deepEqual(r.addBookmarks, [
    { listId: 'L1', key: 'x' },
    { listId: 'L1', key: 'y' },
  ]);
  assert.equal(r.lists.L1.remoteId, null, 'filled in by the caller once the set exists');
  assert.deepEqual(r.lists.L1.keys, ['x', 'y']);
  assert.deepEqual(r.lists.L1.syncedKeys, ['x', 'y']);
});

test('an empty new list is still created', () => {
  const r = mergeLists({ L1: list('Empty') }, [], []);
  assert.deepEqual(r.createSets, [{ listId: 'L1', name: 'Empty' }]);
  assert.deepEqual(r.addBookmarks, []);
});

test('a list deleted on another device is dropped, even with unsent additions', () => {
  const r = mergeLists({ L1: list('Gone', ['a', 'new'], 'R9', ['a']), L2: list('Kept', ['k'], 'R2', ['k']) }, [set('R2', 'Kept')], [bm('R2', 'k')]);
  assert.deepEqual(Object.keys(r.lists), ['L2']);
  assert.deepEqual([r.createSets, r.addBookmarks, r.deleteBookmarks], [[], [], []]);
});

test("another account's lists are dropped, and this account's sets are adopted", () => {
  const r = mergeLists(
    { L1: list('Theirs', ['a'], 'OTHER-1', ['a']), L2: list('Theirs too', [], 'OTHER-2', []) },
    [set('R1', 'Mine')],
    [bm('R1', 'z')]
  );
  assert.deepEqual(Object.keys(r.lists), ['R1']);
  assert.deepEqual(r.lists.R1, list('Mine', ['z'], 'R1', ['z']));
});

test('a set no local list maps to is adopted under its own id', () => {
  const r = mergeLists({ L1: list('Polity', ['a'], 'R1', ['a']) }, [set('R1', 'Polity'), set('R2', 'Maps')], [bm('R1', 'a'), bm('R2', 'q')]);
  assert.deepEqual(Object.keys(r.lists), ['L1', 'R2'], 'local lists first, in their order, then adopted ones');
  assert.deepEqual(r.lists.R2, list('Maps', ['q'], 'R2', ['q']));
  assert.deepEqual([r.createSets, r.addBookmarks, r.deleteBookmarks], [[], [], []]);
});

test('local ids are never re-keyed: a joined list keeps its own id', () => {
  const r = mergeLists({ 'local-abc': list('Polity', ['a']) }, [set('R1', 'Polity')], []);
  assert.deepEqual(Object.keys(r.lists), ['local-abc']);
  assert.equal(r.lists['local-abc'].remoteId, 'R1');
});

test('bookmarks for a set the pull did not list are ignored', () => {
  const r = mergeLists({}, [set('R1', 'A')], [bm('R1', 'a'), bm('RX', 'stray')]);
  assert.deepEqual(r.lists.R1.keys, ['a']);
  assert.deepEqual(Object.keys(r.lists), ['R1']);
});

test('two local lists with one name fold into one set instead of asking for it twice', () => {
  const r = mergeLists({ L1: list('Polity', ['a']), L2: list('Polity', ['a', 'b']) }, [], []);
  assert.deepEqual(r.createSets, [{ listId: 'L1', name: 'Polity' }]);
  assert.deepEqual(Object.keys(r.lists), ['L1']);
  assert.deepEqual(r.lists.L1.keys, ['a', 'b']);
  assert.deepEqual(r.addBookmarks, [
    { listId: 'L1', key: 'a' },
    { listId: 'L1', key: 'b' },
  ]);
});

test('a list without a remoteId whose name an already-synced list holds folds into it', () => {
  const r = mergeLists({ L1: list('Polity', ['a'], 'R1', ['a']), L2: list('Polity', ['b']) }, [set('R1', 'Polity')], [bm('R1', 'a')]);
  assert.deepEqual(Object.keys(r.lists), ['L1']);
  assert.deepEqual(r.lists.L1.keys, ['a', 'b']);
  assert.deepEqual(r.addBookmarks, [{ listId: 'L1', key: 'b' }]);
});

test('folding a same-named list into one that is deleting that key cancels the delete instead of adding it', () => {
  // L1 removed b here (b is in its base and on the account); L2, a second copy of the name, still has b.
  const r = mergeLists(
    { L1: list('Polity', ['a'], 'R1', ['a', 'b']), L2: list('Polity', ['b']) },
    [set('R1', 'Polity')],
    [bm('R1', 'a'), bm('R1', 'b')]
  );
  assert.deepEqual(Object.keys(r.lists), ['L1']);
  assert.deepEqual(r.lists.L1.keys, ['a', 'b']);
  assert.deepEqual(sorted(r.lists.L1.syncedKeys), ['a', 'b']);
  assert.deepEqual(r.deleteBookmarks, [], 'b is not deleted...');
  assert.deepEqual(r.addBookmarks, [], '...and not uploaded either: it is already there');
});

test('folding still adds a key the owner is not deleting, and leaves its other deletes alone', () => {
  const r = mergeLists(
    { L1: list('Polity', ['a'], 'R1', ['a', 'b', 'c']), L2: list('Polity', ['b', 'new']) },
    [set('R1', 'Polity')],
    [bm('R1', 'a'), bm('R1', 'b'), bm('R1', 'c')]
  );
  assert.deepEqual(r.lists.L1.keys, ['a', 'b', 'new']);
  assert.deepEqual(r.deleteBookmarks, [{ listId: 'L1', key: 'c' }]);
  assert.deepEqual(r.addBookmarks, [{ listId: 'L1', key: 'new' }]);
});

test('a bookmark row paged in twice does not put a key in a list twice', () => {
  const r = mergeLists(
    { L1: list('Polity', ['a'], 'R1', ['a']) },
    [set('R1', 'Polity'), set('R1', 'Polity')],
    [bm('R1', 'a'), bm('R1', 'c'), bm('R1', 'c'), bm('R1', 'a')]
  );
  assert.deepEqual(r.lists.L1.keys, ['a', 'c']);
  assert.deepEqual(r.lists.L1.syncedKeys, ['a', 'c']);
  const adopted = mergeLists({}, [set('R2', 'Maps')], [bm('R2', 'q'), bm('R2', 'q')]);
  assert.deepEqual(adopted.lists.R2.keys, ['q']);
  const joined = mergeLists({ L1: list('Maps', ['x']) }, [set('R2', 'Maps')], [bm('R2', 'q'), bm('R2', 'q')]);
  assert.deepEqual(joined.lists.L1.keys, ['x', 'q']);
});

test('mergeLists does not mutate what it was given', () => {
  const local = { L1: list('Polity', ['a', 'b'], 'R1', ['a']) };
  const copy = JSON.parse(JSON.stringify(local));
  mergeLists(local, [set('R1', 'Polity')], [bm('R1', 'a'), bm('R1', 'c')]);
  assert.deepEqual(local, copy);
});

// --- Changes made while a sync was running. ---

test('settle: a key added during the run is kept and stays unsynced', () => {
  const snapshot = { L1: list('P', ['a'], 'R1', ['a']) };
  const merged = { L1: list('P', ['a'], 'R1', ['a']) };
  const current = { L1: list('P', ['a', 'new'], 'R1', ['a']) };
  const out = settleLists(snapshot, current, merged);
  assert.deepEqual(out.L1, list('P', ['a', 'new'], 'R1', ['a']));
  assert.equal(isDirty(out.L1), true, 'the next run sends it');
});

test('settle: a key removed during the run stays removed, while the base still has it', () => {
  const snapshot = { L1: list('P', ['a', 'b'], 'R1', ['a', 'b']) };
  const merged = { L1: list('P', ['a', 'b'], 'R1', ['a', 'b']) };
  const current = { L1: list('P', ['a'], 'R1', ['a', 'b']) };
  const out = settleLists(snapshot, current, merged);
  assert.deepEqual(out.L1.keys, ['a']);
  assert.deepEqual(out.L1.syncedKeys, ['a', 'b'], 'so the next run sees "removed here" and deletes it remotely');
});

test('settle: a list created during the run is kept exactly as it was made', () => {
  const snapshot = {};
  const merged = { R1: list('Theirs', ['x'], 'R1', ['x']) };
  const created = list('Fresh', ['q'], null, []);
  const out = settleLists(snapshot, { NEW: created }, merged);
  assert.deepEqual(Object.keys(out).sort(), ['NEW', 'R1']);
  assert.deepEqual(out.NEW, created);
});

test('settle: the merged result wins everywhere nothing changed during the run', () => {
  const snapshot = { L1: list('P', ['a', 'gone'], 'R1', ['a', 'gone']) };
  const merged = { L1: list('P', ['a', 'theirs'], 'R1', ['a', 'theirs']) };
  const out = settleLists(snapshot, snapshot, merged);
  assert.deepEqual(out.L1, merged.L1);
});

test('settle: changes made during the run to a list the merge dropped are not resurrected', () => {
  const snapshot = { L1: list('P', ['a'], 'R9', ['a']) };
  const current = { L1: list('P', ['a', 'b'], 'R9', ['a']) };
  assert.deepEqual(settleLists(snapshot, current, {}), {});
});

test('settle: a key added in the run and also on the account is not doubled', () => {
  const snapshot = { L1: list('P', [], 'R1', []) };
  const merged = { L1: list('P', ['k'], 'R1', ['k']) };
  const current = { L1: list('P', ['k'], 'R1', []) };
  assert.deepEqual(settleLists(snapshot, current, merged).L1.keys, ['k']);
});

test('settle does not mutate its inputs', () => {
  const snapshot = { L1: list('P', ['a'], 'R1', ['a']) };
  const merged = { L1: list('P', ['a'], 'R1', ['a']) };
  const current = { L1: list('P', ['a', 'n'], 'R1', ['a']) };
  settleLists(snapshot, current, merged);
  assert.deepEqual(merged.L1.keys, ['a']);
  assert.deepEqual(current.L1.keys, ['a', 'n']);
});
