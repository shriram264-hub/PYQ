import { COUNTS, MAX_MINUTES, MIN_MINUTES } from './attempt.js';
import { defaultMinutes } from './build.js';

// The practice-set form's rules, apart from its DOM (scripts/practice-form.js).

const isPair = (p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'string');

function pairOf(value) {
  try {
    const p = JSON.parse(value);
    return isPair(p) ? [p[0], p[1]] : null;
  } catch {
    return null;
  }
}

/**
 * The form's values, as read from it (strings and booleans), as a set's spec.
 * A ticked topic brings its subject, so a spec's topics always lie inside its
 * subjects (parseAttempt keeps only those). Out-of-range numbers are brought in
 * range rather than refused: the form's own limits should already have stopped them.
 */
export function readSpec(values, seed) {
  const topics = values.topics.map(pairOf).filter(Boolean);
  const subjects = [...new Set([...values.subjects, ...topics.map(([s]) => s)])];
  let fromYear = Number(values.fromYear);
  let toYear = Number(values.toYear);
  if (fromYear > toYear) [fromYear, toYear] = [toYear, fromYear];
  const count = COUNTS.includes(Number(values.count)) ? Number(values.count) : 25;
  const typed = Math.round(Number(values.minutes));
  const minutes = values.minutes !== '' && Number.isFinite(typed) && typed > 0
    ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, typed))
    : defaultMinutes(count);
  return {
    subjects,
    topics,
    fromYear,
    toYear,
    count,
    minutes,
    skipDone: Boolean(values.skipDone),
    onlyReview: Boolean(values.onlyReview),
    seed,
  };
}

/** The line under the form (spec: a small pool is used whole "and the page says so"). */
export function poolMessage(poolSize, count) {
  if (poolSize === 0) return 'No questions match. Widen the filters.';
  if (poolSize === 1 && count > 1) return 'Only 1 question matches: the set will have just that one.';
  if (poolSize < count) return `Only ${poolSize} questions match: the set will have all ${poolSize}.`;
  return `${poolSize} questions match. The set will have ${count}.`;
}

const SLUG = /^[a-z0-9-]+$/;

/** What a Practise link asks the form to tick: a subject slug, and a topic slug within it. */
export function preselection(search) {
  const params = new URLSearchParams(search);
  const subject = params.get('subject');
  if (!subject || !SLUG.test(subject)) return { subject: null, topic: null };
  const topic = params.get('topic');
  return { subject, topic: topic && SLUG.test(topic) ? topic : null };
}
