import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeProgress } from '../src/lib/accounts/merge.js';

const OLD = '2026-10-01T10:00:00.000Z';
const NEW = '2026-10-02T10:00:00.000Z';
const row = (question_key, status, updated_at) => ({ question_key, status, updated_at });

test('the later edit wins, whichever side made it', () => {
  const local = { a: { status: 'done', updatedAt: NEW, synced: false }, b: { status: 'done', updatedAt: OLD, synced: true } };
  const remote = [row('a', 'review', OLD), row('b', 'review', NEW)];
  const { entries, toUpload } = mergeProgress(local, remote);
  assert.equal(entries.a.status, 'done');
  assert.equal(entries.b.status, 'review');
  assert.deepEqual(toUpload, [row('a', 'done', NEW)]);
});

test('an exact tie keeps the account copy and uploads nothing', () => {
  const { entries, toUpload } = mergeProgress({ a: { status: 'done', updatedAt: OLD, synced: false } }, [row('a', 'review', OLD)]);
  assert.equal(entries.a.status, 'review');
  assert.deepEqual(toUpload, []);
});

test('marks made before signing in are uploaded', () => {
  const { entries, toUpload } = mergeProgress({ a: { status: 'done', updatedAt: OLD, synced: false } }, []);
  assert.equal(entries.a.status, 'done');
  assert.deepEqual(toUpload, [row('a', 'done', OLD)]);
});

test('a synced mark missing from the account was cleared elsewhere, so it goes', () => {
  const { entries, toUpload } = mergeProgress({ a: { status: 'done', updatedAt: OLD, synced: true } }, []);
  assert.equal(entries.a, undefined);
  assert.deepEqual(toUpload, []);
});

test('account-only marks arrive on this device', () => {
  const { entries } = mergeProgress({}, [row('a', 'review', OLD)]);
  assert.deepEqual(entries.a, { status: 'review', updatedAt: OLD, synced: true });
});
