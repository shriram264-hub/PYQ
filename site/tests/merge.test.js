import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProgress } from '../src/lib/accounts/merge.js';

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
