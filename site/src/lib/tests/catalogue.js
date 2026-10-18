import { isQuestionKey, questionKey } from '../accounts/qkey.js';
import { examRules } from '../exam-rules.js';

// The practice-set form's index of every question: which subject and topic it
// is filed under, its year, whether it can be scored, and the official answer it
// is scored against. Built into /upsc/catalogue.json (pages/upsc/catalogue.json.js)
// and fetched when a student builds a set, and by analytics, which tells a right
// answer from a wrong one without fetching the year files. Names are listed once
// and referred to by position: spelled out on every question the file is 26 KB
// gzipped, indexed it is about 20.9 KB.
//   { subjects: [name], topics: [[subjectIndex, name]],
//     questions: { key: [subjectIndex, topicIndex, year, flag, answerIndex] } }
// answerIndex is the official answer's position in the exam's options (0 is 'a',
// 3 is 'd'), or -1 for a question with no scored answer (cancelled, or none
// recorded). A file from before answers existed has entries of four elements
// (a copy still in a browser's cache): they parse, with no answer.

export const FLAG = { ok: 0, disputed: 1, unanswered: 2, cancelled: 3 };

const OPTION = /^[abcd]$/;

/** Cancelled; else no official answer to score against; else disputed; else ok. */
export function flagOf(q) {
  if (q.status === 'cancelled') return FLAG.cancelled;
  if (typeof q.answer !== 'string' || !OPTION.test(q.answer)) return FLAG.unanswered;
  return q.status === 'disputed' ? FLAG.disputed : FLAG.ok;
}

const byText = (a, b) => a.localeCompare(b, 'en');
const OPTIONS = examRules('upsc').options;
const NO_ANSWER = -1;

/** The answer's position in the options, or -1 when the question is not scored (the same cases as flagOf). */
function answerIndexOf(q) {
  const flag = flagOf(q);
  return flag === FLAG.cancelled || flag === FLAG.unanswered ? NO_ANSWER : OPTIONS.indexOf(q.answer);
}

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
      answerIndexOf(q),
    ];
  }
  return { subjects, topics, questions: entries };
}

// An exam's name as the database's question_key check allows it (accounts/qkey.js).
const EXAM_NAME = /^[a-z]+$/;
const isIndex = (v, length) => Number.isInteger(v) && v >= 0 && v < length;

/**
 * In the browser: the fetched file, checked before the form trusts it. Null
 * when it is not a catalogue at all; an entry that does not add up (an index
 * out of range, a topic of another subject, a year that is not the key's, an
 * unknown flag, an answer that is neither -1 nor an option's position) is
 * dropped. Entries come back ordered by year, then number, each with its
 * `answer`: 'a'..'d', or null (not scored, or a file from before answers).
 *
 * `exam` says whose catalogue it is: its options decide which answers are
 * valid and its name which keys belong. Null for an exam with no rules (or a
 * name that is not a valid exam name). `rules` is for tests, which pass a
 * made-up exam's rules instead of adding it to the shared table.
 */
export function parseCatalogue(data, exam = 'upsc', rules = examRules(exam)) {
  if (typeof exam !== 'string' || !EXAM_NAME.test(exam) || !rules) return null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { options } = rules;
  // `exam` is letters only (checked above), so it cannot add regex syntax.
  const key = new RegExp(`^${exam}-(\\d{4})-(\\d{1,3})$`);
  const { subjects, topics, questions } = data;
  if (!Array.isArray(subjects) || !subjects.every((s) => typeof s === 'string')) return null;
  if (!Array.isArray(topics) || !questions || typeof questions !== 'object' || Array.isArray(questions)) return null;
  const topicList = topics.map((t) =>
    Array.isArray(t) && t.length === 2 && isIndex(t[0], subjects.length) && typeof t[1] === 'string'
      ? { subject: subjects[t[0]], name: t[1] }
      : null
  );
  const entries = [];
  for (const [k, value] of Object.entries(questions)) {
    const m = key.exec(k);
    if (!m || !isQuestionKey(k) || !Array.isArray(value) || (value.length !== 4 && value.length !== 5)) continue;
    // A four-element entry is from before answers existed: it parses as having none.
    const [s, t, year, flag, answerIndex = NO_ANSWER] = value;
    if (!isIndex(s, subjects.length) || !isIndex(t, topicList.length) || !topicList[t]) continue;
    if (topicList[t].subject !== subjects[s] || year !== Number(m[1]) || !Object.values(FLAG).includes(flag)) continue;
    if (answerIndex !== NO_ANSWER && !isIndex(answerIndex, options.length)) continue;
    const answer = answerIndex === NO_ANSWER ? null : options[answerIndex];
    entries.push({ key: k, subject: subjects[s], topic: topicList[t].name, year, flag, answer, n: Number(m[2]) });
  }
  entries.sort((a, b) => a.year - b.year || a.n - b.n);
  return {
    subjects: [...subjects],
    topics: topicList.filter(Boolean),
    entries: entries.map(({ n, ...e }) => e),
  };
}
