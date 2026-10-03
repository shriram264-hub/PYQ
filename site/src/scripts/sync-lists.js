import { loadState, saveState } from '../lib/accounts/progress-store.js';
import { isDirty, listsEqual, mergeLists, settleLists } from '../lib/accounts/lists.js';
import { pullMarker, pullPages } from '../lib/accounts/pull.js';

// Like sync.js, no import of marks.js or save-to-list.js: they register
// listeners as a side effect. Open panels redraw on `sawaalbox:synced`.

const SETS = 'bookmark_sets';
const BOOKMARKS = 'bookmarks';

// Keys go in the request URL of a delete; this many fit comfortably.
const DELETE_KEYS_PER_REQUEST = 100;

// The lists have their own "pulled everything recently" marker, apart from the
// progress one, so that a lists step which keeps failing (a table or policy
// missing, a name the database refuses) cannot make the progress step pull
// every row on every run.
export const LISTS_MARKER_KEY = 'sawaalbox-sync-lists-v1';
const listsPull = pullMarker(LISTS_MARKER_KEY);
export const forgetListsPull = () => listsPull.forget();

// One DELETE per set, not per bookmark.
function removals(client, user, deleteBookmarks, lists) {
  const keysBySet = new Map();
  for (const b of deleteBookmarks) {
    const setId = lists[b.listId].remoteId;
    keysBySet.set(setId, [...(keysBySet.get(setId) ?? []), b.key]);
  }
  const requests = [];
  for (const [setId, keys] of keysBySet) {
    for (let i = 0; i < keys.length; i += DELETE_KEYS_PER_REQUEST) {
      requests.push(
        client
          .from(BOOKMARKS)
          .delete()
          .eq('set_id', setId)
          .eq('user_id', user.id)
          .in('question_key', keys.slice(i, i + DELETE_KEYS_PER_REQUEST))
      );
    }
  }
  return requests;
}

/**
 * Sync the revision lists. A run pulls every set and bookmark when this device
 * has not done so for this user in the last 10 minutes; in between it does
 * nothing unless some list here has something the account may not (see
 * isDirty), because a pull is the expensive part. The merge (lists.js) is
 * three-way, so removals travel as well as additions.
 *
 * Writes go in a fixed order: new sets, then bookmarks to add, then bookmarks
 * to delete. A bookmark needs its set to exist, and a failure part-way leaves
 * every step safe to repeat: the next run finds the set by name, the added
 * bookmarks already there, and sends what is left. Any error throws and leaves
 * the local lists as they were. The pull marker is written only when a full
 * pull and its save both succeeded.
 */
export async function syncLists(client, user) {
  const startedAt = Date.now();
  const snapshot = loadState().lists;
  const full = !listsPull.recent(user.id, startedAt);
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
  const deletes = await Promise.all(removals(client, user, deleteBookmarks, lists));
  const failed = deletes.find((r) => r.error);
  if (failed) throw failed.error;

  // Read storage again: the person may have saved more questions while the
  // requests above were in flight. See settleLists. Nothing changed means
  // nothing to save, and nothing for open panels to redraw.
  const current = loadState();
  const settled = settleLists(snapshot, current.lists, lists);
  const changed = !listsEqual(current.lists, settled);
  if (changed && !saveState({ ...current, lists: settled })) {
    throw new Error('lists could not be saved on this device');
  }
  if (full) listsPull.remember(user.id, startedAt);
  if (changed) document.dispatchEvent(new CustomEvent('sawaalbox:synced'));
}
