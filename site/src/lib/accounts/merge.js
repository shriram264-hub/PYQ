import { isOp, markAllSynced } from './progress-store.js';

/**
 * Merge this device's marks with the account's. For a question on both sides
 * the later edit wins; on an exact tie the account's copy stays. A local mark
 * the account lacks is new (upload it) unless it was synced before, which
 * means another device cleared it (drop it). A mark cleared on this device
 * (a pending delete) beats an older account copy and loses to a newer one.
 */
export function mergeProgress(local, remoteRows, pending = []) {
  const clearedAt = new Map(pending.filter((op) => op.type === 'delete').map((op) => [op.key, op.at]));
  const entries = {};
  const toDelete = [];
  for (const r of remoteRows) {
    const cleared = clearedAt.get(r.question_key);
    if (cleared && Date.parse(cleared) > Date.parse(r.updated_at)) {
      toDelete.push({ question_key: r.question_key, cleared_at: cleared });
      continue;
    }
    entries[r.question_key] = { status: r.status, updatedAt: r.updated_at, synced: true };
  }
  const toUpload = [];
  for (const [key, mine] of Object.entries(local)) {
    const theirs = entries[key];
    if (!theirs) {
      if (mine.synced) continue;
    } else if (Date.parse(mine.updatedAt) <= Date.parse(theirs.updatedAt)) {
      continue;
    }
    entries[key] = mine;
    toUpload.push({ question_key: key, status: mine.status, updated_at: mine.updatedAt });
  }
  return { entries, toUpload, toDelete };
}

/**
 * This device's state, made ready for an account other than the one it last
 * synced with: on a shared browser A signs out and B signs in. Signing out
 * leaves A's copy here, and merged as it stands it would be taken for B's own
 * work: A's newer marks would overwrite B's, A's queued clears would delete
 * B's rows. So what came from or was meant for A's account goes: marks A's
 * account confirmed (synced), clears queued for it, and lists tied to its sets.
 * What was done here and never synced stays, marks and their queued upserts
 * and lists not yet uploaded, and joins the account signing in: nothing done
 * before signing in is discarded (spec, "Progress without an account").
 */
export function rebaseForNewAccount(state) {
  const entries = Object.fromEntries(Object.entries(state.entries).filter(([, e]) => !e.synced));
  const pending = state.pending.filter((op) => op.type === 'upsert');
  const lists = Object.fromEntries(Object.entries(state.lists).filter(([, l]) => l.remoteId === null));
  return { ...state, entries, pending, lists };
}

const opId = (op) => JSON.stringify([op.key, op.at]);

/**
 * The state to save when a sync finishes. A sync works from a snapshot taken
 * before its network calls, and the person can keep marking while they run, so
 * `current` (storage read again at the end) can hold ops the sync never saw.
 * Those "fresh" ops (same key and same time = same op) stay pending, and their
 * local entries are kept exactly as `current` has them, unsynced. Everything
 * else takes the merged result and counts as synced. The snapshot's own ops are
 * cleared, including ones that lost to a newer account row: re-sending them
 * would only lose again.
 *
 * `merged` is mergeProgress's `entries`. With `scopeKeys` null the merge covered
 * every entry, so it replaces them all. With a list of keys (a targeted sync
 * that pulled only those questions) it replaces just those; every other entry,
 * synced flag included, stays as `current` has it.
 */
export function settleSync(snapshot, current, merged, scopeKeys = null) {
  const sent = new Set(snapshot.pending.filter(isOp).map(opId));
  const fresh = current.pending.filter((op) => isOp(op) && !sent.has(opId(op)));
  let entries;
  if (scopeKeys === null) {
    entries = markAllSynced(merged);
  } else {
    entries = { ...current.entries };
    for (const key of scopeKeys) {
      if (merged[key]) entries[key] = { ...merged[key], synced: true };
      else delete entries[key];
    }
  }
  for (const op of fresh) {
    const mine = current.entries[op.key];
    if (op.type === 'delete') delete entries[op.key];
    else if (mine) entries[op.key] = mine;
  }
  return { ...current, entries, pending: fresh };
}
