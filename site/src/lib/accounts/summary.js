// What the /account and /revise pages show, worked out from the stored state
// and the per-year question files. Pure: no DOM, storage or network, so the
// rules (which subject a mark counts under, what "needs review" means, the
// order things appear in, which entries are fit to render) are tested without
// a browser.
//
// A question key is `<exam>-<year>-<number>` (see qkey.js). The index for a
// year is `{ [key]: [path, subject, title] }` (pages/upsc/index/[year].json.js);
// the full file for a year is `{ [key]: { year, q_no, ... } }` (full/[year].json.js).

const KEY = /^([a-z][a-z0-9]*)-(\d{4})-(\d+)$/;

/** `upsc-2019-7` -> { exam: 'upsc', year: 2019, number: 7 }; null for a key this site did not make. */
export function parseKey(key) {
  const m = KEY.exec(key);
  return m ? { exam: m[1], year: Number(m[2]), number: Number(m[3]) } : null;
}

/** Where the question index holding this key lives, or null when the key names no year. */
export function indexPath(key) {
  const k = parseKey(key);
  return k ? `/${k.exam}/index/${k.year}.json` : null;
}

/**
 * Every index file the state needs: one per exam and year among the marked
 * questions and the questions in lists. A student who has marked nothing needs
 * none, so the page fetches nothing for them.
 */
export function indexPathsFor(state) {
  const keys = [...Object.keys(state.entries), ...Object.values(state.lists).flatMap((l) => l.keys)];
  const paths = new Set();
  for (const key of keys) {
    const path = indexPath(key);
    if (path) paths.add(path);
  }
  return [...paths].sort();
}

/**
 * The index files the state needs that have not settled: not asked for yet, or
 * still loading. `status` maps an index path to 'loading' | 'loaded' | 'failed'
 * (a path the page has not asked for is simply absent). Until this is empty the
 * page holds back the By subject counts, because counting before the subjects
 * have arrived would put every question in a made-up bucket.
 */
export function pendingPaths(state, status) {
  return unsettled(indexPathsFor(state), status);
}

/**
 * The same for these keys alone: what a list card waits for before it can name
 * the subjects its questions are in. A card does not wait for years that only
 * other lists need.
 */
export function pendingForKeys(keys, status) {
  return unsettled([...new Set(keys.map(indexPath).filter(Boolean))].sort(), status);
}

function unsettled(paths, status) {
  return paths.filter((path) => {
    const s = status.get(path);
    return s !== 'loaded' && s !== 'failed';
  });
}

// --- The revise page (/revise). ---

/** Where the full-question file holding this key lives (pages/upsc/full/[year].json.js), or null. */
export function fullPath(key) {
  const k = parseKey(key);
  return k ? `/${k.exam}/full/${k.year}.json` : null;
}

/**
 * The full-question files a set of keys needs: one per exam and year, each
 * once, in a stable order. The revise page fetches these and nothing else, so
 * a list of three questions from 2019 costs one small file.
 */
export function fullPathsFor(keys) {
  return [...new Set(keys.map(fullPath).filter(Boolean))].sort();
}

// The fields of a full-file entry and their types: the search API's result
// shape, which is what questionHTML takes.
const FULL_FIELDS = {
  year: 'number',
  q_no: 'number',
  subject: 'string',
  subtopic: 'string',
  difficulty: 'string',
  question: 'string',
  a: 'string',
  b: 'string',
  c: 'string',
  d: 'string',
  answer: 'string',
  answer_note: 'string',
  status: 'string',
};

/**
 * One question out of a loaded full-question file, checked before anything
 * renders it. The file is data fetched over the network and the key is the
 * user's storage, so:
 *   absent     the file does not hold the key as its own entry (the question is
 *              gone, or the key is not a question at all)
 *   malformed  it does, but not as an entry of the 13 fields with the right
 *              types, filed under its own year and number. The year and number
 *              become the block's data-qkey, which marks.js writes progress to,
 *              so an entry filed under another key would mark the wrong question.
 *   ok         `q` is a fresh object of exactly those 13 fields (anything else
 *              the entry carries is left behind).
 * questionHTML writes UPSC links and keys, so only UPSC keys are rendered.
 */
export function fullEntry(file, key) {
  const k = parseKey(key);
  if (!k || !file || typeof file !== 'object' || Array.isArray(file) || !Object.hasOwn(file, key)) {
    return { status: 'absent' };
  }
  const raw = file[key];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { status: 'malformed' };
  const q = {};
  for (const [field, type] of Object.entries(FULL_FIELDS)) {
    if (!Object.hasOwn(raw, field) || typeof raw[field] !== type) return { status: 'malformed' };
    q[field] = raw[field];
  }
  const filedHere = k.exam === 'upsc' && Number.isInteger(q.year) && q.year === k.year && q.q_no === k.number;
  return filedHere ? { status: 'ok', q } : { status: 'malformed' };
}

/**
 * What /revise was asked to open: `?review` is the Needs review pile (it wins
 * if a list is named too), `?list=<id>` a list, anything else nothing. Whether
 * the list is on this device is for the page to find out.
 */
export function reviseTarget(search) {
  const params = new URLSearchParams(search);
  if (params.has('review')) return { mode: 'review' };
  const id = params.get('list');
  return id ? { mode: 'list', id } : { mode: 'none' };
}

/** "2019 · Q7", the serial printed on the question itself; the key as stored when it is not one of ours. */
export function serialOf(key) {
  const k = parseKey(key);
  return k ? `${k.year} · Q${k.number}` : key;
}

// The index is data fetched from a file, and the keys are the user's storage:
// own properties only (a stored key of "constructor" is not a question), and an
// entry that is not shaped [path, subject, title] is not trusted. The path
// becomes a link, so it must be exactly a question page on this site
// (`/<exam>/question/<slug>`, slugs being lowercase letters, digits and hyphens).
// A looser "starts with one slash" lets `/\host` and `/<tab>/host` through, and
// browsers read both as `//host`.
const QUESTION_PATH = /^\/[a-z0-9-]+\/question\/[a-z0-9-]+$/;

function lookup(index, key) {
  if (!Object.hasOwn(index, key)) return null;
  const q = index[key];
  return Array.isArray(q) && q.length >= 3 && q.every((x) => typeof x === 'string') && QUESTION_PATH.test(q[0])
    ? { path: q[0], subject: q[1], title: q[2] }
    : null;
}

/**
 * One question as a page lists it (the revise page does; /account now shows
 * only counts and subjects). `path`, `subject` and `title` are null when the
 * index does not know the key (its year file did not load, or the question is
 * gone): the caller then shows the key, and never invents a subject.
 */
export function describe(key, index) {
  return { key, serial: serialOf(key), ...(lookup(index, key) ?? { path: null, subject: null, title: null }) };
}

const byText = (a, b) => a.localeCompare(b, 'en');

/**
 * The subjects a set of questions falls under, for the line on a list card:
 * the two with the most questions (a tie goes A to Z, so the line does not
 * depend on the order the questions were saved in) and how many other subjects
 * there are. A key the index does not know is in no subject, and is ignored.
 */
export function subjectsCovered(keys, index) {
  const counts = new Map();
  for (const key of keys) {
    const found = lookup(index, key);
    if (found) counts.set(found.subject, (counts.get(found.subject) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || byText(a[0], b[0])).map(([subject]) => subject);
  return { top: ranked.slice(0, 2), more: Math.max(0, ranked.length - 2) };
}

/**
 * The keys marked Needs review, the mark that has waited longest first. This is
 * the order to revise them in (summarise lists them newest first, to show what
 * was just marked). Dates are compared as dates; the key breaks a tie.
 */
export function reviewOldestFirst(state) {
  return Object.entries(state.entries)
    .filter(([, entry]) => entry.status === 'review')
    .map(([key, entry]) => ({ key, at: Date.parse(entry.updatedAt) }))
    .sort((a, b) => a.at - b.at || byText(a.key, b.key))
    .map((r) => r.key);
}

/**
 * @param state  { entries, lists } as stored
 * @param index  the question indexes loaded so far, merged
 * @returns
 *   totals    marks across everything, placed in a subject or not
 *   subjects  [{ subject, done, review }] A to Z, only for questions the index knows
 *   unplaced  marked questions the index does not know (so are in no subject row)
 *   review    keys marked Needs review, most recently marked first
 *   lists     [{ id, name, keys }] A to Z by name, keys in the order they were saved
 */
export function summarise(state, index) {
  const totals = { done: 0, review: 0 };
  const bySubject = new Map();
  let unplaced = 0;
  const review = [];

  for (const [key, entry] of Object.entries(state.entries)) {
    totals[entry.status] += 1;
    if (entry.status === 'review') review.push({ key, at: Date.parse(entry.updatedAt) });
    const found = lookup(index, key);
    if (!found) {
      unplaced += 1;
      continue;
    }
    const row = bySubject.get(found.subject) ?? { subject: found.subject, done: 0, review: 0 };
    row[entry.status] += 1;
    bySubject.set(found.subject, row);
  }

  return {
    totals,
    subjects: [...bySubject.values()].sort((a, b) => byText(a.subject, b.subject)),
    unplaced,
    // Newest first, key as the tie-break, so the order never depends on the
    // order storage happened to list its entries in.
    review: review.sort((a, b) => b.at - a.at || byText(a.key, b.key)).map((r) => r.key),
    lists: Object.entries(state.lists)
      .map(([id, l]) => ({ id, name: l.name, keys: l.keys }))
      .sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id)),
  };
}
