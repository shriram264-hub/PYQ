import { loadState, saveState } from '../lib/accounts/progress-store.js';
import { isDirty, listsEqual, mergeLists, settleLists, settleTombstones } from '../lib/accounts/lists.js';
import { deviceOwner, pullMarker, pullPages } from '../lib/accounts/pull.js';

// Like sync.js, no import of marks.js or save-to-list.js: they register
// listeners as a side effect. Open panels redraw on `sawaalbox:synced`.

const SETS = 'bookmark_sets';
const BOOKMARKS = 'bookmarks';

// Keys and ids go in the request URL of a delete; this many fit comfortably.
const DELETE_KEYS_PER_REQUEST = 100;

// The database's code for a unique violation: the account already has a set of
// that name.
const UNIQUE_VIOLATION = '23505';

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

// Sets deleted by id, in chunks. Each set's bookmarks go with it, by the
// database's cascade.
function setDeletions(client, user, setIds) {
  const requests = [];
  for (let i = 0; i < setIds.length; i += DELETE_KEYS_PER_REQUEST) {
    requests.push(
      client
        .from(SETS)
        .delete()
        .eq('user_id', user.id)
        .in('id', setIds.slice(i, i + DELETE_KEYS_PER_REQUEST))
    );
  }
  return requests;
}

/**
 * The renames in an order the account accepts. It refuses two sets of one name
 * at any moment, so a rename onto a name another set holds now has to wait for
 * that set's own rename when it has one in this run ("Polity" to "Polity 2"
 * after "Polity 2" to "Maps"). A name has at most one holder, so each rename
 * waits for at most one other. Names that hand each other round in a cycle have
 * no safe order: they are left as they come, and the account refuses the first
 * of them (see syncLists).
 */
function inDependencyOrder(renameSets, lists, sets) {
  const holderOf = new Map(sets.map((s) => [s.name, s.id]));
  const renameOf = new Map(renameSets.map((r) => [lists[r.listId].remoteId, r]));
  const ordered = [];
  const placed = new Set();
  const visiting = new Set();
  const place = (rename) => {
    const id = lists[rename.listId].remoteId;
    if (placed.has(id) || visiting.has(id)) return;
    visiting.add(id);
    const blocker = renameOf.get(holderOf.get(rename.name));
    if (blocker && blocker !== rename) place(blocker);
    visiting.delete(id);
    placed.add(id);
    ordered.push(rename);
  };
  renameSets.forEach(place);
  return ordered;
}

const sameIds = (a, b) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Sync the revision lists. A run pulls every set and bookmark when this device
 * has not done so for this user in the last 10 minutes; in between it does
 * nothing unless some list here has something the account may not (see
 * isDirty), or a set is waiting to be deleted (a tombstone, see lists.js),
 * because a pull is the expensive part. The merge (lists.js) is three-way, so
 * removals travel as well as additions.
 *
 * Writes go in a fixed order: sets deleted here, sets renamed here, new sets,
 * then bookmarks to add, then bookmarks to delete. A bookmark needs its set to
 * exist, and the account refuses two sets of one name, so a new list that takes
 * the name of one deleted or renamed in the same run must come after it. A
 * failure part-way leaves every step safe to repeat: the next run finds the set
 * by name, the added bookmarks already there, and sends what is left. Any error
 * throws and leaves the local lists as they were. The pull marker is written
 * only when a full pull and its save both succeeded.
 */
export async function syncLists(client, user, { full: everything = false } = {}) {
  const startedAt = Date.now();
  const start = loadState();
  const snapshot = start.lists;
  const full = everything || !listsPull.recent(user.id, startedAt);
  if (!full && !start.deletedLists.length && !Object.values(snapshot).some(isDirty)) return;

  const [sets, bookmarks] = await Promise.all([
    pullPages(client, SETS, 'id,name', ['id']),
    pullPages(client, BOOKMARKS, 'set_id,question_key', ['set_id', 'question_key']),
  ]);
  const { lists, createSets, addBookmarks, deleteBookmarks, renameSets, deleteSets, foldedInto } = mergeLists(
    snapshot,
    sets,
    bookmarks,
    start.deletedLists
  );

  const setDeletes = await Promise.all(setDeletions(client, user, deleteSets));
  const refused = setDeletes.find((r) => r.error);
  if (refused) throw refused.error;

  // One at a time, in order (see inDependencyOrder).
  for (const { listId, name } of inDependencyOrder(renameSets, lists, sets)) {
    const list = lists[listId];
    const { error } = await client.from(SETS).update({ name }).eq('id', list.remoteId).eq('user_id', user.id);
    if (!error) continue;
    if (error.code !== UNIQUE_VIOLATION) throw error;
    // The account has a set of that name now: another device made one after our
    // read. Drop the rename and take the account's name for this list, as the
    // merge does when it sees the clash itself. Left as it was, the list would
    // be dirty again and send the same refused rename on every run.
    const held = sets.find((s) => s.id === list.remoteId).name;
    list.name = held;
    list.syncedName = held;
  }

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

  // Read storage again: the person may have changed the lists while the
  // requests above were in flight (saved or removed a question, renamed or
  // deleted a list). See settleLists. Nothing changed means nothing to save,
  // and nothing for open panels to redraw.
  const current = loadState();
  const settled = settleLists(snapshot, current.lists, lists, foldedInto);
  // The tombstones this run handled are done; any made during it stay. One more
  // kind is owed: a list this run uploaded, or joined to an account set, that
  // the person deleted before the run finished. It had no remote id to leave
  // when it was deleted, but its set exists now and the next pull would adopt
  // it back.
  const deletedLists = settleTombstones(start.deletedLists, current.deletedLists);
  for (const [id, was] of Object.entries(snapshot)) {
    const setId = lists[id]?.remoteId;
    if (was.remoteId === null && !(id in current.lists) && typeof setId === 'string' && !deletedLists.includes(setId)) {
      deletedLists.push(setId);
    }
  }
  const changed = !listsEqual(current.lists, settled) || !sameIds(current.deletedLists, deletedLists);
  if (changed && !saveState({ ...current, lists: settled, deletedLists })) {
    throw new Error('lists could not be saved on this device');
  }
  // The lists here are now this account's (sync.js claimDevice).
  deviceOwner.remember(user.id);
  if (full) listsPull.remember(user.id, startedAt);
  if (changed) document.dispatchEvent(new CustomEvent('sawaalbox:synced'));
}
