import { isOp, loadState, saveState } from '../lib/accounts/progress-store.js';
import { mergeProgress, rebaseForNewAccount, settleSync } from '../lib/accounts/merge.js';
import { deviceOwner, pullMarker, pullPages } from '../lib/accounts/pull.js';
import { forgetListsPull, syncLists } from './sync-lists.js';

// No import of marks.js here, on purpose: it registers a click handler as a
// side effect, so a second module instance would toggle every mark twice. It
// repaints itself when it hears `sawaalbox:synced`.

const TABLE = 'question_progress';
const COLUMNS = 'question_key,status,updated_at';
const UPSERT = { onConflict: 'user_id,question_key' };

// A full pull of every row is the exception (see FULL_PULL_EVERY_MS in
// pull.js); in between, a run asks only about the questions this device
// changed. That many keys go in the request URL, so past a limit a full pull is
// the cheaper way to ask.
const MAX_TARGETED_KEYS = 100;

export const SYNC_MARKER_KEY = 'sawaalbox-sync-v1';
const progressPull = pullMarker(SYNC_MARKER_KEY);

const pullAll = (client) => pullPages(client, TABLE, COLUMNS, ['question_key']);

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
  if (progressPull.recent(user.id, startedAt)) {
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
  // The synced marks here are now this account's (see claimDevice).
  deviceOwner.remember(user.id);
  if (!scopeKeys) progressPull.remember(user.id, startedAt);
  document.dispatchEvent(new CustomEvent('sawaalbox:synced'));
}

/**
 * The start of every run. When a different account was the last to sync on
 * this browser (a shared computer: A signed out, B signed in), A's copy is
 * taken off the device first (rebaseForNewAccount), so it is neither merged
 * into B's account nor shown as B's, and both pull markers go, so the run
 * reads everything. No owner stored (the first sign-in on this browser, or
 * data from before owners were kept) merges everything, as any first sign-in
 * does. Throws when storage refuses the rebased state: merging A's copy as it
 * stands is what must not happen, so the run stops there and retries later.
 */
function claimDevice(user) {
  const owner = deviceOwner.read();
  if (owner === null || owner === user.id) return;
  const before = loadState();
  const after = rebaseForNewAccount(before);
  const size = (s) => [Object.keys(s.entries).length, s.pending.length, Object.keys(s.lists).length].join();
  if (size(after) !== size(before)) {
    if (!saveState(after)) throw new Error("another account's copy could not be cleared from this device");
    // Storage changed under the page: marks and open panels redraw.
    document.dispatchEvent(new CustomEvent('sawaalbox:synced'));
  }
  progressPull.forget();
  forgetListsPull();
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

  // Progress, then lists. Each fails alone, and each keeps its own pull marker:
  // a table that keeps refusing must neither hold the other back nor make it
  // pull everything again.
  async function syncOnce() {
    try {
      claimDevice(user);
    } catch (e) {
      console.warn('SawaalBox: will retry syncing', e);
      return;
    }
    try {
      await syncProgress(client, user);
    } catch (e) {
      console.warn('SawaalBox: will retry syncing', e);
    }
    if (stopped) return;
    try {
      await syncLists(client, user);
    } catch (e) {
      console.warn('SawaalBox: will retry syncing lists', e);
    }
  }

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
          await syncOnce();
        } while (again && !stopped);
        // A run that outlived sign-out may have written the markers after they were removed.
        if (stopped) forgetMarkers();
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function forgetMarkers() {
    progressPull.forget();
    forgetListsPull();
  }

  // Sign-out asks for one last run before the session goes (auth.js
  // finishSyncing), so changes still queued here reach the account they were
  // made under rather than the next account to sign in on this browser. It
  // waits for the run, up to its own time limit; a run never rejects.
  function onSigningOut(event) {
    event.detail?.waitUntil?.(run());
  }

  // The client is dead after sign-out: no more runs with it, and the next
  // person to sign in on this device must start with a full pull.
  function onSignedOut() {
    stopped = true;
    doc.removeEventListener('sawaalbox:mark', run);
    doc.removeEventListener('sawaalbox:list', run);
    win.removeEventListener('online', run);
    doc.removeEventListener('sawaalbox:signing-out', onSigningOut);
    doc.removeEventListener('sawaalbox:signed-out', onSignedOut);
    active = null;
    forgetMarkers();
  }

  // marks.js has already queued the op; the event only says "something changed".
  // A list change is the same: the lists are already saved, and the run finds
  // what differs from the account by comparing them with it.
  doc.addEventListener('sawaalbox:mark', run);
  doc.addEventListener('sawaalbox:list', run);
  win.addEventListener('online', run);
  doc.addEventListener('sawaalbox:signing-out', onSigningOut);
  doc.addEventListener('sawaalbox:signed-out', onSignedOut);
  return { run };
}
