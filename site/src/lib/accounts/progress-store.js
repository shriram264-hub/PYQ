// lists.js and qkey.js import nothing, so this cannot form a cycle.
import { MAX_NAME } from './lists.js';
import { isQuestionKey } from './qkey.js';

// Progress lives on the device first. Signed out, this is all there is; signed
// in, it is a cache of the account that renders instantly and survives offline.
export const STORAGE_KEY = 'sawaalbox-progress-v1';

export function emptyState() {
  return { entries: {}, pending: [], lists: {}, deletedLists: [] };
}

const isStrings = (v) => Array.isArray(v) && v.every((k) => typeof k === 'string');

// syncedKeys is the base of the three-way list merge (see lists.js): the keys
// the account held at the last sync. A list saved before it existed has none.
// syncedName is the same for the name: a list saved before it existed was never
// renamed here, so a list with a set takes its name as the account's, and one
// without a set has not been synced, so null.
function parseList(l) {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const syncedKeys = l.syncedKeys === undefined ? [] : l.syncedKeys;
  const syncedName = l.syncedName === undefined ? (typeof l.remoteId === 'string' ? l.name : null) : l.syncedName;
  if (
    typeof l.name !== 'string' ||
    l.name.length < 1 ||
    l.name.length > MAX_NAME ||
    !isStrings(l.keys) ||
    !(l.remoteId === null || typeof l.remoteId === 'string') ||
    !isStrings(syncedKeys) ||
    !(syncedName === null || typeof syncedName === 'string')
  ) {
    return null;
  }
  return {
    name: l.name,
    keys: [...new Set(l.keys)],
    remoteId: l.remoteId,
    syncedKeys: [...new Set(syncedKeys)],
    syncedName,
  };
}

/** A well-formed queued op. Storage is the user's, so anything else is dropped rather than trusted. */
export function isOp(op) {
  return (
    Boolean(op) &&
    typeof op.key === 'string' &&
    typeof op.at === 'string' &&
    (op.type === 'upsert' || op.type === 'delete')
  );
}

export function parseState(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return emptyState();

    // Validate and coerce entries. A key the account would refuse is dropped
    // with its mark: kept, it would fail every upload.
    const entries = {};
    if (s.entries && typeof s.entries === 'object' && !Array.isArray(s.entries)) {
      for (const [k, v] of Object.entries(s.entries)) {
        if (isQuestionKey(k) && v && typeof v === 'object' && !Array.isArray(v)) {
          const status = v.status;
          const updatedAt = v.updatedAt;
          if ((status === 'done' || status === 'review') && updatedAt && Date.parse(updatedAt)) {
            entries[k] = { status, updatedAt, synced: Boolean(v.synced) };
          }
        }
      }
    }

    // Validate the queue the same way. One malformed op (a null) would break
    // every Mark click, because enqueue reads each op's key.
    const pending = Array.isArray(s.pending) ? s.pending.filter((op) => isOp(op) && isQuestionKey(op.key)) : [];

    // Validate lists. Storage is the user's, and a list with a bad shape would
    // make every sync throw, so such a list is dropped rather than trusted.
    const lists = {};
    if (s.lists && typeof s.lists === 'object' && !Array.isArray(s.lists)) {
      for (const [id, l] of Object.entries(s.lists)) {
        const list = parseList(l);
        if (list && id !== '__proto__') lists[id] = list;
      }
    }

    // Tombstones (see lists.js): the remote ids of sets deleted here that the
    // account may still hold. Anything that is not a string is dropped.
    const deletedLists = Array.isArray(s.deletedLists)
      ? [...new Set(s.deletedLists.filter((id) => typeof id === 'string'))]
      : [];

    return { entries, pending, lists, deletedLists };
  } catch {
    /* fall through to a clean state */
  }
  return emptyState();
}

export function loadState(storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    return parseState(s.getItem(STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

// Returns true when the state was written, false when storage refused it
// (blocked, private mode, full). It never throws: the caller decides what to do
// with a false, typically by holding the state in memory so the page still
// reflects what the person just did.
export function saveState(state, storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    s.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function setMark(state, key, status, now = new Date().toISOString()) {
  const entries = { ...state.entries };
  let op;
  if (status === null) {
    delete entries[key];
    op = { type: 'delete', key, at: now };
  } else {
    entries[key] = { status, updatedAt: now, synced: false };
    op = { type: 'upsert', key, status, at: now };
  }
  return { state: { ...state, entries }, op };
}

export function enqueue(state, op) {
  return { ...state, pending: [...state.pending.filter((p) => p.key !== op.key), op] };
}

export function dequeue(state, op) {
  return { ...state, pending: state.pending.filter((p) => !(p.key === op.key && p.at === op.at)) };
}

export function markAllSynced(entries) {
  return Object.fromEntries(Object.entries(entries).map(([k, e]) => [k, { ...e, synced: true }]));
}
