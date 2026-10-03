// What the progress sync (scripts/sync.js) and the lists sync
// (scripts/sync-lists.js) share when they read the account: paging, and the
// "pulled everything recently" marker. Each sync keeps its own marker.

// Supabase returns at most 1,000 rows per request by default. A full pull that
// stopped at the first page would look like "the account lacks these rows",
// and the merge would then drop this device's synced copies of them.
export const PAGE_ROWS = 1000;

// The audience is on mobile data, so a full pull of every row is the exception:
// once per 10 minutes at most. In between, a run asks only about what this
// device changed.
export const FULL_PULL_EVERY_MS = 10 * 60 * 1000;

// Every row of a table, in pages. `orderBy` must be a total order (the primary
// key), or rows can repeat or go missing between pages.
export async function pullPages(client, table, columns, orderBy) {
  const rows = [];
  // Continue from what actually came back and stop on an empty page, not a
  // short one: the project's row cap can be lower than PAGE_ROWS, and trusting
  // the page size would then skip rows or end the pull early.
  for (;;) {
    let query = client.from(table).select(columns);
    for (const column of orderBy) query = query.order(column);
    const { data, error } = await query.range(rows.length, rows.length + PAGE_ROWS - 1);
    if (error) throw error;
    if (!data.length) return rows;
    rows.push(...data);
  }
}

/**
 * The id of the account whose data this browser holds. Kept on purpose when
 * that account signs out, unlike the pull markers: it is how the next run
 * tells that a different account has signed in here, and that the synced copy
 * and queued changes on this device belong to someone else (see
 * rebaseForNewAccount in merge.js). An account claims it at the start of its
 * first run (claimDevice in scripts/sync.js), and both syncs write it again
 * after a step succeeds.
 */
export const OWNER_KEY = 'sawaalbox-owner-v1';

export const deviceOwner = {
  read() {
    try {
      return globalThis.localStorage.getItem(OWNER_KEY);
    } catch {
      return null; // blocked storage holds no copy of anyone's to protect
    }
  },
  remember(userId) {
    try {
      globalThis.localStorage.setItem(OWNER_KEY, userId);
    } catch {
      /* the next run looks for an owner again */
    }
  },
};

/**
 * A marker in localStorage, `{ user, at }`, saying "this device pulled all of
 * this table for this user at that time". It is separate per sync on purpose:
 * one sync failing must never make the other pull everything again.
 */
export function pullMarker(storageKey) {
  return {
    recent(userId, now) {
      try {
        const marker = JSON.parse(globalThis.localStorage.getItem(storageKey));
        const age = now - Date.parse(marker.at);
        // A time in the future (clock changed) is not recent: it would never expire.
        return marker.user === userId && age >= 0 && age < FULL_PULL_EVERY_MS;
      } catch {
        // Nothing stored, unreadable, or storage blocked: we cannot prove a recent pull.
        return false;
      }
    },
    remember(userId, at) {
      try {
        globalThis.localStorage.setItem(storageKey, JSON.stringify({ user: userId, at: new Date(at).toISOString() }));
      } catch {
        /* without the marker the next run just pulls everything again */
      }
    },
    forget() {
      try {
        globalThis.localStorage.removeItem(storageKey);
      } catch {
        /* blocked storage holds no marker */
      }
    },
  };
}
