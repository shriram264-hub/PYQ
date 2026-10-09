import { parseAttempt } from './attempt.js';

// Merging this device's attempts with the account's (scripts/sync-tests.js).
// Pure. An attempt is one row, matched by its id, and the whole attempt wins or
// loses as one: a test is answered on one device at a time.

const at = (iso) => Date.parse(iso);

/** Changed since the account last confirmed it (or never sent). */
export const isDirty = (a) => a.syncedAt === null || at(a.syncedAt) !== at(a.updatedAt);

export function toRow(a, userId) {
  return {
    id: a.id,
    user_id: userId,
    exam: a.exam,
    kind: a.kind,
    spec: a.spec,
    question_keys: a.keys,
    answers: a.answers,
    review_keys: a.review,
    current_index: a.current,
    limit_ms: a.limitMs,
    elapsed_ms: a.elapsedMs,
    status: a.status,
    started_at: a.startedAt,
    updated_at: a.updatedAt,
    submitted_at: a.submittedAt,
    result: a.result,
  };
}

// The database writes times its own way (2026-10-09T10:00:00.123+00:00); the
// device writes toISOString. One form on the device keeps comparisons simple.
const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : v);

/** An account row as an attempt, checked like storage, and synced as of its own update. Null when it does not parse. */
export function fromRow(r) {
  const a = parseAttempt({
    id: r.id,
    exam: r.exam,
    kind: r.kind,
    spec: r.spec,
    keys: r.question_keys,
    answers: r.answers,
    review: r.review_keys,
    current: r.current_index,
    limitMs: r.limit_ms,
    elapsedMs: r.elapsed_ms,
    status: r.status,
    startedAt: iso(r.started_at),
    updatedAt: iso(r.updated_at),
    submittedAt: r.submitted_at == null ? null : iso(r.submitted_at),
    result: r.result,
    syncedAt: null,
  });
  return a && { ...a, syncedAt: a.updatedAt };
}

/**
 * Which copy of one attempt stands (spec, "Merge per attempt id"): a submitted
 * copy beats one that is not; of two submitted, the earlier submit; otherwise
 * the later update. Every tie goes to the account ('theirs'), so two devices
 * holding the same copy never send it back and forth.
 */
export function pickAttempt(mine, theirs) {
  const mineDone = mine.status === 'submitted';
  const theirsDone = theirs.status === 'submitted';
  if (mineDone && theirsDone) return at(mine.submittedAt) < at(theirs.submittedAt) ? 'mine' : 'theirs';
  if (mineDone !== theirsDone) return mineDone ? 'mine' : 'theirs';
  return at(mine.updatedAt) > at(theirs.updatedAt) ? 'mine' : 'theirs';
}

/**
 * @param local  { [id]: attempt } this device's attempts in the run's scope
 * @param rows   the account's rows for that scope
 * @returns attempts  { [id]: attempt } every attempt in scope, as it stands
 *                    after the run, uploads counted as synced (the run saves
 *                    nothing when an upload fails)
 *          toUpload  this device's copies the account must take
 * Attempts are never deleted, so one the account lacks is uploaded, whatever
 * its syncedAt says.
 */
export function mergeAttempts(local, rows) {
  const attempts = {};
  for (const r of rows) {
    const a = fromRow(r);
    if (a) attempts[a.id] = a;
  }
  const toUpload = [];
  for (const [id, mine] of Object.entries(local)) {
    const theirs = attempts[id];
    if (theirs && pickAttempt(mine, theirs) === 'theirs') continue;
    toUpload.push(mine);
    attempts[id] = { ...mine, syncedAt: mine.updatedAt };
  }
  return { attempts, toUpload };
}

/**
 * The attempts to save when a run ends. The run worked from `snapshot`, and the
 * student may have answered, moved on or started a test while it waited on the
 * network: `current` (storage read again) holds that. An attempt that changed
 * here during the run keeps this device's copy, with the run's syncedAt, so it
 * stays dirty and the next run sends it (or loses it to a submit elsewhere).
 * With `scopeIds` null the merge covered every attempt; with a list, only those.
 */
export function settleAttempts(snapshot, current, merged, scopeIds = null) {
  const out = scopeIds === null ? { ...merged } : { ...current };
  if (scopeIds !== null) for (const id of scopeIds) if (merged[id]) out[id] = merged[id];
  for (const [id, now] of Object.entries(current)) {
    const was = snapshot[id];
    if (was && at(was.updatedAt) === at(now.updatedAt) && was.status === now.status) continue;
    out[id] = { ...now, syncedAt: merged[id]?.syncedAt ?? now.syncedAt };
  }
  return out;
}

/**
 * A different account signs in on this browser (sync.js claimDevice): the
 * attempts the previous account holds go, and the ones that never reached any
 * account stay and join this one, as never-synced marks do.
 */
export function rebaseTests(tests) {
  return { ...tests, attempts: Object.fromEntries(Object.entries(tests.attempts).filter(([, a]) => a.syncedAt === null)) };
}

export const attemptsEqual = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (attempts) => Object.keys(attempts).sort().map((id) => attempts[id]);
