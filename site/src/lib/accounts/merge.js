/**
 * Merge this device's marks with the account's. For a question on both sides
 * the later edit wins; on an exact tie the account's copy stays. A local mark
 * the account lacks is new (upload it) unless it was synced before, which
 * means another device cleared it (drop it).
 */
export function mergeProgress(local, remoteRows) {
  const entries = {};
  for (const r of remoteRows) {
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
  return { entries, toUpload };
}
