import { loadState, saveState } from '../lib/accounts/progress-store.js';
import { isOp, mergeProgress, settleSync } from '../lib/accounts/merge.js';

// No import of marks.js here, on purpose: it registers a click handler as a
// side effect, so a second module instance would toggle every mark twice. It
// repaints itself when it hears `sawaalbox:synced`.

const TABLE = 'question_progress';
const COLUMNS = 'question_key,status,updated_at';
const UPSERT = { onConflict: 'user_id,question_key' };

// Supabase returns at most 1,000 rows per request by default. A full pull that
// stopped at the first page would look like "the account lacks these marks",
// and the merge would then drop this device's synced copies of them.
const PAGE_ROWS = 1000;

// The audience is on mobile data, so a full pull of every row is the exception:
// once per 10 minutes at most. In between, a run asks only about the questions
// this device changed. That many keys go in the request URL, so past a limit a
// full pull is the cheaper way to ask.
const FULL_PULL_EVERY_MS = 10 * 60 * 1000;
const MAX_TARGETED_KEYS = 100;

export const SYNC_MARKER_KEY = 'sawaalbox-sync-v1';

function recentlyPulledAll(userId, now) {
  try {
    const marker = JSON.parse(globalThis.localStorage.getItem(SYNC_MARKER_KEY));
    const age = now - Date.parse(marker.at);
    // A time in the future (clock changed) is not recent: it would never expire.
    return marker.user === userId && age >= 0 && age < FULL_PULL_EVERY_MS;
  } catch {
    // Nothing stored, unreadable, or storage blocked: we cannot prove a recent pull.
    return false;
  }
}

function rememberPullAll(userId, at) {
  try {
    globalThis.localStorage.setItem(SYNC_MARKER_KEY, JSON.stringify({ user: userId, at: new Date(at).toISOString() }));
  } catch {
    /* without the marker the next run just pulls everything again */
  }
}

function forgetPullAll() {
  try {
    globalThis.localStorage.removeItem(SYNC_MARKER_KEY);
  } catch {
    /* blocked storage holds no marker */
  }
}

async function pullAll(client) {
  const rows = [];
  // Continue from what actually came back and stop on an empty page, not a
  // short one: the project's row cap can be lower than PAGE_ROWS, and trusting
  // the page size would then skip rows or end the pull early.
  for (;;) {
    const { data, error } = await client
      .from(TABLE)
      .select(COLUMNS)
      .order('question_key')
      .range(rows.length, rows.length + PAGE_ROWS - 1);
    if (error) throw error;
    if (!data.length) return rows;
    rows.push(...data);
  }
}

async function pullKeys(client, keys) {
  const { data, error } = await client.from(TABLE).select(COLUMNS).in('question_key', keys);
  if (error) throw error;
  return data;
}

/**
 * One sync: fetch the account's rows, merge them with this device's marks,
 * send what the device has newer, then save. Any request error throws and
 * leaves local state and the pending queue untouched, so the next run starts
 * from the same place.
 */
export async function syncProgress(client, user) {
  const startedAt = Date.now();
  const snapshot = loadState();
  const pending = snapshot.pending.filter(isOp);
  const pendingKeys = [...new Set(pending.map((op) => op.key))];

  let scopeKeys = null; // null = full pull
  if (recentlyPulledAll(user.id, startedAt)) {
    if (!pendingKeys.length) return; // nothing changed here, nothing to ask
    if (pendingKeys.length <= MAX_TARGETED_KEYS) scopeKeys = pendingKeys;
  }

  const rows = scopeKeys ? await pullKeys(client, scopeKeys) : await pullAll(client);
  let local = snapshot.entries;
  if (scopeKeys) local = Object.fromEntries(scopeKeys.filter((k) => local[k]).map((k) => [k, local[k]]));
  const { entries, toUpload, toDelete } = mergeProgress(local, rows, pending);

  if (toUpload.length) {
    const { error } = await client
      .from(TABLE)
      .upsert(toUpload.map((r) => ({ ...r, user_id: user.id })), UPSERT);
    if (error) throw error;
  }
  // Only rows older than the clear: a newer edit another device made since we
  // fetched survives, and the next run brings it in.
  const deletes = await Promise.all(
    toDelete.map((d) =>
      client.from(TABLE).delete().eq('user_id', user.id).eq('question_key', d.question_key).lt('updated_at', d.cleared_at)
    )
  );
  const failed = deletes.find((r) => r.error);
  if (failed) throw failed.error;

  // Read storage again: the person may have marked more questions while the
  // requests above were in flight. See settleSync.
  if (!saveState(settleSync(snapshot, loadState(), entries, scopeKeys))) {
    throw new Error('progress could not be saved on this device');
  }
  if (!scopeKeys) rememberPullAll(user.id, startedAt);
  document.dispatchEvent(new CustomEvent('sawaalbox:synced'));
}

// The sync wired to this page, if any: kept so a second startSync does not add
// a second set of listeners.
let active = null;

export function startSync(client, user) {
  active ??= openSession(client, user);
  return active.run();
}

function openSession(client, user) {
  const doc = document;
  const win = window;
  let running = null;
  let again = false;
  let stopped = false;

  // One run at a time. A request that arrives during a run (a click, coming
  // back online) is covered by one follow-up run, which reads state afresh.
  function run() {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          try {
            await syncProgress(client, user);
          } catch (e) {
            console.warn('SawaalBox: will retry syncing', e);
          }
        } while (again && !stopped);
        // A run that outlived sign-out may have written the marker after it was removed.
        if (stopped) forgetPullAll();
      } finally {
        running = null;
      }
    })();
    return running;
  }

  // The client is dead after sign-out: no more runs with it, and the next
  // person to sign in on this device must start with a full pull.
  function onSignedOut() {
    stopped = true;
    doc.removeEventListener('sawaalbox:mark', run);
    win.removeEventListener('online', run);
    doc.removeEventListener('sawaalbox:signed-out', onSignedOut);
    active = null;
    forgetPullAll();
  }

  // marks.js has already queued the op; the event only says "something changed".
  doc.addEventListener('sawaalbox:mark', run);
  win.addEventListener('online', run);
  doc.addEventListener('sawaalbox:signed-out', onSignedOut);
  return { run };
}
