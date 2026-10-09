import { loadTests, pruneAttempts, saveTests } from '../lib/tests/store.js';
import { attemptsEqual, isDirty, mergeAttempts, settleAttempts, toRow } from '../lib/tests/merge.js';
import { deviceOwner, pullMarker, pullPages } from '../lib/accounts/pull.js';

// The third step of a sync run (scripts/sync.js), after progress and lists:
// this device's mock test attempts and the account's test_attempts rows. Like
// the others it has its own "pulled everything recently" marker, so a step that
// keeps failing never makes another pull everything again.

const TABLE = 'test_attempts';
const COLUMNS =
  'id,exam,kind,spec,question_keys,answers,review_keys,current_index,limit_ms,elapsed_ms,status,started_at,updated_at,submitted_at,result';

// Ids go in the request URL of a targeted pull (36 characters each).
const MAX_TARGETED_IDS = 50;
// An attempt row is a few KB (150 keys, answers); this many per request keeps
// a first sign-in with a full device (200 attempts) to modest requests.
const UPLOAD_ROWS_PER_REQUEST = 50;

/**
 * True when the database refused a row because row-level security hides it:
 * the id is another account's attempt (see upload). The code alone does not
 * say so. 42501 ("insufficient privilege") is also the answer when the
 * request has no session: the anon role is granted nothing on this table
 * ("permission denied for table test_attempts"), and a sign-out, here or in
 * another tab, can take the session while a run is still uploading. Taken for
 * another account's, every attempt never sent would then leave this device. So
 * the message decides: Postgres says "new row violates row-level security
 * policy for table ..." (or "... policy (USING expression) for table ..." on
 * the ON CONFLICT update an upsert makes).
 */
const refusedByPolicy = (error) => error.code === '42501' && /row-level security/.test(error.message ?? '');

export const TESTS_MARKER_KEY = 'sawaalbox-sync-tests-v1';
const testsPull = pullMarker(TESTS_MARKER_KEY);
export const forgetTestsPull = () => testsPull.forget();

async function pullIds(client, ids) {
  const { data, error } = await client.from(TABLE).select(COLUMNS).in('id', ids);
  if (error) throw error;
  return data;
}

/**
 * Upserts this device's winning copies, in batches, and returns the ids of the
 * ones another account holds. An attempt's id is made on the device, so one
 * table holds every account's attempts, and an id can already be another
 * account's row: on a shared browser, A's upload landed but its response was
 * lost (or the save after it failed), so the attempt stayed here as never sent,
 * and the rebase kept it for B (sync.js claimDevice). B cannot see A's row, and
 * row-level security refuses B's upsert onto it, the whole batch with it. Ids
 * are random, so that is the only way an id is taken: a batch refused so is
 * sent again one row at a time (a batch of one is judged as it was refused),
 * and a row refused so that the pull did not show (`seen`) is another
 * account's. Any other error throws, as does a refusal of a row this account
 * can see, which cannot be another account's.
 */
async function upload(client, user, attempts, seen) {
  const send = (batch) => client.from(TABLE).upsert(batch.map((a) => toRow(a, user.id)), { onConflict: 'id' });
  const foreign = [];
  for (let i = 0; i < attempts.length; i += UPLOAD_ROWS_PER_REQUEST) {
    const batch = attempts.slice(i, i + UPLOAD_ROWS_PER_REQUEST);
    const { error } = await send(batch);
    if (!error) continue;
    if (!refusedByPolicy(error)) throw error;
    for (const a of batch) {
      const refused = batch.length === 1 ? error : (await send([a])).error;
      if (!refused) continue;
      if (!refusedByPolicy(refused) || seen.has(a.id)) throw refused;
      foreign.push(a.id);
    }
  }
  return foreign;
}

/**
 * One tests sync. A full pull of the account's attempts when this device has
 * not done one for this user in the last 10 minutes (or `full`); in between,
 * only the attempts changed here, and nothing at all when none has. The merge
 * (lib/tests/merge.js) decides each attempt; the winners from this device are
 * upserted, never deleted. An attempt the account refuses because another
 * account holds its id leaves this device (that account keeps it), so it
 * cannot stop the step on every run (see upload). Any other request error
 * throws and leaves storage as it was, so the next run starts from the same
 * place.
 */
export async function syncTests(client, user, { full = false } = {}) {
  const startedAt = Date.now();
  const snapshot = loadTests().attempts;
  const dirty = Object.values(snapshot)
    .filter(isDirty)
    .map((a) => a.id);

  let scopeIds = null; // null = everything
  if (!full && testsPull.recent(user.id, startedAt)) {
    if (!dirty.length) return;
    if (dirty.length <= MAX_TARGETED_IDS) scopeIds = dirty;
  }

  const rows = scopeIds ? await pullIds(client, scopeIds) : await pullPages(client, TABLE, COLUMNS, ['id']);
  const local = scopeIds ? Object.fromEntries(scopeIds.map((id) => [id, snapshot[id]])) : snapshot;
  const { attempts, toUpload } = mergeAttempts(local, rows);

  const foreign = await upload(client, user, toUpload, new Set(rows.map((r) => r.id)));

  // Read storage again: an answer given, or a test started, while the requests
  // above were in flight is kept (see settleAttempts), except in an attempt
  // another account holds, which goes however it changed. Pruned as saveTests
  // prunes: an account with more attempts than the device keeps would
  // otherwise look changed after every full pull.
  const current = loadTests();
  const kept = settleAttempts(snapshot, current.attempts, attempts, scopeIds);
  for (const id of foreign) delete kept[id];
  const settled = pruneAttempts(kept);
  const changed = !attemptsEqual(current.attempts, settled);
  if (changed && !saveTests({ ...current, attempts: settled })) {
    throw new Error('tests could not be saved on this device');
  }
  deviceOwner.remember(user.id);
  if (!scopeIds) testsPull.remember(user.id, startedAt);
  if (changed) document.dispatchEvent(new CustomEvent('sawaalbox:synced'));
}
