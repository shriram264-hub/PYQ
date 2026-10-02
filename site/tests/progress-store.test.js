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
