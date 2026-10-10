import { OPTIONS } from './attempt.js';

// The test screen's clock and keys, as plain functions (scripts/take-page.js
// does the DOM). Each tick adds at most TICK_CAP_MS: a laptop that sleeps with
// the page in front does not come back to an hour gone. Elapsed time is saved
// at least every SAVE_EVERY_MS while the clock runs (spec, "Saving").
export const TICK_CAP_MS = 5000;
export const SAVE_EVERY_MS = 5000;

const pad = (n) => String(n).padStart(2, '0');

/** h:mm:ss, rounded up, so it reads 0:00:00 only when time is actually up. */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// Nearest first, so a jump past several marks says the one now true.
const MARKS_MIN = [1, 5, 15];

/** What to tell a screen reader as remaining time goes from `before` to `after`, or null. */
export function announcementFor(before, after) {
  for (const minutes of MARKS_MIN) {
    const mark = minutes * 60000;
    if (before > mark && after <= mark) return minutes === 1 ? '1 minute left' : `${minutes} minutes left`;
  }
  return null;
}

/** A key's meaning on the test screen: { choose: 'a'..'d' } | { move: -1 | 1 } | null. */
export function keyAction(key) {
  const k = String(key);
  const letter = OPTIONS.indexOf(k.toLowerCase());
  if (k.length === 1 && letter >= 0) return { choose: OPTIONS[letter] };
  const digit = ['1', '2', '3', '4'].indexOf(k);
  if (digit >= 0) return { choose: OPTIONS[digit] };
  if (k === 'ArrowLeft') return { move: -1 };
  if (k === 'ArrowRight') return { move: 1 };
  return null;
}
