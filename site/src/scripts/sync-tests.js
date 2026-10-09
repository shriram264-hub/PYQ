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

export const TESTS_MARKER_KEY = 'sawaalbox-sync-tests-v1';
const testsPull = pullMarker(TESTS_MARKER_KEY);
export const forgetTestsPull = () => testsPull.forget();

async function pullIds(client, ids) {
  const { data, error } = await client.from(TABLE).select(COLUMNS).in('id', ids);
  if (error) throw error;
  return data;
}

/**
 * One tests sync. A full pull of the account's attempts when this device has
 * not done one for this user in the last 10 minutes (or `full`); in between,
 * only the attempts changed here, and nothing at all when none has. The merge
 * (lib/tests/merge.js) decides each attempt; the winners from this device are
 * upserted, never deleted. Any request error throws and leaves storage as it
 * was, so the next run starts from the same place.
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

  for (let i = 0; i < toUpload.length; i += UPLOAD_ROWS_PER_REQUEST) {
    const batch = toUpload.slice(i, i + UPLOAD_ROWS_PER_REQUEST).map((a) => toRow(a, user.id));
    const { error } = await client.from(TABLE).upsert(batch, { onConflict: 'id' });
    if (error) throw error;
  }

  // Read storage again: an answer given, or a test started, while the requests
  // above were in flight is kept (see settleAttempts). Pruned as saveTests
  // prunes: an account with more attempts than the device keeps would
  // otherwise look changed after every full pull.
  const current = loadTests();
  const settled = pruneAttempts(settleAttempts(snapshot, current.attempts, attempts, scopeIds));
  const changed = !attemptsEqual(current.attempts, settled);
  if (changed && !saveTests({ ...current, attempts: settled })) {
    throw new Error('tests could not be saved on this device');
  }
  deviceOwner.remember(user.id);
  if (!scopeIds) testsPull.remember(user.id, startedAt);
  if (changed) document.dispatchEvent(new CustomEvent('sawaalbox:synced'));
}
