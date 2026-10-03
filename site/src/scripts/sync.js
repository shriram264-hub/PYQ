import { loadState, saveState } from '../lib/accounts/progress-store.js';
import { isOp, mergeProgress, settleSync } from '../lib/accounts/merge.js';
import { isDirty, listsEqual, mergeLists, settleLists } from '../lib/accounts/lists.js';

// No import of marks.js here, on purpose: it registers a click handler as a
// side effect, so a second module instance would toggle every mark twice. It
// repaints itself when it hears `sawaalbox:synced`.

const TABLE = 'question_progress';
const COLUMNS = 'question_key,status,updated_at';
const UPSERT = { onConflict: 'user_id,question_key' };
const SETS = 'bookmark_sets';
const BOOKMARKS = 'bookmarks';

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

// Every row of a table, in pages. `orderBy` must be a total order (the primary
// key), or rows can repeat or go missing between pages.
async function pullPages(client, table, columns, orderBy) {
  const rows = [];
  // Continue from what actually came back and stop on an empty page, not a
  // short one: the project's row cap can be lower than PAGE_ROWS, and trusting
  // the page size would then skip rows or end the pull early.
  for (;;) {
    let query = client.from(table).select(columns);
    for (const column of orderBy) query = query.order(column);
    const { data, error } = await query.range(rows.length, rows.length + PAGE_ROWS - 1);
    if (error) throw error;
    if (!data.length) return rows;
    rows.push(...data);
  }
}

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

/**
 * Sync the revision lists. A full run pulls every set and bookmark; in between
 * (`full` false) a run does nothing unless some list here has something the
 * account may not (see isDirty), because a pull is the expensive part. The
 * merge (lists.js) is three-way, so removals travel as well as additions.
 *
 * Writes go in a fixed order: new sets, then bookmarks to add, then bookmarks
 * to delete. A bookmark needs its set to exist, and a failure part-way leaves
 * every step safe to repeat: the next run finds the set by name, the added
 * bookmarks already there, and sends what is left. Any error throws and leaves
 * the local lists as they were.
 */
export async function syncLists(client, user, { full }) {
  const snapshot = loadState().lists;
  if (!full && !Object.values(snapshot).some(isDirty)) return;

  const [sets, bookmarks] = await Promise.all([
    pullPages(client, SETS, 'id,name', ['id']),
    pullPages(client, BOOKMARKS, 'set_id,question_key', ['set_id', 'question_key']),
  ]);
  const { lists, createSets, addBookmarks, deleteBookmarks } = mergeLists(snapshot, sets, bookmarks);

  if (createSets.length) {
    const { data, error } = await client
      .from(SETS)
      .insert(createSets.map((s) => ({ name: s.name, user_id: user.id })))
      .select('id,name');
    if (error) throw error;
    const idByName = new Map(data.map((s) => [s.name, s.id]));
    for (const s of createSets) {
      const id = idByName.get(s.name);
      if (!id) throw new Error(`the account did not create the list "${s.name}"`);
      lists[s.listId].remoteId = id;
    }
  }
  if (addBookmarks.length) {
    const rows = addBookmarks.map((b) => ({ set_id: lists[b.listId].remoteId, question_key: b.key, user_id: user.id }));
    // Adding what is already there is not an error, and must not need the
    // update permission an overwriting upsert would.
    const { error } = await client.from(BOOKMARKS).upsert(rows, { onConflict: 'set_id,question_key', ignoreDuplicates: true });
    if (error) throw error;
  }
  const deletes = await Promise.all(
    deleteBookmarks.map((b) => client.from(BOOKMARKS).delete().eq('set_id', lists[b.listId].remoteId).eq('question_key', b.key))
  );
  const failed = deletes.find((r) => r.error);
  if (failed) throw failed.error;

  // Read storage again: the person may have saved more questions while the
  // requests above were in flight. See settleLists. Nothing changed means
  // nothing to save, and nothing for open panels to redraw.
  const current = loadState();
  const settled = settleLists(snapshot, current.lists, lists);
  if (listsEqual(current.lists, settled)) return;
  if (!saveState({ ...current, lists: settled })) throw new Error('lists could not be saved on this device');
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

  // Progress, then lists. Each fails alone: a table that keeps refusing must not
  // hold the other back.
  async function syncOnce() {
    // Decided before the progress step, which renews the marker when it pulls.
    const full = !recentlyPulledAll(user.id, Date.now());
    try {
      await syncProgress(client, user);
    } catch (e) {
      console.warn('SawaalBox: will retry syncing', e);
    }
    if (stopped) return;
    try {
      await syncLists(client, user, { full });
    } catch (e) {
      console.warn('SawaalBox: will retry syncing lists', e);
      // The progress step may have renewed the marker for a pull this one did
      // not finish; the next run must pull everything again.
      if (full) forgetPullAll();
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
    doc.removeEventListener('sawaalbox:list', run);
    win.removeEventListener('online', run);
    doc.removeEventListener('sawaalbox:signed-out', onSignedOut);
    active = null;
    forgetPullAll();
  }

  // marks.js has already queued the op; the event only says "something changed".
  // A list change is the same: the lists are already saved, and the run finds
  // what differs from the account by comparing them with it.
  doc.addEventListener('sawaalbox:mark', run);
  doc.addEventListener('sawaalbox:list', run);
  win.addEventListener('online', run);
  doc.addEventListener('sawaalbox:signed-out', onSignedOut);
  return { run };
}
