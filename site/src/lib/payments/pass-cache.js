import { istDate, paywallStart } from './switch.js';

// What this device last heard about the signed-in student's passes. It is a
// cache of the `passes` table (refreshed by scripts/pass-state.js on every sync),
// so the pages can decide at once, offline, without waiting for the network.
// The server stays the authority: the cache only ever shows what an
// RLS-protected select returned for this user. Shape:
//   { userId, mode: 'test' | 'live', passes: [{ exam, validUntil: 'YYYY-MM-DD' }] }
export const PASS_KEY = 'sawaalbox-pass-v1';

const MODES = ['test', 'live'];

// A real calendar date, not just the right shape: paywallStart rejects 2027-13-40.
const isDay = (s) => typeof s === 'string' && !Number.isNaN(paywallStart(s));

/** The cache in `raw`, or null when it is missing or is not a well-formed cache. */
export function parsePassCache(raw) {
  try {
    const c = JSON.parse(raw);
    if (!c || typeof c !== 'object' || Array.isArray(c)) return null;
    if (typeof c.userId !== 'string' || !c.userId) return null;
    if (!MODES.includes(c.mode)) return null;
    if (!Array.isArray(c.passes)) return null;
    const passes = [];
    for (const p of c.passes) {
      if (!p || typeof p.exam !== 'string' || !p.exam || !isDay(p.validUntil)) return null;
      passes.push({ exam: p.exam, validUntil: p.validUntil });
    }
    return { userId: c.userId, mode: c.mode, passes };
  } catch {
    return null;
  }
}

/** The cached passes, or null. Never throws: storage may be blocked. */
export function loadPassCache(storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    return parsePassCache(s.getItem(PASS_KEY));
  } catch {
    return null;
  }
}

/** True when written, false when storage refused. Never throws. */
export function savePassCache(cache, storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    s.setItem(PASS_KEY, JSON.stringify(cache));
    return true;
  } catch {
    return false;
  }
}

/**
 * The pass that makes `exam` fully available to `userId` now, or null. A cache
 * belongs to one account in one mode: on a shared browser account A's pass must
 * give B nothing, and a test-mode pass must give nothing on the live site. A
 * pass lasts through its whole last day in India, so the comparison is on India
 * calendar dates ('YYYY-MM-DD' strings sort correctly as text).
 */
export function activePassFor(cache, { userId, mode, exam, now }) {
  if (!cache || !userId || cache.userId !== userId || cache.mode !== mode) return null;
  const today = istDate(now);
  return cache.passes.find((p) => p.exam === exam && p.validUntil >= today) ?? null;
}
