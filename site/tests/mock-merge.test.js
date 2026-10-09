import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, chooseAnswer, newAttempt, submitAttempt } from '../src/lib/tests/attempt.js';
import { attemptsEqual, fromRow, isDirty, mergeAttempts, pickAttempt, rebaseTests, settleAttempts, toRow } from '../src/lib/tests/merge.js';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const ID3 = '00000000-0000-4000-8000-000000000003';
const KEYS = ['upsc-2019-1', 'upsc-2019-2'];
const T = (m) => new Date(Date.UTC(2026, 9, 9, 10, m)).toISOString();
const RESULT = { scored: 2, right: 1, wrong: 0, blank: 1, score: 2, max: 4 };
const make = (id = ID1, minute = 0) =>
  newAttempt({ id, kind: 'paper', spec: { year: 2019 }, keys: KEYS, limitMs: 120 * MINUTE, now: T(minute) });
const synced = (a) => ({ ...a, syncedAt: a.updatedAt });
// The database's own way of writing a time: microseconds, +00:00.
const pgTime = (iso) => iso.replace('Z', '+00:00').replace(/\.(\d{3})/, '.$1000');
const row = (a, userId = 'user-1') => {
  const r = toRow(a, userId);
  return { ...r, started_at: pgTime(r.started_at), updated_at: pgTime(r.updated_at), submitted_at: r.submitted_at && pgTime(r.submitted_at) };
};

test('dirty: never synced, or changed since', () => {
  const a = make();
  assert.equal(isDirty(a), true);
  assert.equal(isDirty(synced(a)), false);
  assert.equal(isDirty(chooseAnswer(synced(a), KEYS[0], 'a', T(5))), true);
  assert.equal(isDirty({ ...a, syncedAt: pgTime(a.updatedAt) }), false, 'compared as times, not text');
});

test('a row is the attempt in the database column names, with its owner, and never syncedAt', () => {
  const a = chooseAnswer(make(), KEYS[0], 'b', T(1));
  assert.deepEqual(toRow(a, 'user-1'), {
    id: ID1,
    user_id: 'user-1',
    exam: 'upsc',
    kind: 'paper',
    spec: { year: 2019 },
    question_keys: KEYS,
    answers: { [KEYS[0]]: 'b' },
    review_keys: [],
    current_index: 0,
    limit_ms: 120 * MINUTE,
    elapsed_ms: 0,
    status: 'in_progress',
    started_at: T(0),
    updated_at: T(1),
    submitted_at: null,
    result: null,
  });
});

test('a row read back is the attempt, its times normalised, synced as of its updatedAt', () => {
  const a = submitAttempt(chooseAnswer(make(), KEYS[0], 'b', T(1)), RESULT, T(2));
  assert.deepEqual(fromRow(row(a)), { ...a, syncedAt: T(2) });
  assert.equal(fromRow({ ...row(a), question_keys: [] }), null);
});

test('pick: submitted beats unfinished; earlier submit wins; else later update; ties to the account', () => {
  const open = make();
  const later = chooseAnswer(open, KEYS[0], 'a', T(9));
  const sub5 = submitAttempt(open, RESULT, T(5));
  const sub6 = submitAttempt(open, RESULT, T(6));
  assert.equal(pickAttempt(sub5, later), 'mine');
  assert.equal(pickAttempt(later, sub5), 'theirs');
  assert.equal(pickAttempt(sub5, sub6), 'mine');
  assert.equal(pickAttempt(sub6, sub5), 'theirs');
  assert.equal(pickAttempt(sub5, sub5), 'theirs');
  assert.equal(pickAttempt(later, open), 'mine');
  assert.equal(pickAttempt(open, later), 'theirs');
  assert.equal(pickAttempt(open, open), 'theirs');
  const abandoned = { ...open, status: 'abandoned', updatedAt: T(3) };
  assert.equal(pickAttempt(abandoned, open), 'mine', 'abandoned is a normal update');
  assert.equal(pickAttempt(abandoned, later), 'theirs');
});

test('merge: local only is uploaded; account only arrives; the winner of each pair stays', () => {
  const mineOnly = make(ID1, 1);
  const theirsOnly = submitAttempt(make(ID2, 1), RESULT, T(4));
  const mineNewer = chooseAnswer(synced(make(ID3, 0)), KEYS[0], 'c', T(7));
  const theirsOlder = make(ID3, 0);
  const { attempts, toUpload } = mergeAttempts({ [ID1]: mineOnly, [ID3]: mineNewer }, [row(theirsOnly), row(theirsOlder)]);
  assert.deepEqual(toUpload.map((a) => a.id).sort(), [ID1, ID3]);
  assert.deepEqual(attempts[ID1], { ...mineOnly, syncedAt: mineOnly.updatedAt });
  assert.deepEqual(attempts[ID2], { ...theirsOnly, syncedAt: theirsOnly.updatedAt });
  assert.deepEqual(attempts[ID3], { ...mineNewer, syncedAt: mineNewer.updatedAt });
});

test('merge: the account copy wins a tie and nothing is uploaded', () => {
  const a = synced(make());
  const { attempts, toUpload } = mergeAttempts({ [ID1]: a }, [row(a)]);
  assert.deepEqual(toUpload, []);
  assert.deepEqual(attempts[ID1], a);
});

test('merge: a submit on another device beats this device still answering', () => {
  const here = chooseAnswer(synced(make()), KEYS[1], 'd', T(30));
  const there = submitAttempt(make(), RESULT, T(20));
  const { attempts, toUpload } = mergeAttempts({ [ID1]: here }, [row(there)]);
  assert.deepEqual(toUpload, []);
  assert.equal(attempts[ID1].status, 'submitted');
});

test('merge: rows that do not parse are ignored', () => {
  const { attempts } = mergeAttempts({}, [{ id: 'nope' }]);
  assert.deepEqual(attempts, {});
});

test('settle: what changed here during the run is kept, still dirty; the rest takes the merge', () => {
  const before = synced(make(ID1, 0));
  const snapshot = { [ID1]: before, [ID2]: synced(make(ID2, 0)) };
  const fromAccount = { ...before, elapsedMs: 5000, updatedAt: T(3), syncedAt: T(3) };
  const merged = { [ID1]: fromAccount, [ID2]: snapshot[ID2], [ID3]: synced(make(ID3, 2)) };
  const answeredMidRun = chooseAnswer(before, KEYS[0], 'a', T(4));
  const startedMidRun = make('00000000-0000-4000-8000-000000000009', 4);
  const current = { [ID1]: answeredMidRun, [ID2]: snapshot[ID2], [startedMidRun.id]: startedMidRun };
  const out = settleAttempts(snapshot, current, merged, null);
  assert.deepEqual(out[ID1], { ...answeredMidRun, syncedAt: T(3) });
  assert.equal(isDirty(out[ID1]), true);
  assert.deepEqual(out[ID2], snapshot[ID2]);
  assert.deepEqual(out[ID3], merged[ID3]);
  assert.deepEqual(out[startedMidRun.id], startedMidRun);
});

test('settle, targeted: only the run\'s ids take the merge; others stay as stored', () => {
  const a = make(ID1, 1);
  const b = synced(make(ID2, 0));
  const out = settleAttempts({ [ID1]: a, [ID2]: b }, { [ID1]: a, [ID2]: b }, { [ID1]: synced(a) }, [ID1]);
  assert.deepEqual(out, { [ID1]: synced(a), [ID2]: b });
});

test('rebase for a new account keeps only attempts that never reached an account', () => {
  const mine = make(ID1, 1);
  const theirs = synced(make(ID2, 1));
  const theirsEdited = chooseAnswer(synced(make(ID3, 1)), KEYS[0], 'a', T(5));
  assert.deepEqual(rebaseTests({ attempts: { [ID1]: mine, [ID2]: theirs, [ID3]: theirsEdited } }), { attempts: { [ID1]: mine } });
});

test('attemptsEqual compares the stored collections', () => {
  const a = { [ID1]: make() };
  assert.equal(attemptsEqual(a, { [ID1]: make() }), true);
  assert.equal(attemptsEqual(a, { [ID1]: synced(make()) }), false);
  assert.equal(attemptsEqual(a, {}), false);
});
