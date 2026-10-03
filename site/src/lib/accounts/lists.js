// Revision lists. A list is { name, keys, remoteId, syncedKeys }:
//   keys        the questions in it, on this device
//   remoteId    the account's bookmark_sets.id once it has one, else null
//   syncedKeys  the keys the account held for it at the last sync (the "base").
// The local id (the key in state.lists) never changes after creation; remoteId
// is a separate field so ids held by an open panel stay valid across a sync.
//
// Keep this module free of imports: progress-store.js imports MAX_NAME from it,
// so an import back would be a cycle.

export const MAX_NAME = 80;

export function cleanName(name) {
  const n = String(name).trim();
  if (!n) throw new Error('Give the list a name.');
  if (n.length > MAX_NAME) throw new Error(`List names can be up to ${MAX_NAME} characters.`);
  return n;
}

/** An id for a new list. randomUUID needs a secure context; the fallback covers older browsers. */
export function newListId() {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function createList(state, name, id) {
  const clean = cleanName(name);
  // The account allows one list per name; a second would fail every sync.
  if (Object.values(state.lists).some((l) => l.name === clean)) {
    throw new Error(`You already have a list called "${clean}".`);
  }
  return { ...state, lists: { ...state.lists, [id]: { name: clean, keys: [], remoteId: null, syncedKeys: [] } } };
}

export function toggleKey(state, listId, key) {
  const list = state.lists[listId];
  // The list may have gone since the panel drew it (a sync dropped it).
  if (!list) return { state, added: false };
  const added = !list.keys.includes(key);
  const keys = added ? [...list.keys, key] : list.keys.filter((k) => k !== key);
  return { state: { ...state, lists: { ...state.lists, [listId]: { ...list, keys } } }, added };
}

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

/** A list the account may not match yet: never uploaded, or keys changed since the last sync. */
export const isDirty = (list) => list.remoteId === null || !sameSet(list.keys, list.syncedKeys);

export function listsEqual(a, b) {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => {
    const x = a[id];
    const y = b[id];
    return (
      Boolean(y) &&
      x.name === y.name &&
      x.remoteId === y.remoteId &&
      x.keys.length === y.keys.length &&
      x.keys.every((k, i) => k === y.keys[i]) &&
      sameSet(x.syncedKeys, y.syncedKeys)
    );
  });
}

/**
 * Three-way merge of one list's keys. L = local, R = the account's, B = what
 * the account held at the last sync. A union would bring every removal back
 * from any device that still had the key, so B tells "added here/there" from
 * "removed here/there":
 *   in L and R                     keep
 *   in L only, not in B            added here: keep and upload
 *   in R only, not in B            added on another device: keep
 *   in L and B, not in R           removed on another device: drop
 *   in R and B, not in L           removed here: delete from the account
 */
function mergeKeys(local, remoteKeys) {
  const R = new Set(remoteKeys);
  const B = new Set(local.syncedKeys);
  const L = new Set(local.keys);
  const keys = [];
  const upload = [];
  const remove = [];
  for (const k of local.keys) {
    if (R.has(k)) keys.push(k);
    else if (!B.has(k)) {
      keys.push(k);
      upload.push(k);
    }
  }
  for (const k of remoteKeys) {
    if (L.has(k)) continue;
    if (B.has(k)) remove.push(k);
    else keys.push(k);
  }
  return { keys, upload, remove };
}

/**
 * Merge this device's lists with the account's. `remoteSets` is [{ id, name }],
 * `remoteBookmarks` is [{ set_id, question_key }].
 *
 * Returns the lists as they will be once the writes below succeed, and the
 * writes: sets to create ({ listId, name }), bookmarks to add and to delete
 * ({ listId, key }). A created list has remoteId null in `lists` until its set
 * exists; the caller fills it in. Nothing here touches the network or storage.
 *
 *  - A list with a remoteId is three-way merged with that set, or dropped if
 *    the set is gone (deleted on another device, or another account's).
 *  - A list with no remoteId joins the account's set of the same name, else
 *    its set is created. All its keys are additions, so this is a union:
 *    nothing a student saved before signing in is discarded.
 *  - A set no local list maps to is adopted, under its own id.
 */
export function mergeLists(localLists, remoteSets, remoteBookmarks) {
  // Keys go through a Set: paging by offset can return a row twice when rows
  // arrive between pages, and a list must never hold a key twice.
  const remote = new Map(remoteSets.map((s) => [s.id, { ...s, keys: new Set() }]));
  for (const b of remoteBookmarks) remote.get(b.set_id)?.keys.add(b.question_key);
  for (const set of remote.values()) set.keys = [...set.keys];
  const setIdByName = new Map(remoteSets.map((s) => [s.name, s.id]));

  const result = new Map(); // local id -> merged list
  const createSets = [];
  const addBookmarks = [];
  const deleteBookmarks = [];
  const ownerOf = new Map(); // remote id -> local id that merged with it
  const creating = new Map(); // name -> local id whose set will be created

  const entries = Object.entries(localLists);
  const finish = (id, list, keys, remoteId, { upload = [], remove = [] } = {}) => {
    result.set(id, { name: list.name, keys, remoteId, syncedKeys: [...keys] });
    for (const key of upload) addBookmarks.push({ listId: id, key });
    for (const key of remove) deleteBookmarks.push({ listId: id, key });
  };

  // Lists that know their set go first, so a list without one that shares its
  // name folds into them rather than racing for the set.
  for (const [id, l] of entries) {
    const set = l.remoteId && remote.get(l.remoteId);
    if (!set || ownerOf.has(set.id)) continue; // set gone: the list was deleted elsewhere
    const m = mergeKeys(l, set.keys);
    ownerOf.set(set.id, id);
    finish(id, l, m.keys, set.id, m);
  }

  for (const [id, l] of entries) {
    if (l.remoteId) continue;
    const setId = setIdByName.get(l.name);
    const owner = setId === undefined ? creating.get(l.name) : ownerOf.get(setId);
    if (owner !== undefined) {
      // Another list here already stands for this set (two tabs creating one
      // name at once): fold this one in, or the account would be asked for the
      // same name twice and refuse every sync.
      const into = result.get(owner);
      for (const key of l.keys) {
        if (into.keys.includes(key)) continue;
        into.keys.push(key);
        into.syncedKeys.push(key);
        // The owner may be deleting this very key (removed on this device): the
        // other copy still has it, so the key stays and the delete is cancelled.
        // Adding it as well would upload and delete the same row in one run.
        const deleting = deleteBookmarks.findIndex((d) => d.listId === owner && d.key === key);
        if (deleting >= 0) deleteBookmarks.splice(deleting, 1);
        else addBookmarks.push({ listId: owner, key });
      }
    } else if (setId === undefined) {
      creating.set(l.name, id);
      createSets.push({ listId: id, name: l.name });
      finish(id, l, [...l.keys], null, { upload: l.keys });
    } else {
      // The account already has a list of this name: every local key is an
      // addition (the base is empty), so the result is the union.
      ownerOf.set(setId, id);
      const m = mergeKeys({ ...l, syncedKeys: [] }, remote.get(setId).keys);
      finish(id, l, m.keys, setId, m);
    }
  }

  // Sets this device has never seen: adopt them under their own id.
  for (const set of remote.values()) {
    if (ownerOf.has(set.id)) continue;
    result.set(set.id, { name: set.name, keys: [...set.keys], remoteId: set.id, syncedKeys: [...set.keys] });
  }

  const lists = {};
  for (const [id] of entries) if (result.has(id)) lists[id] = result.get(id);
  for (const [id, list] of result) if (!(id in lists)) lists[id] = list;
  return { lists, createSets, addBookmarks, deleteBookmarks };
}

/**
 * The lists to save when a sync finishes. A sync works from `snapshot` (taken
 * before its requests) and the person can keep saving questions while they
 * run, so `current` (storage read again at the end) can hold changes the sync
 * never saw. Per list id, keys added or removed since the snapshot, and lists
 * created since it, are laid over `merged`. syncedKeys is left alone, so the
 * next run sees them as unsynced and sends them. A list the merge dropped
 * stays dropped.
 */
export function settleLists(snapshot, current, merged) {
  const lists = {};
  for (const [id, m] of Object.entries(merged)) lists[id] = { ...m, keys: [...m.keys] };
  for (const [id, now] of Object.entries(current)) {
    const before = snapshot[id];
    if (!before) {
      if (!(id in lists)) lists[id] = now; // created during the run
      continue;
    }
    const target = lists[id];
    if (!target) continue;
    const removed = new Set(before.keys.filter((k) => !now.keys.includes(k)));
    const added = now.keys.filter((k) => !before.keys.includes(k));
    target.keys = target.keys.filter((k) => !removed.has(k));
    for (const k of added) if (!target.keys.includes(k)) target.keys.push(k);
  }
  return lists;
}
