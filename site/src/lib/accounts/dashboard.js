import { attemptName, progressLine, remainingMs } from '../tests/attempt.js';
import { formatClock } from '../tests/clock.js';
import { formatDate, formatScore } from '../tests/score.js';
import { finished, unfinished } from '../tests/store.js';
import { slugify } from '../question-html.js';
import { reviewOldestFirst } from './summary.js';

// What My progress (/account) shows at its top: the cards that pick up where
// the student left off, the headline figures of their tests, their latest
// results, and coverage by subject. Pure: no DOM, no storage, no network, and no
// exam named here; the page passes its exam and the numbers it has read.

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUS = '−';
const byText = new Intl.Collator('en').compare;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const percent = (part, whole) => Math.round((100 * part) / whole);

/** A score as the analytics page prints it: two places, and a true minus sign. */
export const scoreText = (n) => formatScore(n).replace(/^-/, MINUS);

/** A change in marks: "+3.33", "−1.67", or "0.00". */
export const signedText = (n) => (n > 0 ? `+${formatScore(n)}` : n < 0 ? `${MINUS}${formatScore(-n)}` : formatScore(0));

/**
 * The test to resume: this exam's unfinished attempt touched last, or null.
 * `detail` is the line /upsc/test's Carry on shows for it.
 */
export function resumeOf(tests, exam) {
  const a = unfinished(tests).find((x) => x.exam === exam);
  if (!a) return null;
  return { id: a.id, name: attemptName(a), detail: `${progressLine(a)} · ${formatClock(remainingMs(a))} left` };
}

/**
 * The Needs review pile: how many, and how many whole days ago the oldest of them
 * was marked (null when its date cannot be read), or null when there are none.
 * Every exam's marks count, as /revise?review shows them all.
 */
export function reviewOf(state, now) {
  const keys = reviewOldestFirst(state);
  if (!keys.length) return null;
  const at = Date.parse(state.entries[keys[0]].updatedAt);
  const days = Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / DAY_MS)) : null;
  return { count: keys.length, days };
}

/** "Oldest marked 12 days ago", or null when the date is unknown. */
export function oldestLine(days) {
  if (days === null || days === undefined) return null;
  if (days === 0) return 'Oldest marked in the last day';
  return `Oldest marked ${plural(days, 'day', 'days')} ago`;
}

/** The practice-set form, opened on a subject (and a topic in it). */
export const practisePath = (exam, subject, topic) =>
  `/${exam}/test?subject=${slugify(subject)}${topic === undefined ? '' : `&topic=${slugify(topic)}`}#practice`;

/** The weakest topic card, from breakdown().topics[0], or null when there is none. */
export function weakestOf(topic, exam) {
  if (!topic) return null;
  return {
    topic: topic.topic,
    subject: topic.subject,
    line: `${topic.right} of ${topic.answered} right so far`,
    href: practisePath(exam, topic.subject, topic.topic),
  };
}

/**
 * Which cards the top of the page shows, and which action is the page's one
 * filled-green button.
 *   cards    the cards that apply, in order: 'resume', 'review', 'weak'. The weak
 *            card is there for anyone with a submitted test, before the catalogue
 *            has said which topic it is: its place is held from the first draw.
 *   starter  none of them apply: the Take your first test card instead
 *   hint     the starter's line about marking, for a student with no marks at all
 *   primary  'resume' | 'analytics' | 'starter' | 'tests' (the Practice tests
 *            button, when nothing above it is shown)
 */
export function pickPlan({ resume, review, tests, marked }) {
  const cards = [];
  if (resume) cards.push('resume');
  if (review) cards.push('review');
  if (tests > 0) cards.push('weak');
  const starter = cards.length === 0;
  const primary = resume ? 'resume' : tests > 0 ? 'analytics' : starter ? 'starter' : 'tests';
  return { cards, starter, hint: starter && !marked, primary };
}

function changeLine({ year, change }) {
  const which = `${year} paper`;
  if (change === null) return which;
  if (change === 0) return `${which}, the same score as the paper before`;
  return `${which}, ${signedText(change)} on the paper before`;
}

/**
 * The three headline figures, from headline() (lib/tests/analytics.js): label,
 * figure, the maximum it is out of (or null), and the line under it.
 */
export function figures(h) {
  const sets = h.tests - h.papers;
  const made = [];
  if (h.papers) made.push(plural(h.papers, 'full paper', 'full papers'));
  if (sets) made.push(plural(sets, 'practice set', 'practice sets'));
  const { right, answered } = h.accuracy;
  const latest = h.latestPaper;
  return [
    { label: 'Tests taken', value: String(h.tests), max: null, detail: made.join(' and ') },
    answered
      ? { label: 'Accuracy', value: `${percent(right, answered)}%`, max: null, detail: `${right} right of ${answered} answered` }
      : { label: 'Accuracy', value: 'None', max: null, detail: 'No questions answered yet' },
    latest
      ? { label: 'Latest paper', value: scoreText(latest.score), max: latest.max, detail: changeLine(latest) }
      : { label: 'Latest paper', value: 'None', max: null, detail: 'No full paper yet' },
  ];
}

/** This exam's latest submitted tests, newest first: name, date and score, for a link to each result. */
export function recentTests(tests, exam, n = 3) {
  return finished(tests)
    .filter((a) => a.exam === exam)
    .slice(0, n)
    .map((a) => ({
      id: a.id,
      name: attemptName(a),
      date: formatDate(a.submittedAt),
      score: scoreText(a.result.score),
      max: a.result.max,
    }));
}

/**
 * Coverage by subject, from breakdown().bySubject: the subjects with anything
 * covered, the largest share first (then the most questions, then A to Z), and
 * how many subjects have nothing covered yet.
 */
export function coverageOf(bySubject) {
  const all = [...bySubject].filter(([, s]) => s.total > 0);
  const rows = all
    .filter(([, s]) => s.covered > 0)
    .map(([subject, s]) => ({ subject, covered: s.covered, total: s.total }))
    .sort((a, b) => b.covered / b.total - a.covered / a.total || b.covered - a.covered || byText(a.subject, b.subject));
  return { rows, more: all.length - rows.length };
}
