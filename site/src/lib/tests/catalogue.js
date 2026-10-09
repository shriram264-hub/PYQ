import { isQuestionKey, questionKey } from '../accounts/qkey.js';

// The practice-set form's index of every question: which subject and topic it
// is filed under, its year, and whether it can be scored. Built into
// /upsc/catalogue.json (pages/upsc/catalogue.json.js) and fetched only when a
// student builds a set. Names are listed once and referred to by position:
// spelled out on every question the file is 26 KB gzipped, indexed it is 17 KB.
//   { subjects: [name], topics: [[subjectIndex, name]], questions: { key: [subjectIndex, topicIndex, year, flag] } }

export const FLAG = { ok: 0, disputed: 1, unanswered: 2, cancelled: 3 };

const OPTION = /^[abcd]$/;

/** Cancelled; else no official answer to score against; else disputed; else ok. */
export function flagOf(q) {
  if (q.status === 'cancelled') return FLAG.cancelled;
  if (typeof q.answer !== 'string' || !OPTION.test(q.answer)) return FLAG.unanswered;
  return q.status === 'disputed' ? FLAG.disputed : FLAG.ok;
}

const byText = (a, b) => a.localeCompare(b, 'en');

/** Build time: from corpus questions ({ year, q_no, subject, subtopic, status, answer }). */
export function buildCatalogue(questions) {
  const subjects = [...new Set(questions.map((q) => q.subject))].sort(byText);
  const subjectIndex = new Map(subjects.map((s, i) => [s, i]));
  const pairs = [...new Map(questions.map((q) => [`${q.subject}\u0000${q.subtopic}`, [q.subject, q.subtopic]])).values()].sort(
    (a, b) => byText(a[0], b[0]) || byText(a[1], b[1])
  );
  const topicIndex = new Map(pairs.map(([s, t], i) => [`${s}\u0000${t}`, i]));
  const topics = pairs.map(([s, t]) => [subjectIndex.get(s), t]);
  const ordered = [...questions].sort((a, b) => a.year - b.year || a.q_no - b.q_no);
  const entries = {};
  for (const q of ordered) {
    entries[questionKey('upsc', q.year, q.q_no)] = [
      subjectIndex.get(q.subject),
      topicIndex.get(`${q.subject}\u0000${q.subtopic}`),
      q.year,
      flagOf(q),
    ];
  }
  return { subjects, topics, questions: entries };
}

const KEY = /^upsc-(\d{4})-(\d{1,3})$/;
const isIndex = (v, length) => Number.isInteger(v) && v >= 0 && v < length;

/**
 * In the browser: the fetched file, checked before the form trusts it. Null
 * when it is not a catalogue at all; an entry that does not add up (an index
 * out of range, a topic of another subject, a year that is not the key's, an
 * unknown flag) is dropped. Entries come back ordered by year, then number.
 */
export function parseCatalogue(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { subjects, topics, questions } = data;
  if (!Array.isArray(subjects) || !subjects.every((s) => typeof s === 'string')) return null;
  if (!Array.isArray(topics) || !questions || typeof questions !== 'object' || Array.isArray(questions)) return null;
  const topicList = topics.map((t) =>
    Array.isArray(t) && t.length === 2 && isIndex(t[0], subjects.length) && typeof t[1] === 'string'
      ? { subject: subjects[t[0]], name: t[1] }
      : null
  );
  const entries = [];
  for (const [key, value] of Object.entries(questions)) {
    const m = KEY.exec(key);
    if (!m || !isQuestionKey(key) || !Array.isArray(value) || value.length !== 4) continue;
    const [s, t, year, flag] = value;
    if (!isIndex(s, subjects.length) || !isIndex(t, topicList.length) || !topicList[t]) continue;
    if (topicList[t].subject !== subjects[s] || year !== Number(m[1]) || !Object.values(FLAG).includes(flag)) continue;
    entries.push({ key, subject: subjects[s], topic: topicList[t].name, year, flag, n: Number(m[2]) });
  }
  entries.sort((a, b) => a.year - b.year || a.n - b.n);
  return {
    subjects: [...subjects],
    topics: topicList.filter(Boolean),
    entries: entries.map(({ n, ...e }) => e),
  };
}
