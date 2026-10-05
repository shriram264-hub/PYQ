// Revision lists. A list is { name, keys, remoteId, syncedKeys, syncedName }:
//   keys        the questions in it, on this device
//   remoteId    the account's bookmark_sets.id once it has one, else null
//   syncedKeys  the keys the account held for it at the last sync (the "base")
//   syncedName  the name the account held for it at the last sync, null until
//               it has been synced. `name` differing from it is a rename made
//               here that the account has not heard of yet, the same way keys
//               differing from syncedKeys are additions and removals.
// The local id (the key in state.lists) never changes after creation; remoteId
// is a separate field so ids held by an open panel stay valid across a sync.
//
// A list deleted here that the account has a set for leaves a tombstone, its
// remote id in state.deletedLists, until a sync has deleted the set. Without
// it the next pull would find the set and adopt it as a list nobody made.
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

// Names are the same when they differ only in capitals or surrounding space:
// "Test" and "test" would read as one list to a student, and the merge joins a
// list to an account set by name, so it must not tell them apart either.
const nameKey = (name) => String(name).trim().toLowerCase();

export const sameName = (a, b) => nameKey(a) === nameKey(b);

/** The first list called `name` (ignoring capitals), other than `exceptId`: { id, list } or null. */
export function findByName(lists, name, exceptId) {
  for (const [id, list] of Object.entries(lists)) {
    if (id !== exceptId && sameName(list.name, name)) return { id, list };
  }
  return null;
}

// The account allows one list per name; a second would fail every sync. The
// message quotes the existing list's own spelling, so "test" is answered with
// the "Test" the student can see.
function refuseTakenName(lists, name, exceptId) {
  const existing = findByName(lists, name, exceptId);
  if (existing) throw new Error(`You already have a list called "${existing.list.name}".`);
}

export function createList(state, name, id) {
  const clean = cleanName(name);
  refuseTakenName(state.lists, clean);
  return {
    ...state,
    lists: { ...state.lists, [id]: { name: clean, keys: [], remoteId: null, syncedKeys: [], syncedName: null } },
  };
}

/**
 * Gives a list a new name. Only `name` changes: syncedName stays what the
 * account last held, so the list reads as dirty and the next sync writes the
 * rename. Returns the same state object for a list that is gone or a name that
 * is already its own, so a caller can tell nothing changed. Capitals alone are
 * a real change ("maps" to "Maps"), and a list never collides with itself.
 */
export function renameList(state, listId, name) {
  const list = state.lists[listId];
  if (!list) return state;
  const clean = cleanName(name);
  if (clean === list.name) return state;
  refuseTakenName(state.lists, clean, listId);
  return { ...state, lists: { ...state.lists, [listId]: { ...list, name: clean } } };
}

/**
 * Removes a list. One the account has a set for also leaves a tombstone (the
 * set's id in deletedLists), because merging would otherwise adopt the set
 * straight back; a list never uploaded has nothing on the account to delete.
 * Returns the same state object when the list is already gone.
 */
export function deleteList(state, listId) {
  const list = state.lists[listId];
  if (!list) return state;
  const lists = { ...state.lists };
  delete lists[listId];
  const tombstones = state.deletedLists ?? [];
  const owed = typeof list.remoteId === 'string' && !tombstones.includes(list.remoteId);
  return { ...state, lists, deletedLists: owed ? [...tombstones, list.remoteId] : tombstones };
}

export function toggleKey(state, listId, key) {
  const list = state.lists[listId];
  // The list may have gone since the panel drew it (a sync dropped it).
  if (!list) return { state, added: false };
  const added = !list.keys.includes(key);
  const keys = added ? [...list.keys, key] : list.keys.filter((k) => k !== key);
  return { state: { ...state, lists: { ...state.lists, [listId]: { ...list, keys } } }, added };
}

/**
 * Takes a question out of a list, and nothing else: returns the same state
 * object when the list or the key is already gone. Used where the person asked
 * for it to be gone (the account page's Remove): toggleKey would put the key
 * back if another tab had removed it since the page was drawn.
 */
export function removeKey(state, listId, key) {
  const list = state.lists[listId];
  if (!list || !list.keys.includes(key)) return state;
  const keys = list.keys.filter((k) => k !== key);
  return { ...state, lists: { ...state.lists, [listId]: { ...list, keys } } };
}

const sameSet = (a, b) => a.length === b.length && a.every((k) => b.includes(k));

/**
 * A list the account may not match yet: never uploaded, keys changed since the
 * last sync, or renamed since. Comparing names exactly (not with sameName) is
 * deliberate: a change of capitals is a rename the account has to be told.
 */
export const isDirty = (list) =>
  list.remoteId === null || !sameSet(list.keys, list.syncedKeys) || list.name !== list.syncedName;

// A list renamed here since the last sync. A null syncedName is a list that has
// never heard the account's name (or one saved before names were tracked), so
// there is nothing to say was changed: it takes the account's name instead.
const renamedHere = (list) => typeof list.syncedName === 'string' && list.name !== list.syncedName;

export function listsEqual(a, b) {
  const ids = Object.keys(a);
  if (ids.length !== Object.keys(b).length) return false;
  return ids.every((id) => {
    const x = a[id];
    const y = b[id];
    return (
      Boolean(y) &&
      x.name === y.name &&
      x.syncedName === y.syncedName &&
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
 * `remoteBookmarks` is [{ set_id, question_key }], `deletedLists` the tombstones:
 * remote ids of sets deleted here.
 *
 * Returns the lists as they will be once the writes below succeed, and the
 * writes: sets to create ({ listId, name }), sets to rename ({ listId, name },
 * the new name), sets to delete (remote ids), bookmarks to add and to delete
 * ({ listId, key }). A created list has remoteId null in `lists` until its set
 * exists; the caller fills it in. Nothing here touches the network or storage.
 * The caller should delete before it renames and renames before it creates: a
 * list can take the name a deleted or renamed one had, and the account refuses
 * two sets of one name.
 *
 *  - A tombstoned set is never merged or adopted, and a list tied to it is
 *    dropped: it is what the person deleted. Only those the account still has
 *    are returned in `deleteSets`.
 *  - A list with a remoteId is three-way merged with that set, or dropped if
 *    the set is gone (deleted on another device, or another account's). Its
 *    name is the account's, unless it was renamed here since the last sync
 *    (name differs from syncedName): then the rename is written and wins, even
 *    over a different rename made on another device, unless the account would
 *    refuse it because another set will hold that exact name: then the list
 *    keeps the account's name and nothing is written.
 *  - A list with no remoteId joins the account's set of the same name (ignoring
 *    capitals, the exact spelling first), else its set is created. All its
 *    keys are additions, so this is a union: nothing a student saved before
 *    signing in is discarded.
 *  - A set no local list maps to is adopted, under its own id.
 *
 * syncedName comes out as the name the account will hold once the writes land.
 * `foldedInto` says which local lists were merged into another ({ folded id:
 * owner id }) and so are not in `lists`: settleLists needs it to carry keys
 * saved to a folded list during the run.
 */
export function mergeLists(localLists, remoteSets, remoteBookmarks, deletedLists = []) {
  const tombstoned = new Set(deletedLists);
  const deleteSets = [...tombstoned].filter((id) => remoteSets.some((s) => s.id === id));
  const liveSets = remoteSets.filter((s) => !tombstoned.has(s.id));

  // Keys go through a Set: paging by offset can return a row twice when rows
  // arrive between pages, and a list must never hold a key twice.
  const remote = new Map(liveSets.map((s) => [s.id, { ...s, keys: new Set() }]));
  for (const b of remoteBookmarks) remote.get(b.set_id)?.keys.add(b.question_key);
  for (const set of remote.values()) set.keys = [...set.keys];
  // What each set will be called once this run's renames are written, in the
  // account's order. A list without a set matches against these, not the names
  // the account holds now: "Polity" renamed to "Polity 2" frees "Polity" for a
  // new list, which must not be folded into the renamed one.
  const nameOf = new Map(liveSets.map((s) => [s.id, s.name]));
  const setIdForName = (name) => {
    let loose;
    for (const [id, n] of nameOf) {
      if (n === name) return id;
      if (loose === undefined && sameName(n, name)) loose = id;
    }
    return loose;
  };

  const result = new Map(); // local id -> merged list
  const createSets = [];
  const renameSets = [];
  const addBookmarks = [];
  const deleteBookmarks = [];
  const ownerOf = new Map(); // remote id -> local id that merged with it
  const creating = new Map(); // name key -> local id whose set will be created

  const entries = Object.entries(localLists);
  const finish = (id, { name, keys, remoteId }, { upload = [], remove = [] } = {}) => {
    // The name this device now knows the account holds: the account's own, or
    // the one about to be written to it. Either way the next run has no rename to send.
    result.set(id, { name, keys, remoteId, syncedKeys: [...keys], syncedName: name });
    for (const key of upload) addBookmarks.push({ listId: id, key });
    for (const key of remove) deleteBookmarks.push({ listId: id, key });
  };

  // Lists that know their set go first, so a list without one that shares its
  // name folds into them rather than racing for the set.
  const known = []; // lists that know their set, finished once their names are settled
  for (const [id, l] of entries) {
    const set = l.remoteId && remote.get(l.remoteId);
    if (!set || ownerOf.has(set.id)) continue; // set gone: the list was deleted elsewhere
    ownerOf.set(set.id, id);
    const name = renamedHere(l) ? l.name : set.name;
    known.push({ id, set, name, m: mergeKeys(l, set.keys) });
    nameOf.set(set.id, name);
  }

  // A rename onto a name another set will already hold is one the account
  // refuses (it keeps one set per name), so it is dropped here, and the list
  // takes the account's name: left in, the refusal would send the list back to
  // its old name, where a new list made under that name would collide with it
  // on every run. A set's name counts as what it will be once this run's
  // renames land, and a dropped rename puts the old name back, which can block
  // another rename in turn, so this repeats until nothing changes.
  for (let again = true; again; ) {
    again = false;
    for (const k of known) {
      if (k.name === k.set.name) continue;
      for (const [setId, name] of nameOf) {
        if (setId === k.set.id || name !== k.name) continue;
        k.name = k.set.name;
        nameOf.set(k.set.id, k.name);
        again = true;
        break;
      }
    }
  }

  for (const { id, set, name, m } of known) {
    if (name !== set.name) renameSets.push({ listId: id, name });
    finish(id, { name, keys: m.keys, remoteId: set.id }, m);
  }

  const foldedInto = {}; // local id -> the local id it was merged into
  for (const [id, l] of entries) {
    if (l.remoteId) continue;
    const setId = setIdForName(l.name);
    const owner = setId === undefined ? creating.get(nameKey(l.name)) : ownerOf.get(setId);
    if (owner !== undefined) {
      // Another list here already stands for this set (two tabs creating one
      // name at once): fold this one in, or the account would be asked for the
      // same name twice and refuse every sync.
      foldedInto[id] = owner;
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
      creating.set(nameKey(l.name), id);
      createSets.push({ listId: id, name: l.name });
      finish(id, { name: l.name, keys: [...l.keys], remoteId: null }, { upload: l.keys });
    } else {
      // The account already has a list of this name: every local key is an
      // addition (the base is empty), so the result is the union. The list
      // takes the account's spelling of the name.
      ownerOf.set(setId, id);
      const set = remote.get(setId);
      const m = mergeKeys({ ...l, syncedKeys: [] }, set.keys);
      finish(id, { name: set.name, keys: m.keys, remoteId: setId }, m);
    }
  }

  // Sets this device has never seen: adopt them under their own id.
  for (const set of remote.values()) {
    if (ownerOf.has(set.id)) continue;
    result.set(set.id, {
      name: set.name,
      keys: [...set.keys],
      remoteId: set.id,
      syncedKeys: [...set.keys],
      syncedName: set.name,
    });
  }

  const lists = {};
  for (const [id] of entries) if (result.has(id)) lists[id] = result.get(id);
  for (const [id, list] of result) if (!(id in lists)) lists[id] = list;
  return { lists, createSets, addBookmarks, deleteBookmarks, renameSets, deleteSets, foldedInto };
}

/**
 * The lists to save when a sync finishes. A sync works from `snapshot` (taken
 * before its requests) and the person can keep saving questions while they
 * run, so `current` (storage read again at the end) can hold changes the sync
 * never saw. Per list id, keys added or removed since the snapshot, a rename
 * since it, and lists created since it, are laid over `merged`; a list that is
 * in the snapshot but gone from `current` was deleted during the run, and
 * stays gone. syncedKeys and syncedName are left as merged, so the next run
 * sees the changes as unsynced and sends them. A list the merge dropped stays
 * dropped.
 *
 * `foldedInto` is mergeLists's: a list folded into another has no entry in
 * `merged`, but the person may have saved a question to it during the run, so
 * keys added to it since the snapshot are added to the list it was folded into.
 * Its other changes (a removal, a rename) are not carried: the key may have
 * come from the other list too, and the name is gone with the list. Optional,
 * for callers that have nothing folded.
 */
export function settleLists(snapshot, current, merged, foldedInto = {}) {
  const lists = {};
  for (const [id, m] of Object.entries(merged)) lists[id] = { ...m, keys: [...m.keys] };
  // Only a list the run started from can have been deleted during it: one the
  // merge adopted (an account set this device had not seen) was never in storage.
  for (const id of Object.keys(snapshot)) if (!(id in current)) delete lists[id];
  for (const [id, now] of Object.entries(current)) {
    const before = snapshot[id];
    if (!before) {
      if (!(id in lists)) lists[id] = now; // created during the run
      continue;
    }
    if (Object.hasOwn(foldedInto, id)) {
      const owner = lists[foldedInto[id]];
      if (owner) {
        for (const k of now.keys) if (!before.keys.includes(k) && !owner.keys.includes(k)) owner.keys.push(k);
      }
      continue;
    }
    const target = lists[id];
    if (!target) continue;
    const removed = new Set(before.keys.filter((k) => !now.keys.includes(k)));
    const added = now.keys.filter((k) => !before.keys.includes(k));
    target.keys = target.keys.filter((k) => !removed.has(k));
    for (const k of added) if (!target.keys.includes(k)) target.keys.push(k);
    // Compared with the snapshot, not with `merged`: the merge may have taken a
    // rename from another device, and that is not one made during the run.
    if (now.name !== before.name) target.name = now.name;
  }
  return lists;
}

/**
 * The tombstones to save when a sync finishes. `snapshotIds` are the ones the
 * run started from and handled (the sets deleted, or already gone); `currentIds`
 * is storage read again at the end, which can hold tombstones for lists deleted
 * during the run. Those stay, for the next run.
 */
export function settleTombstones(snapshotIds, currentIds) {
  const handled = new Set(snapshotIds);
  return currentIds.filter((id) => !handled.has(id));
}
