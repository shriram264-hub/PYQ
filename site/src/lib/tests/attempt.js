import { isQuestionKey } from '../accounts/qkey.js';

// One mock test, as this device keeps it (store.js) and the account holds it
// (merge.js maps it to a test_attempts row). Pure: no DOM, no storage. Every
// change is a function from one attempt to the next, returning the very same
// object when nothing changes, so a caller can tell "nothing to save" with ===.
// A closed attempt (submitted or abandoned) takes no further change.

export const EXAM = 'upsc';
export const MAX_KEYS = 150; // the longest UPSC paper (1995–2010) had 150 questions
export const OPTIONS = ['a', 'b', 'c', 'd'];
export const COUNTS = [10, 25, 50, 100];
export const PAPER_MINUTES = 120; // GS Paper I
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 180;
export const MINUTE = 60 * 1000;
export const STATUSES = ['in_progress', 'submitted', 'abandoned'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isOption = (v) => typeof v === 'string' && OPTIONS.includes(v);

export function newAttempt({ id, kind, spec, keys, limitMs, now }) {
  return {
    id,
    exam: EXAM,
    kind,
    spec,
    keys: [...keys],
    answers: {},
    review: [],
    current: 0,
    limitMs,
    elapsedMs: 0,
    status: 'in_progress',
    startedAt: now,
    updatedAt: now,
    submittedAt: null,
    result: null,
    syncedAt: null,
  };
}

const open = (a) => a.status === 'in_progress';
const touch = (a, changes, now) => ({ ...a, ...changes, updatedAt: now });

export function chooseAnswer(a, key, option, now) {
  if (!open(a) || !a.keys.includes(key) || !isOption(option) || a.answers[key] === option) return a;
  return touch(a, { answers: { ...a.answers, [key]: option } }, now);
}

export function clearAnswer(a, key, now) {
  if (!open(a) || !Object.hasOwn(a.answers, key)) return a;
  const answers = { ...a.answers };
  delete answers[key];
  return touch(a, { answers }, now);
}

export function toggleReview(a, key, now) {
  if (!open(a) || !a.keys.includes(key)) return a;
  const review = a.review.includes(key) ? a.review.filter((k) => k !== key) : [...a.review, key];
  return touch(a, { review }, now);
}

export function moveTo(a, index, now) {
  if (!open(a)) return a;
  const current = Math.min(Math.max(0, Math.trunc(index) || 0), a.keys.length - 1);
  return current === a.current ? a : touch(a, { current }, now);
}

export function addElapsed(a, ms, now) {
  if (!open(a) || !(ms > 0)) return a;
  return touch(a, { elapsedMs: Math.min(a.limitMs, a.elapsedMs + Math.round(ms)) }, now);
}

export const remainingMs = (a) => Math.max(0, a.limitMs - a.elapsedMs);

export function submitAttempt(a, result, now) {
  if (!open(a)) return a;
  return touch(a, { status: 'submitted', submittedAt: now, result }, now);
}

export function abandonAttempt(a, now) {
  if (!open(a)) return a;
  return touch(a, { status: 'abandoned' }, now);
}

/** What the student sees an attempt called: in Carry on, Past results and the test screen. */
export function attemptName(a) {
  if (a.kind === 'paper') return `UPSC Prelims ${a.spec.year}`;
  const { subjects, topics } = a.spec;
  if (subjects.length === 0) return 'Practice: all subjects';
  if (subjects.length > 1) return `Practice: ${subjects.length} subjects`;
  const mine = topics.filter(([s]) => s === subjects[0]);
  return mine.length === 1 ? `Practice: ${mine[0][1]}` : `Practice: ${subjects[0]}`;
}

export const progressLine = (a) => `${Object.keys(a.answers).length} of ${a.keys.length} answered`;

// --- Reading an attempt back. Storage and the account are not trusted: a bad
// shape is refused (null), a bad part inside a good shape is dropped. ---

function parseSpec(kind, s) {
  if (!isObject(s)) return null;
  if (kind === 'paper') return isInt(s.year, 1900, 2999) ? { year: s.year } : null;
  if (!Array.isArray(s.subjects) || !s.subjects.every((x) => typeof x === 'string')) return null;
  if (!Array.isArray(s.topics)) return null;
  const subjects = [...new Set(s.subjects)];
  const topics = new Map();
  for (const t of s.topics) {
    if (Array.isArray(t) && t.length === 2 && typeof t[0] === 'string' && typeof t[1] === 'string' && subjects.includes(t[0])) {
      topics.set(JSON.stringify(t), [t[0], t[1]]);
    }
  }
  if (!isInt(s.fromYear, 1900, 2999) || !isInt(s.toYear, s.fromYear, 2999)) return null;
  if (!COUNTS.includes(s.count) || !isInt(s.minutes, MIN_MINUTES, MAX_MINUTES) || !isInt(s.seed, 0, 0xffffffff)) return null;
  if (typeof s.skipDone !== 'boolean' || typeof s.onlyReview !== 'boolean') return null;
  return {
    subjects,
    topics: [...topics.values()],
    fromYear: s.fromYear,
    toYear: s.toYear,
    count: s.count,
    minutes: s.minutes,
    skipDone: s.skipDone,
    onlyReview: s.onlyReview,
    seed: s.seed,
  };
}

function parseResult(r) {
  if (!isObject(r)) return null;
  const { scored, right, wrong, blank, score, max } = r;
  if (![scored, right, wrong, blank].every((n) => isInt(n, 0, MAX_KEYS))) return null;
  if (right + wrong + blank !== scored || max !== 2 * scored) return null;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return { scored, right, wrong, blank, score, max };
}

export function parseAttempt(raw) {
  if (!isObject(raw)) return null;
  const { id, exam, kind, status } = raw;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (typeof exam !== 'string' || !/^[a-z]+$/.test(exam)) return null;
  if (kind !== 'paper' && kind !== 'custom') return null;
  if (!STATUSES.includes(status)) return null;
  const spec = parseSpec(kind, raw.spec);
  if (!spec) return null;

  const keys = raw.keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_KEYS || !keys.every(isQuestionKey)) return null;
  const inTest = new Set(keys);
  if (inTest.size !== keys.length) return null;

  const answers = {};
  if (isObject(raw.answers)) {
    for (const [k, v] of Object.entries(raw.answers)) if (inTest.has(k) && isOption(v)) answers[k] = v;
  }
  const review = Array.isArray(raw.review) ? [...new Set(raw.review.filter((k) => inTest.has(k)))] : [];

  const limitMs = raw.limitMs;
  if (!isInt(limitMs, MIN_MINUTES * MINUTE, MAX_MINUTES * MINUTE)) return null;
  if (!isInt(raw.elapsedMs, 0, Number.MAX_SAFE_INTEGER)) return null;
  const elapsedMs = Math.min(raw.elapsedMs, limitMs);
  const current = Number.isInteger(raw.current) ? Math.min(Math.max(raw.current, 0), keys.length - 1) : 0;

  if (!isIso(raw.startedAt) || !isIso(raw.updatedAt)) return null;
  const submitted = status === 'submitted';
  const result = submitted ? parseResult(raw.result) : null;
  if (submitted && (!result || !isIso(raw.submittedAt))) return null;

  return {
    id,
    exam,
    kind,
    spec,
    keys: [...keys],
    answers,
    review,
    current,
    limitMs,
    elapsedMs,
    status,
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
    submittedAt: submitted ? raw.submittedAt : null,
    result,
    syncedAt: isIso(raw.syncedAt) ? raw.syncedAt : null,
  };
}
