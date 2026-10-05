import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState } from '../src/lib/accounts/progress-store.js';
import {
  cleanName,
  createList,
  deleteList,
  findByName,
  isDirty,
  listsEqual,
  mergeLists,
  newListId,
  removeKey,
  renameList,
  sameName,
  settleLists,
  settleTombstones,
  toggleKey,
} from '../src/lib/accounts/lists.js';

// syncedName is the name the account had at the last sync: the list's own name
// once it has a set, null before.
const list = (name, keys = [], remoteId = null, syncedKeys = [], syncedName = remoteId ? name : null) => ({
  name,
  keys,
  remoteId,
  syncedKeys,
  syncedName,
});
const L = list;
const set = (id, name) => ({ id, name });
const bm = (set_id, question_key) => ({ set_id, question_key });
const sorted = (a) => [...a].sort();

// --- Creating and toggling. ---

test('create and toggle', () => {
  const s = createList(emptyState(), ' Polity ', 'L1');
  assert.deepEqual(s.lists.L1, { name: 'Polity', keys: [], remoteId: null, syncedKeys: [], syncedName: null });
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

// --- Removing. ---

test('removeKey takes the question out of that list only, and leaves the rest of it alone', () => {
  const s = {
    ...emptyState(),
    lists: { L1: list('Polity', ['a', 'b', 'c'], 'R1', ['a', 'b']), L2: list('Maps', ['b']) },
  };
  const next = removeKey(s, 'L1', 'b');
  assert.deepEqual(next.lists.L1, list('Polity', ['a', 'c'], 'R1', ['a', 'b']), 'name, remoteId and base are untouched');
  assert.equal(next.lists.L2, s.lists.L2, 'another list holding the same question keeps it');
  assert.deepEqual(s.lists.L1.keys, ['a', 'b', 'c'], 'the input is not mutated');
});

test('removeKey on a key that is already gone returns the very same state', () => {
  const s = { ...emptyState(), lists: { L1: list('Polity', ['a']) } };
  assert.equal(removeKey(s, 'L1', 'zzz'), s);
});

test('removeKey on a list that is already gone returns the very same state', () => {
  const s = { ...emptyState(), lists: { L1: list('Polity', ['a']) } };
  assert.equal(removeKey(s, 'nope', 'a'), s);
});

test('removing twice never puts the key back (a stale page cannot re-add it, as toggling would)', () => {
  const s = { ...emptyState(), lists: { L1: list('Polity', ['a', 'b']) } };
  const once = removeKey(s, 'L1', 'a');
  const twice = removeKey(once, 'L1', 'a');
  assert.equal(twice, once);
  assert.deepEqual(twice.lists.L1.keys, ['b']);
  assert.deepEqual(toggleKey(once, 'L1', 'a').state.lists.L1.keys, ['b', 'a'], 'which is what a toggle would have done');
});

test('removing the last question leaves the list, empty', () => {
  const s = { ...emptyState(), lists: { L1: list('Polity', ['a']) } };
  assert.deepEqual(removeKey(s, 'L1', 'a').lists.L1.keys, []);
  assert.ok('L1' in removeKey(s, 'L1', 'a').lists);
});

test('a removal is a change the sync sends: the list is dirty against its base', () => {
  const s = { ...emptyState(), lists: { L1: list('Polity', ['a', 'b'], 'R1', ['a', 'b']) } };
  assert.equal(isDirty(s.lists.L1), false);
  assert.equal(isDirty(removeKey(s, 'L1', 'b').lists.L1), true);
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
  assert.throws(() => createList(s, 'POLITY', 'L2'), { message: 'You already have a list called "Polity".' });
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

// --- Names, renaming and deleting. ---

test('names compare without case or surrounding space', () => {
  assert.equal(sameName(' Test ', 'test'), true);
  assert.equal(sameName('Polity', 'Polity 2'), false);
});

test('findByName finds a list whatever its capitals, can skip one list, and says null when there is none', () => {
  const lists = { L1: L('Polity'), L2: L('Maps') };
  assert.deepEqual(findByName(lists, ' polity '), { id: 'L1', list: lists.L1 });
  assert.equal(findByName(lists, 'polity', 'L1'), null, 'a list never collides with itself');
  assert.equal(findByName(lists, 'Ancient'), null);
  assert.equal(findByName({}, 'Polity'), null);
});

test('createList refuses a name that differs only in capitals, quoting the existing spelling', () => {
  const s = createList(emptyState(), 'Test', 'L1');
  assert.throws(() => createList(s, 'test', 'L2'), { message: 'You already have a list called "Test".' });
  assert.deepEqual(s.lists.L1, L('Test'));
});

test('renameList renames, refuses another list\'s name, and ignores no-ops', () => {
  let s = { ...emptyState(), lists: { L1: L('Polity', [], 'R1', [], 'Polity'), L2: L('Maps') } };
  s = renameList(s, 'L1', '  Indian Polity ');
  assert.equal(s.lists.L1.name, 'Indian Polity');
  assert.equal(s.lists.L1.syncedName, 'Polity'); // still the account's name until a sync
  assert.equal(isDirty(s.lists.L1), true);
  assert.throws(() => renameList(s, 'L1', 'maps'), { message: 'You already have a list called "Maps".' });
  assert.equal(renameList(s, 'L1', 'Indian Polity'), s);
  assert.equal(renameList(s, 'nope', 'X'), s);
  assert.equal(renameList(s, 'L2', 'MAPS').lists.L2.name, 'MAPS'); // own name in new capitals is fine
});

test('renameList validates the name like createList, and changes nothing else about the list or the state', () => {
  const s = { ...emptyState(), lists: { L1: L('Polity', ['a'], 'R1', ['a'], 'Polity') }, deletedLists: ['R9'] };
  assert.throws(() => renameList(s, 'L1', '   '), { message: 'Give the list a name.' });
  assert.throws(() => renameList(s, 'L1', 'x'.repeat(81)), /up to 80 characters/);
  const next = renameList(s, 'L1', 'Indian Polity');
  assert.deepEqual(next.lists.L1, L('Indian Polity', ['a'], 'R1', ['a'], 'Polity'));
  assert.deepEqual(next.deletedLists, ['R9']);
  assert.equal(s.lists.L1.name, 'Polity', 'the input is not mutated');
});

test('deleteList removes the list and keeps a tombstone only for synced lists', () => {
  const s = { ...emptyState(), lists: { L1: L('Polity', ['upsc-2019-7'], 'R1'), L2: L('Maps') } };
  const a = deleteList(s, 'L1');
  assert.equal('L1' in a.lists, false);
  assert.deepEqual(a.deletedLists, ['R1']);
  const b = deleteList(a, 'L2');
  assert.deepEqual(b.deletedLists, ['R1']);
  assert.equal(deleteList(b, 'gone'), b);
});

test('deleteList never records one set twice, and does not touch the other lists', () => {
  const s = { ...emptyState(), lists: { L1: L('Polity', [], 'R1'), L2: L('Maps', ['a']) }, deletedLists: ['R1'] };
  const next = deleteList(s, 'L1');
  assert.deepEqual(next.deletedLists, ['R1']);
  assert.equal(next.lists.L2, s.lists.L2);
  assert.deepEqual(Object.keys(s.lists), ['L1', 'L2'], 'the input is not mutated');
  assert.deepEqual(s.deletedLists, ['R1']);
});

test('isDirty: a rename here is something the account does not have yet', () => {
  assert.equal(isDirty(L('Polity', [], 'R1', [], 'Polity')), false);
  assert.equal(isDirty(L('Indian Polity', [], 'R1', [], 'Polity')), true);
  assert.equal(isDirty(L('POLITY', [], 'R1', [], 'Polity')), true, 'a change of capitals is a rename too');
  assert.equal(isDirty(L('Polity', [], null, [], null)), true, 'never uploaded');
});

test('listsEqual compares the name the account last had', () => {
  const a = { L1: L('A', ['a'], 'R', ['a'], 'A') };
  assert.equal(listsEqual(a, { L1: L('A', ['a'], 'R', ['a'], 'A') }), true);
  assert.equal(listsEqual(a, { L1: L('A', ['a'], 'R', ['a'], 'Old') }), false);
  assert.equal(listsEqual({ L1: L('A') }, { L1: L('A', [], null, [], 'A') }), false, 'null is not a name');
});

test('a tombstoned set is deleted, not adopted, and its local copy is dropped', () => {
  const r = mergeLists({ L9: L('Old', [], 'R1') }, [{ id: 'R1', name: 'Old' }, { id: 'R2', name: 'Kept' }], [], ['R1', 'R3']);
  assert.deepEqual(r.deleteSets, ['R1']); // R3 is already gone from the account
  assert.equal(Object.values(r.lists).some((l) => l.remoteId === 'R1'), false);
  assert.equal(r.lists.R2.name, 'Kept');
});

test('a tombstoned set is not merged into a new list of the same name, and its bookmarks are ignored', () => {
  // A list made after deleting "Polity" is a different list: it must not join the set about to be deleted.
  const r = mergeLists({ L2: L('Polity', ['a']) }, [{ id: 'R1', name: 'Polity' }], [{ set_id: 'R1', question_key: 'old' }], ['R1']);
  assert.deepEqual(r.deleteSets, ['R1']);
  assert.deepEqual(r.createSets, [{ listId: 'L2', name: 'Polity' }]);
  assert.deepEqual(r.lists.L2, L('Polity', ['a'], null, ['a'], 'Polity'));
  assert.deepEqual(r.addBookmarks, [{ listId: 'L2', key: 'a' }]);
});

test('with no tombstones, nothing is deleted and nothing is renamed', () => {
  const r = mergeLists({ L1: L('Polity', ['a'], 'R1', ['a']) }, [{ id: 'R1', name: 'Polity' }], [{ set_id: 'R1', question_key: 'a' }]);
  assert.deepEqual([r.deleteSets, r.renameSets], [[], []]);
});

test('a tombstone listed twice, or a set paged in twice, deletes once', () => {
  const r = mergeLists({}, [{ id: 'R1', name: 'A' }, { id: 'R1', name: 'A' }], [], ['R1', 'R1']);
  assert.deepEqual(r.deleteSets, ['R1']);
});

test('a rename here is pushed; a rename elsewhere is adopted', () => {
  const here = mergeLists({ L1: L('New', [], 'R1', [], 'Old') }, [{ id: 'R1', name: 'Old' }], []);
  assert.deepEqual(here.renameSets, [{ listId: 'L1', name: 'New' }]);
  assert.equal(here.lists.L1.syncedName, 'New');
  const there = mergeLists({ L1: L('Old', [], 'R1', [], 'Old') }, [{ id: 'R1', name: 'Theirs' }], []);
  assert.deepEqual(there.renameSets, []);
  assert.deepEqual([there.lists.L1.name, there.lists.L1.syncedName], ['Theirs', 'Theirs']);
});

test('a rename here wins over a different rename elsewhere, and a matching one needs no write', () => {
  const both = mergeLists({ L1: L('Mine', [], 'R1', [], 'Old') }, [{ id: 'R1', name: 'Theirs' }], []);
  assert.deepEqual(both.renameSets, [{ listId: 'L1', name: 'Mine' }]);
  assert.deepEqual([both.lists.L1.name, both.lists.L1.syncedName], ['Mine', 'Mine']);
  const same = mergeLists({ L1: L('Same', [], 'R1', [], 'Old') }, [{ id: 'R1', name: 'Same' }], []);
  assert.deepEqual(same.renameSets, []);
  assert.deepEqual([same.lists.L1.name, same.lists.L1.syncedName], ['Same', 'Same']);
  const caps = mergeLists({ L1: L('POLITY', [], 'R1', [], 'Polity') }, [{ id: 'R1', name: 'Polity' }], []);
  assert.deepEqual(caps.renameSets, [{ listId: 'L1', name: 'POLITY' }], 'a change of capitals is written');
});

test('a list that does not know what the account called it takes the account\'s name', () => {
  const r = mergeLists({ L1: L('Mine', [], 'R1', [], null) }, [{ id: 'R1', name: 'Theirs' }], []);
  assert.deepEqual(r.renameSets, []);
  assert.deepEqual([r.lists.L1.name, r.lists.L1.syncedName], ['Theirs', 'Theirs']);
});

test('a list made before signing in joins an account list whose name differs only in capitals', () => {
  const r = mergeLists({ L1: L('polity', ['upsc-2019-7']) }, [{ id: 'R1', name: 'Polity' }], []);
  assert.deepEqual(r.createSets, []);
  assert.equal(r.lists.L1.remoteId, 'R1');
  assert.equal(r.lists.L1.name, 'Polity');
  assert.equal(r.lists.L1.syncedName, 'Polity');
});

test('joining prefers the exact spelling, then the first account list in order', () => {
  const sets = [{ id: 'R1', name: 'polity' }, { id: 'R2', name: 'Polity' }, { id: 'R3', name: 'POLITY' }];
  assert.equal(mergeLists({ L1: L('Polity') }, sets, []).lists.L1.remoteId, 'R2', 'exact case beats an earlier set');
  assert.equal(mergeLists({ L1: L('polity') }, sets, []).lists.L1.remoteId, 'R1');
  const r = mergeLists({ L1: L('PoLiTy') }, sets, []);
  assert.equal(r.lists.L1.remoteId, 'R1', 'no exact match: the first in the account\'s order');
  assert.deepEqual(Object.keys(r.lists).sort(), ['L1', 'R2', 'R3'], 'the other sets are adopted as they are');
});

test('two lists that differ only in capitals fold into one set instead of asking for it twice', () => {
  const r = mergeLists({ L1: L('Polity', ['a']), L2: L('polity', ['b']) }, [], []);
  assert.deepEqual(r.createSets, [{ listId: 'L1', name: 'Polity' }]);
  assert.deepEqual(Object.keys(r.lists), ['L1']);
  assert.deepEqual(r.lists.L1.keys, ['a', 'b']);
  assert.equal(r.lists.L1.syncedName, 'Polity', 'a list whose set is being created');
});

test('a list without a remoteId folds into a synced list that differs only in capitals', () => {
  const r = mergeLists({ L1: L('Polity', ['a'], 'R1', ['a']), L2: L('POLITY', ['b']) }, [{ id: 'R1', name: 'Polity' }], [{ set_id: 'R1', question_key: 'a' }]);
  assert.deepEqual(Object.keys(r.lists), ['L1']);
  assert.deepEqual(r.lists.L1.keys, ['a', 'b']);
  assert.deepEqual(r.addBookmarks, [{ listId: 'L1', key: 'b' }]);
});

test('a new list called by the name a renamed list used to have is its own list, not folded into it', () => {
  // L1 was Polity and is now "Polity 2" here; the account still says Polity until this run writes the rename.
  const r = mergeLists(
    { L1: L('Polity 2', ['a'], 'R1', ['a'], 'Polity'), L2: L('Polity', ['b']) },
    [{ id: 'R1', name: 'Polity' }],
    [{ set_id: 'R1', question_key: 'a' }]
  );
  assert.deepEqual(r.renameSets, [{ listId: 'L1', name: 'Polity 2' }]);
  assert.deepEqual(r.createSets, [{ listId: 'L2', name: 'Polity' }]);
  assert.deepEqual(r.lists.L1.keys, ['a']);
  assert.deepEqual(r.lists.L2.keys, ['b']);
});

test('adopted sets, and lists that join a set, record the account\'s name as the base', () => {
  const r = mergeLists({ L1: L('maps', ['x']) }, [{ id: 'R1', name: 'Maps' }, { id: 'R2', name: 'Ancient' }], []);
  assert.equal(r.lists.L1.syncedName, 'Maps');
  assert.deepEqual(r.lists.R2, L('Ancient', [], 'R2', [], 'Ancient'));
});

test('a list saved before names were tracked (no syncedName) is merged without a rename', () => {
  const legacy = { name: 'Polity', keys: [], remoteId: 'R1', syncedKeys: [] };
  const r = mergeLists({ L1: legacy }, [{ id: 'R1', name: 'Polity' }], []);
  assert.deepEqual(r.renameSets, []);
  assert.equal(r.lists.L1.syncedName, 'Polity');
});

test('settle keeps a rename and a deletion made while the run was in flight', () => {
  const snapshot = { L1: L('A', [], 'R1'), L2: L('B', [], 'R2') };
  const current = { L1: L('A2', [], 'R1', [], 'A') }; // L1 renamed, L2 deleted mid-run
  const merged = { L1: L('A', [], 'R1'), L2: L('B', [], 'R2') };
  const out = settleLists(snapshot, current, merged);
  assert.equal(out.L1.name, 'A2');
  assert.equal(out.L1.syncedName, 'A');
  assert.equal('L2' in out, false);
});

test('settle: a rename made during the run is dirty for the next one, even after the run wrote an earlier rename', () => {
  const snapshot = { L1: L('B', [], 'R1', [], 'A') }; // renamed A -> B before the run
  const merged = { L1: L('B', [], 'R1', [], 'B') }; // the run wrote B
  const current = { L1: L('C', [], 'R1', [], 'A') }; // renamed again, to C, mid-run
  const out = settleLists(snapshot, current, merged);
  assert.deepEqual([out.L1.name, out.L1.syncedName], ['C', 'B']);
  assert.equal(isDirty(out.L1), true);
});

test('settle: a list nobody renamed takes the merged name, so a rename from another device arrives', () => {
  const snapshot = { L1: L('Old', [], 'R1') };
  const merged = { L1: L('Theirs', [], 'R1') };
  assert.equal(settleLists(snapshot, snapshot, merged).L1.name, 'Theirs');
});

test('settle: a list deleted during the run stays deleted, and an adopted set is not mistaken for it', () => {
  const snapshot = { L1: L('A', ['a'], 'R1', ['a']) };
  const merged = { L1: L('A', ['a'], 'R1', ['a']), R2: L('Adopted', [], 'R2') };
  const out = settleLists(snapshot, {}, merged);
  assert.deepEqual(Object.keys(out), ['R2']);
});

test('settle does not mutate its inputs when it renames and drops', () => {
  const snapshot = { L1: L('A'), L2: L('B') };
  const current = { L1: L('A2', [], null, [], null) };
  const merged = { L1: L('A'), L2: L('B') };
  settleLists(snapshot, current, merged);
  assert.equal(merged.L1.name, 'A');
  assert.deepEqual(Object.keys(merged), ['L1', 'L2']);
});

test('settleTombstones clears what the run handled and keeps tombstones added during it', () => {
  assert.deepEqual(settleTombstones(['R1'], ['R1', 'R2']), ['R2']);
});

test('settleTombstones leaves nothing when nothing was added, and everything when nothing was handled', () => {
  assert.deepEqual(settleTombstones(['R1', 'R2'], ['R1', 'R2']), []);
  assert.deepEqual(settleTombstones([], ['R1']), ['R1']);
  assert.deepEqual(settleTombstones(['R1'], []), []);
});

// --- A rename the account is already known to refuse. ---

test('a rename onto a name another account list already has is refused now, so the old name can be reused without a clash', () => {
  // Offline here: "Polity" (R1) renamed to "Polity 2", and a new "Polity" made. Meanwhile another device made
  // "Polity 2" (R2). The account would refuse the rename, and the create of "Polity" would then collide with R1
  // on every run. So the rename is dropped here and the new "Polity" folds into L1.
  const r = mergeLists(
    { L1: L('Polity 2', ['a'], 'R1', ['a'], 'Polity'), L3: L('Polity', ['b']) },
    [{ id: 'R1', name: 'Polity' }, { id: 'R2', name: 'Polity 2' }],
    [{ set_id: 'R1', question_key: 'a' }]
  );
  assert.deepEqual(r.renameSets, []);
  assert.deepEqual(r.createSets, []);
  assert.deepEqual([r.lists.L1.name, r.lists.L1.syncedName, r.lists.L1.remoteId], ['Polity', 'Polity', 'R1']);
  assert.deepEqual(r.lists.L1.keys, ['a', 'b']);
  assert.deepEqual(r.addBookmarks, [{ listId: 'L1', key: 'b' }]);
  assert.equal('L3' in r.lists, false);
  assert.deepEqual(r.lists.R2, L('Polity 2', [], 'R2'), 'the other device\'s list is adopted as it is');
});

test('a refused rename takes the account\'s name even when the account list that blocks it is already a local list', () => {
  const r = mergeLists(
    { L1: L('Maps', [], 'R1', [], 'Polity'), L2: L('Maps', [], 'R2', [], 'Maps') },
    [{ id: 'R1', name: 'Polity' }, { id: 'R2', name: 'Maps' }],
    []
  );
  assert.deepEqual(r.renameSets, []);
  assert.deepEqual([r.lists.L1.name, r.lists.L1.syncedName], ['Polity', 'Polity']);
  assert.deepEqual([r.lists.L2.name, r.lists.L2.syncedName], ['Maps', 'Maps']);
});

test('a rename onto the name of a set that is itself being renamed away is not refused', () => {
  const r = mergeLists(
    { L1: L('Polity 2', [], 'R1', [], 'Polity'), L2: L('Maps', [], 'R2', [], 'Polity 2') },
    [{ id: 'R1', name: 'Polity' }, { id: 'R2', name: 'Polity 2' }],
    []
  );
  assert.deepEqual(r.renameSets, [{ listId: 'L1', name: 'Polity 2' }, { listId: 'L2', name: 'Maps' }]);
  assert.deepEqual([r.lists.L1.name, r.lists.L2.name], ['Polity 2', 'Maps']);
});

test('refusing one rename can make the next one refused too', () => {
  // L2 -> "C" is refused (R3 is "C"), so R2 stays "B", which blocks L1 -> "B".
  const r = mergeLists(
    { L1: L('B', [], 'R1', [], 'A'), L2: L('C', [], 'R2', [], 'B') },
    [{ id: 'R1', name: 'A' }, { id: 'R2', name: 'B' }, { id: 'R3', name: 'C' }],
    []
  );
  assert.deepEqual(r.renameSets, []);
  assert.deepEqual([r.lists.L1.name, r.lists.L2.name], ['A', 'B']);
  assert.deepEqual([r.lists.L1.syncedName, r.lists.L2.syncedName], ['A', 'B']);
});

test('a rename onto the name of a set being deleted is not refused, and one differing in capitals is not either', () => {
  const freed = mergeLists({ L1: L('Maps', [], 'R1', [], 'Polity') }, [{ id: 'R1', name: 'Polity' }, { id: 'R2', name: 'Maps' }], [], ['R2']);
  assert.deepEqual(freed.renameSets, [{ listId: 'L1', name: 'Maps' }]);
  assert.deepEqual(freed.deleteSets, ['R2']);
  // The account compares names exactly, so only an identical name is refused.
  const caps = mergeLists({ L1: L('maps', [], 'R1', [], 'Polity') }, [{ id: 'R1', name: 'Polity' }, { id: 'R2', name: 'Maps' }], []);
  assert.deepEqual(caps.renameSets, [{ listId: 'L1', name: 'maps' }]);
});

// --- A key added to a list that was folded into another, during the run. ---

test('mergeLists says which lists it folded into which', () => {
  const none = mergeLists({ L1: L('Polity', [], 'R1', []) }, [{ id: 'R1', name: 'Polity' }], []);
  assert.deepEqual(none.foldedInto, {});
  const creating = mergeLists({ L1: L('Polity', ['a']), L2: L('polity', ['b']) }, [], []);
  assert.deepEqual(creating.foldedInto, { L2: 'L1' });
  const synced = mergeLists(
    { L1: L('Polity', [], 'R1', []), L2: L('POLITY'), L3: L('Maps'), L4: L('maps') },
    [{ id: 'R1', name: 'Polity' }],
    []
  );
  assert.deepEqual(synced.foldedInto, { L2: 'L1', L4: 'L3' });
});

test('settle: a key added during the run to a list that was folded into another lands on that list', () => {
  const snapshot = { L1: L('Polity', ['a'], 'R1', ['a']), L2: L('polity', ['b']) };
  const folded = mergeLists(snapshot, [{ id: 'R1', name: 'Polity' }], [{ set_id: 'R1', question_key: 'a' }]);
  assert.deepEqual(folded.foldedInto, { L2: 'L1' });
  const current = { L1: snapshot.L1, L2: L('polity', ['b', 'new']) }; // 'new' saved to L2 while the run was in flight
  const out = settleLists(snapshot, current, folded.lists, folded.foldedInto);
  assert.deepEqual(Object.keys(out), ['L1']);
  assert.deepEqual(out.L1.keys, ['a', 'b', 'new']);
  assert.deepEqual(out.L1.syncedKeys, ['a', 'b'], 'so the next run uploads it');
  assert.equal(isDirty(out.L1), true);
});

test('settle: a folded list\'s other mid-run changes are not carried, and a key the owner has is not doubled', () => {
  const snapshot = { L1: L('Polity', ['a', 'b'], 'R1', ['a', 'b']), L2: L('polity', ['b', 'c']) };
  const merged = { L1: L('Polity', ['a', 'b', 'c'], 'R1', ['a', 'b', 'c']) };
  const current = { L1: snapshot.L1, L2: L('POLITY!', ['c', 'a']) }; // 'b' removed, 'a' added, and renamed
  const out = settleLists(snapshot, current, merged, { L2: 'L1' });
  assert.deepEqual(out.L1.keys, ['a', 'b', 'c']);
  assert.equal(out.L1.name, 'Polity');
});

test('settle: nothing is added to an owner that is gone, and the folded argument is optional', () => {
  const snapshot = { L1: L('Polity', ['a'], 'R1', ['a']), L2: L('polity', ['b']) };
  const merged = { L1: L('Polity', ['a', 'b'], 'R1', ['a', 'b']) };
  const current = { L2: L('polity', ['b', 'new']) }; // L1 deleted during the run
  assert.deepEqual(settleLists(snapshot, current, merged, { L2: 'L1' }), {});
  assert.deepEqual(settleLists(snapshot, snapshot, merged), { L1: merged.L1 });
});

// --- Tombstones are for ids the account gave. ---

test('deleteList leaves no tombstone for a list whose remoteId is not a string', () => {
  const s = { ...emptyState(), lists: { L1: { name: 'Old shape', keys: [] }, L2: { name: 'Odd', keys: [], remoteId: 5 } } };
  assert.deepEqual(deleteList(s, 'L1').deletedLists, []);
  assert.deepEqual(deleteList(s, 'L2').deletedLists, []);
});
