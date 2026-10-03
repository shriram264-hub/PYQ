import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProgress, rebaseForNewAccount, settleSync } from '../src/lib/accounts/merge.js';

const OLD = '2026-10-01T10:00:00.000Z';
const NEW = '2026-10-02T10:00:00.000Z';
const row = (question_key, status, updated_at) => ({ question_key, status, updated_at });

test('the later edit wins, whichever side made it', () => {
  const local = { a: { status: 'done', updatedAt: NEW, synced: false }, b: { status: 'done', updatedAt: OLD, synced: true } };
  const remote = [row('a', 'review', OLD), row('b', 'review', NEW)];
  const { entries, toUpload, toDelete } = mergeProgress(local, remote);
  assert.equal(entries.a.status, 'done');
  assert.equal(entries.b.status, 'review');
  assert.deepEqual(toUpload, [row('a', 'done', NEW)]);
  assert.deepEqual(toDelete, []);
});

test('an exact tie keeps the account copy and uploads nothing', () => {
  const { entries, toUpload, toDelete } = mergeProgress({ a: { status: 'done', updatedAt: OLD, synced: false } }, [row('a', 'review', OLD)]);
  assert.equal(entries.a.status, 'review');
  assert.deepEqual(toUpload, []);
  assert.deepEqual(toDelete, []);
});

test('marks made before signing in are uploaded', () => {
  const { entries, toUpload, toDelete } = mergeProgress({ a: { status: 'done', updatedAt: OLD, synced: false } }, []);
  assert.equal(entries.a.status, 'done');
  assert.deepEqual(toUpload, [row('a', 'done', OLD)]);
  assert.deepEqual(toDelete, []);
});

test('a synced mark missing from the account was cleared elsewhere, so it goes', () => {
  const { entries, toUpload, toDelete } = mergeProgress({ a: { status: 'done', updatedAt: OLD, synced: true } }, []);
  assert.equal(entries.a, undefined);
  assert.deepEqual(toUpload, []);
  assert.deepEqual(toDelete, []);
});

test('account-only marks arrive on this device', () => {
  const { entries, toDelete } = mergeProgress({}, [row('a', 'review', OLD)]);
  assert.deepEqual(entries.a, { status: 'review', updatedAt: OLD, synced: true });
  assert.deepEqual(toDelete, []);
});

// Fix 3: mergeProgress honours pending deletes
test('an offline clear newer than the account row is not re-imported', () => {
  const local = {};
  const remote = [row('a', 'review', OLD)];
  const pending = [{ type: 'delete', key: 'a', at: NEW }];
  const { entries, toUpload, toDelete } = mergeProgress(local, remote, pending);
  assert.equal(entries.a, undefined);
  assert.deepEqual(toDelete, [{ question_key: 'a', cleared_at: NEW }]);
  assert.deepEqual(toUpload, []);
});

test('an account row newer than the offline clear is kept', () => {
  const local = {};
  const remote = [row('a', 'review', NEW)];
  const pending = [{ type: 'delete', key: 'a', at: OLD }];
  const { entries, toUpload, toDelete } = mergeProgress(local, remote, pending);
  assert.equal(entries.a.status, 'review');
  assert.deepEqual(toDelete, []);
  assert.deepEqual(toUpload, []);
});

test('an exact tie between clear and account row keeps the account', () => {
  const local = {};
  const remote = [row('a', 'review', OLD)];
  const pending = [{ type: 'delete', key: 'a', at: OLD }];
  const { entries, toDelete } = mergeProgress(local, remote, pending);
  assert.equal(entries.a.status, 'review');
  assert.deepEqual(toDelete, []);
});

test('a pending delete for a key the account does not have stays absent', () => {
  const local = {};
  const remote = [];
  const pending = [{ type: 'delete', key: 'a', at: NEW }];
  const { entries, toDelete } = mergeProgress(local, remote, pending);
  assert.equal(entries.a, undefined);
  assert.deepEqual(toDelete, []);
});

// settleSync: what a finished sync saves, given what happened while it ran.
const NEWER = '2026-10-03T10:00:00.000Z';
const entry = (status, updatedAt, synced) => ({ status, updatedAt, synced });
const upsert = (key, status, at) => ({ type: 'upsert', key, status, at });
const del = (key, at) => ({ type: 'delete', key, at });
const state = (entries, pending, lists = {}) => ({ entries, pending, lists });

test('a full settle takes the merged result, marks it synced and clears the snapshot ops', () => {
  const op = upsert('a', 'done', NEW);
  const snapshot = state({ a: entry('done', NEW, false) }, [op]);
  const merged = { a: entry('done', NEW, false), b: entry('review', OLD, true) };
  const out = settleSync(snapshot, snapshot, merged);
  assert.deepEqual(out.entries, { a: entry('done', NEW, true), b: entry('review', OLD, true) });
  assert.deepEqual(out.pending, []);
});

test('a mark made during the run keeps its entry unsynced and stays pending', () => {
  const sent = upsert('a', 'done', OLD);
  const snapshot = state({ a: entry('done', OLD, false) }, [sent]);
  const during = upsert('b', 'review', NEW);
  const current = state({ a: entry('done', OLD, false), b: entry('review', NEW, false) }, [sent, during]);
  const out = settleSync(snapshot, current, { a: entry('done', OLD, false) });
  assert.deepEqual(out.entries, { a: entry('done', OLD, true), b: entry('review', NEW, false) });
  assert.deepEqual(out.pending, [during]);
});

test('re-marking the same question during the run replaces the op the run sent', () => {
  const sent = upsert('a', 'done', OLD);
  const snapshot = state({ a: entry('done', OLD, false) }, [sent]);
  const during = upsert('a', 'review', NEW);
  const current = state({ a: entry('review', NEW, false) }, [during]);
  const out = settleSync(snapshot, current, { a: entry('done', OLD, false) });
  assert.deepEqual(out.entries, { a: entry('review', NEW, false) });
  assert.deepEqual(out.pending, [during]);
});

test('a clear made during the run removes the entry the merge brought back', () => {
  const snapshot = state({}, []);
  const during = del('a', NEW);
  const out = settleSync(snapshot, state({}, [during]), { a: entry('done', OLD, true) });
  assert.equal(out.entries.a, undefined);
  assert.deepEqual(out.pending, [during]);
});

test('an op that lost to a newer account row is cleared, not re-sent', () => {
  const lost = del('a', OLD);
  const snapshot = state({}, [lost]);
  const out = settleSync(snapshot, snapshot, { a: entry('review', NEW, false) });
  assert.deepEqual(out.entries, { a: entry('review', NEW, true) });
  assert.deepEqual(out.pending, []);
});

test('a targeted settle replaces only the asked-about entries', () => {
  const sent = upsert('a', 'done', NEW);
  const snapshot = state({ a: entry('done', NEW, false) }, [sent]);
  const current = state(
    { a: entry('done', NEW, false), c: entry('done', OLD, false), d: entry('review', OLD, true) },
    [sent]
  );
  const out = settleSync(snapshot, current, { a: entry('done', NEW, false) }, ['a']);
  assert.deepEqual(out.entries, {
    a: entry('done', NEW, true),
    c: entry('done', OLD, false),
    d: entry('review', OLD, true),
  });
  assert.deepEqual(out.pending, []);
});

test('a targeted settle drops an asked-about entry the merge removed', () => {
  const sent = del('a', NEW);
  const snapshot = state({}, [sent]);
  const current = state({ a: entry('done', OLD, true) }, [sent]);
  const out = settleSync(snapshot, current, {}, ['a']);
  assert.deepEqual(out.entries, {});
});

test('a targeted settle also keeps marks made during the run', () => {
  const sent = upsert('a', 'done', OLD);
  const snapshot = state({ a: entry('done', OLD, false) }, [sent]);
  const during = upsert('a', 'review', NEWER);
  const current = state({ a: entry('review', NEWER, false) }, [during]);
  const out = settleSync(snapshot, current, { a: entry('done', OLD, false) }, ['a']);
  assert.deepEqual(out.entries, { a: entry('review', NEWER, false) });
  assert.deepEqual(out.pending, [during]);
});

test('settle keeps the lists and drops malformed queued ops', () => {
  const snapshot = state({}, []);
  const current = state({}, [null, { type: 'upsert' }, upsert('a', 'done', NEW)], { x: 1 });
  current.entries.a = entry('done', NEW, false);
  const out = settleSync(snapshot, current, {});
  assert.deepEqual(out.lists, { x: 1 });
  assert.deepEqual(out.pending, [upsert('a', 'done', NEW)]);
});

// rebaseForNewAccount: a shared browser, where the account signing in is not
// the one this device last synced with.
const list = (name, keys, remoteId = null, syncedKeys = []) => ({ name, keys, remoteId, syncedKeys });

test('a new account drops the previous account\'s synced marks and keeps the work never synced', () => {
  const before = state(
    { a: entry('done', OLD, true), b: entry('review', NEW, false), c: entry('done', NEWER, true) },
    [upsert('b', 'review', NEW)]
  );
  const out = rebaseForNewAccount(before);
  assert.deepEqual(out.entries, { b: entry('review', NEW, false) });
  assert.deepEqual(out.pending, [upsert('b', 'review', NEW)]);
});

test('a new account drops the clears queued for the previous account', () => {
  const out = rebaseForNewAccount(state({ b: entry('done', NEW, false) }, [del('a', NEW), upsert('b', 'done', NEW), del('c', OLD)]));
  assert.deepEqual(out.pending, [upsert('b', 'done', NEW)]);
});

test('a new account drops the lists tied to the previous account\'s sets, and keeps lists never uploaded', () => {
  const lists = {
    L1: list('Polity', ['a', 'b'], 'SET-A', ['a']),
    L2: list('Made here', ['c']),
    L3: list('Empty', [], 'SET-A2', []),
  };
  const out = rebaseForNewAccount(state({}, [], lists));
  assert.deepEqual(out.lists, { L2: list('Made here', ['c']) });
});

test('rebasing changes nothing it was given, and leaves a device with nothing synced as it was', () => {
  const before = state({ a: entry('done', OLD, true) }, [del('a', NEW)], { L1: list('P', ['a'], 'S') });
  const copy = structuredClone(before);
  rebaseForNewAccount(before);
  assert.deepEqual(before, copy);
  const fresh = state({ b: entry('review', NEW, false) }, [upsert('b', 'review', NEW)], { L2: list('Q', ['b']) });
  assert.deepEqual(rebaseForNewAccount(fresh), fresh);
});
