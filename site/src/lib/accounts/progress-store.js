// Progress lives on the device first. Signed out, this is all there is; signed
// in, it is a cache of the account that renders instantly and survives offline.
export const STORAGE_KEY = 'sawaalbox-progress-v1';

export function emptyState() {
  return { entries: {}, pending: [], lists: {} };
}

export function parseState(raw) {
  try {
    const s = JSON.parse(raw);
    if (s && typeof s.entries === 'object' && Array.isArray(s.pending)) {
      return { ...emptyState(), ...s };
    }
  } catch {
    /* fall through to a clean state */
  }
  return emptyState();
}

export function loadState(storage = globalThis.localStorage) {
  try {
    return parseState(storage.getItem(STORAGE_KEY));
  } catch {
    return emptyState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* private mode or full storage: the mark still shows for this page */
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
