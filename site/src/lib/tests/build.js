import { fullEntry, parseKey } from '../accounts/summary.js';
import { MAX_MINUTES, MIN_MINUTES } from './attempt.js';
import { FLAG } from './catalogue.js';

// Which questions a test is made of. Pure: the year files, the catalogue and
// the marks come in as arguments.

/**
 * A full paper (spec, "Sit a past paper"): every question of the year in its
 * full file except those UPSC cancelled, in question-number order. Only entries
 * fullEntry accepts, filed under this year, are taken.
 */
export function paperKeys(year, fullFile) {
  return Object.keys(fullFile ?? {})
    .filter((key) => parseKey(key)?.year === year)
    .map((key) => ({ key, entry: fullEntry(fullFile, key) }))
    .filter(({ entry }) => entry.status === 'ok' && entry.q.status !== 'cancelled')
    .sort((a, b) => a.entry.q.q_no - b.entry.q.q_no)
    .map(({ key }) => key);
}

/** Build time: what the papers list says about one year, from that year's corpus questions. */
export function paperInfo(year, questions) {
  const numbers = new Set(questions.map((q) => q.q_no));
  const highest = Math.max(...numbers);
  const cancelled = questions.filter((q) => q.status === 'cancelled').length;
  return { year, present: numbers.size, highest, missing: highest - numbers.size, cancelled, questions: questions.length - cancelled };
}

export function paperNotes({ present, highest, missing, cancelled }) {
  const notes = [];
  if (missing > 0) notes.push(`${present} of ${highest} questions: ${missing} ${missing === 1 ? "isn't" : "aren't"} in our copy`);
  if (cancelled > 0) {
    notes.push(`${cancelled} ${cancelled === 1 ? 'question' : 'questions'} cancelled by UPSC ${cancelled === 1 ? 'is' : 'are'} left out`);
  }
  return notes;
}

/**
 * A practice set's pool (spec, "Picking questions"): the catalogue entries
 * matching the filters, minus questions that cannot be scored and those the
 * switches exclude, in catalogue order (year, then number), so a seed always
 * draws from the same sequence. `entries` is the progress marks,
 * { [key]: { status: 'done'|'review' } }. No subjects means every subject; a
 * subject with topics chosen is narrowed to those topics.
 */
export function setPool(spec, catalogue, entries) {
  const subjects = new Set(spec.subjects);
  const topics = new Map();
  for (const [s, t] of spec.topics) topics.set(s, (topics.get(s) ?? new Set()).add(t));
  return catalogue.entries
    .filter((e) => {
      if (e.flag === FLAG.cancelled || e.flag === FLAG.unanswered) return false;
      if (e.year < spec.fromYear || e.year > spec.toYear) return false;
      if (subjects.size && !subjects.has(e.subject)) return false;
      if (topics.has(e.subject) && !topics.get(e.subject).has(e.topic)) return false;
      const mark = Object.hasOwn(entries, e.key) ? entries[e.key].status : null;
      if (spec.onlyReview && mark !== 'review') return false;
      if (spec.skipDone && mark === 'done') return false;
      return true;
    })
    .map((e) => e.key);
}

/** A small, well-mixed generator: the same seed gives the same draw on every device. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}

/** `count` keys from the pool, uniformly, without repeats (a partial Fisher–Yates on a copy). */
export function drawSet(pool, count, seed) {
  const random = mulberry32(seed);
  const keys = [...pool];
  const n = Math.min(count, keys.length);
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(random() * (keys.length - i));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, n);
}

/** ceil(1.2 × n) minutes, in whole numbers (6n/5), kept between 5 and 180. */
export const defaultMinutes = (n) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.ceil((6 * n) / 5)));
