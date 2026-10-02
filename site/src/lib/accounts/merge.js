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
