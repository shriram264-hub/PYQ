// Progress lives on the device first. Signed out, this is all there is; signed
// in, it is a cache of the account that renders instantly and survives offline.
export const STORAGE_KEY = 'sawaalbox-progress-v1';

export function emptyState() {
  return { entries: {}, pending: [], lists: {} };
}

export function parseState(raw) {
  try {
    const s = JSON.parse(raw);
    if (!s || typeof s !== 'object') return emptyState();

    // Validate and coerce entries
    const entries = {};
    if (s.entries && typeof s.entries === 'object' && !Array.isArray(s.entries)) {
      for (const [k, v] of Object.entries(s.entries)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) {
          const status = v.status;
          const updatedAt = v.updatedAt;
          if ((status === 'done' || status === 'review') && updatedAt && Date.parse(updatedAt)) {
            entries[k] = { status, updatedAt, synced: Boolean(v.synced) };
          }
        }
      }
    }

    // Validate and coerce pending
    let pending = [];
    if (Array.isArray(s.pending)) {
      pending = s.pending;
    }

    // Validate and coerce lists
    const lists = {};
    if (s.lists && typeof s.lists === 'object' && !Array.isArray(s.lists)) {
      Object.assign(lists, s.lists);
    }

    return { entries, pending, lists };
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

export function saveState(state, storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    s.setItem(STORAGE_KEY, JSON.stringify(state));
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
