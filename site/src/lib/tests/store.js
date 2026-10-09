import { attemptName, parseAttempt } from './attempt.js';
import { formatDate, formatScore } from './score.js';

// The device's attempts, under their own key, apart from marks and lists
// (sawaalbox-progress-v1). Signed out, this is all there is; signed in, it is
// a cache of the account that works offline. Shape: { attempts: { [id]: attempt } }.
export const TESTS_KEY = 'sawaalbox-tests-v1';

// The device keeps this many, the most recently updated; older ones stay in
// the account (spec, "Attempt record").
export const MAX_ATTEMPTS = 200;

export const emptyTests = () => ({ attempts: {} });

export function parseTests(raw) {
  try {
    const s = JSON.parse(raw);
    const attempts = {};
    if (s && typeof s === 'object' && s.attempts && typeof s.attempts === 'object' && !Array.isArray(s.attempts)) {
      for (const [id, value] of Object.entries(s.attempts)) {
        const a = parseAttempt(value);
        // Filed under its own id, or not at all: the id is what sync matches on.
        if (a && a.id === id) attempts[id] = a;
      }
    }
    return { attempts };
  } catch {
    return emptyTests();
  }
}

export function loadTests(storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    return parseTests(s.getItem(TESTS_KEY));
  } catch {
    return emptyTests();
  }
}

const newestFirst = (field) => (x, y) => Date.parse(y[field]) - Date.parse(x[field]) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

export function pruneAttempts(attempts, max = MAX_ATTEMPTS) {
  const all = Object.values(attempts);
  if (all.length <= max) return attempts;
  return Object.fromEntries(all.sort(newestFirst('updatedAt')).slice(0, max).map((a) => [a.id, a]));
}

// True when written, false when storage refused (blocked, private mode, full).
// Never throws: the caller holds the attempt in memory and says it is not saved.
export function saveTests(tests, storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    s.setItem(TESTS_KEY, JSON.stringify({ attempts: pruneAttempts(tests.attempts) }));
    return true;
  } catch {
    return false;
  }
}

export const putAttempt = (tests, a) => ({ ...tests, attempts: { ...tests.attempts, [a.id]: a } });

export const getAttempt = (tests, id) => (Object.hasOwn(tests.attempts, id) ? tests.attempts[id] : null);

/** Carry on: unfinished attempts, the one touched last first. */
export const unfinished = (tests) =>
  Object.values(tests.attempts)
    .filter((a) => a.status === 'in_progress')
    .sort(newestFirst('updatedAt'));

/** Past results: submitted attempts, the newest submission first. Abandoned ones never count. */
export const finished = (tests) =>
  Object.values(tests.attempts)
    .filter((a) => a.status === 'submitted')
    .sort(newestFirst('submittedAt'));

export const inProgressPaper = (tests, year) =>
  unfinished(tests).find((a) => a.kind === 'paper' && a.spec.year === year) ?? null;

/** The line /account shows under Practice tests. */
export function latestLine(tests) {
  const [latest] = finished(tests);
  if (!latest) return 'No tests taken yet.';
  return `Latest: ${attemptName(latest)}, ${formatScore(latest.result.score)} / ${latest.result.max}, on ${formatDate(latest.submittedAt)}.`;
}
