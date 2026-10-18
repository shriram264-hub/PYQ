// The numbers the analytics pages show, from a student's submitted tests and their
// Done / Needs review marks. Every rule is the spec's "Definitions"
// (docs/superpowers/specs/2026-10-18-analytics-design.md). Pure: no DOM, no storage,
// and nothing here names an exam: its marking arrives as `rules` (lib/exam-rules.js)
// and its questions as the parsed catalogue (tests/catalogue.js).
//
// A question is looked up in the catalogue before anything else. One the catalogue
// does not list (removed from the data, another exam's, a malformed key) is skipped
// outright: it counts in no total. One it lists with no official answer is not
// scored (it is in no answered, right or wrong count, as in test scoring) but the
// student did see it, so answering it still counts as coverage.

/** Answers needed before a subject or topic is ranked, or shown as a bare percentage. */
export const MIN_ANSWERED = 5;

const TOPICS_SHOWN = 3;

const byText = (a, b) => a.localeCompare(b, 'en');
// numeric: question 9 before question 10, which a plain text compare gets the wrong way round.
const byKey = (a, b) => a.localeCompare(b, 'en', { numeric: true });
const byId = (x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
// `|| 0` turns a -0 into 0, so a change that rounds to nothing is not shown as "-0".
const toTwoDecimals = (n) => Math.round(n * 100) / 100 || 0;
const time = (iso) => Date.parse(iso);
// Equal moments fall to the id, so the same attempts always come out in the same order.
// (A NaN from an unreadable date is falsy too, and falls the same way.)
const oldestFirst = (x, y) => time(x.submittedAt) - time(y.submittedAt) || byId(x, y);

const isSubmitted = (a) => a.status === 'submitted';
const papersOf = (attempts) => attempts.filter((a) => isSubmitted(a) && a.kind === 'paper').sort(oldestFirst);

/** This exam's submitted attempts, oldest first. Unfinished and abandoned ones never count. */
export function submittedFor(tests, exam) {
  return Object.values(tests?.attempts ?? {})
    .filter((a) => isSubmitted(a) && a.exam === exam)
    .sort(oldestFirst);
}

/**
 * The headline numbers, read from each attempt's stored `result`: they need no
 * catalogue, so they stand when the catalogue cannot be fetched.
 */
export function headline(attempts, rules) {
  const submitted = attempts.filter(isSubmitted);
  let right = 0;
  let wrong = 0;
  let blank = 0;
  let scored = 0;
  for (const { result } of submitted) {
    right += result.right;
    wrong += result.wrong;
    blank += result.blank;
    scored += result.scored;
  }

  const papers = papersOf(attempts);
  const latest = papers.at(-1);
  const before = papers.at(-2);
  let latestPaper = null;
  if (latest) {
    // A change in marks means something only between papers marked out of the same total.
    const comparable = before && before.result.max === latest.result.max;
    latestPaper = {
      year: latest.spec.year,
      score: latest.result.score,
      max: latest.result.max,
      change: comparable ? toTwoDecimals(latest.result.score - before.result.score) : null,
    };
  }

  return {
    tests: submitted.length,
    papers: papers.length,
    accuracy: { right, answered: right + wrong },
    blank: { blank, scored },
    lost: rules.penalty(wrong),
    latestPaper,
  };
}

/** Full papers only, oldest first: what the chart draws. */
export function paperHistory(attempts) {
  return papersOf(attempts).map((a) => ({
    id: a.id,
    year: a.spec.year,
    score: a.result.score,
    max: a.result.max,
    submittedAt: a.submittedAt,
  }));
}

const topicKey = (subject, topic) => `${subject}\u0000${topic}`;
const emptyStats = () => ({ answered: 0, right: 0, covered: 0, total: 0 });

function statsOf(map, key) {
  let stats = map.get(key);
  if (!stats) {
    stats = emptyStats();
    map.set(key, stats);
  }
  return stats;
}

const accuracyOf = (r) => (r.answered ? r.right / r.answered : 0);
/** Lowest accuracy first; of two alike, the one with more answers behind it. */
const weakestFirst = (a, b) => accuracyOf(a) - accuracyOf(b) || b.answered - a.answered;

/**
 * Per subject and topic: answers, marks and coverage; and the wrong-answers pile.
 *
 * @param attempts  attempts as parseAttempt returns them; only this exam's submitted ones count
 * @param marks     { [key]: { status: 'done' | 'review', updatedAt } }, as the progress store keeps them
 * @param catalogue the parsed catalogue (parseCatalogue)
 * @param rules     the exam's marking rules (lib/exam-rules.js)
 * @param exam      the exam these attempts must belong to
 * @returns subjects (answered or covered ones, weakest first), the three topics most worth
 *   working on, the wrong pile (question keys), and the per-subject and per-topic counts
 *   keyed by subject name and by `${subject}\u0000${topic}`.
 */
export function breakdown(attempts, marks, catalogue, rules, exam) {
  const marked = marks ?? {};
  const bySubject = new Map();
  const byTopic = new Map();
  const entryOf = new Map();

  // Every question the site lists under the subject or topic is in its total, cancelled ones
  // included: the subject and topic pages list them too.
  for (const entry of catalogue.entries) {
    entryOf.set(entry.key, entry);
    statsOf(bySubject, entry.subject).total += 1;
    statsOf(byTopic, topicKey(entry.subject, entry.topic)).total += 1;
  }

  const covered = new Set();
  const last = new Map(); // key -> the last scored answer given: { right, at }
  // Oldest first, so the later answer overwrites the earlier whatever order the caller used.
  const counted = attempts.filter((a) => isSubmitted(a) && a.exam === exam).sort(oldestFirst);
  for (const attempt of counted) {
    for (const key of attempt.keys) {
      const entry = entryOf.get(key);
      const mine = Object.hasOwn(attempt.answers, key) ? attempt.answers[key] : null;
      if (!entry || !mine) continue; // not in the catalogue, or left blank
      covered.add(key);
      if (entry.answer === null) continue; // seen, but nothing to score it against
      const right = mine === entry.answer;
      for (const stats of [bySubject.get(entry.subject), byTopic.get(topicKey(entry.subject, entry.topic))]) {
        stats.answered += 1;
        if (right) stats.right += 1;
      }
      last.set(key, { right, at: attempt.submittedAt });
    }
  }

  // Done and Needs review both count as covered: the student has read the question.
  for (const [key, mark] of Object.entries(marked)) {
    if (entryOf.has(key) && (mark?.status === 'done' || mark?.status === 'review')) covered.add(key);
  }
  for (const key of covered) {
    const entry = entryOf.get(key);
    bySubject.get(entry.subject).covered += 1;
    byTopic.get(topicKey(entry.subject, entry.topic)).covered += 1;
  }

  // Wrong when the last actual answer was wrong, until a Done marked after that test was
  // submitted. A blank in a later test does not clear it, and nor does Needs review.
  const doneSince = (key, at) =>
    Object.hasOwn(marked, key) && marked[key]?.status === 'done' && time(marked[key].updatedAt) > time(at);
  const wrong = [...last]
    .filter(([key, answer]) => !answer.right && !doneSince(key, answer.at))
    .sort(([keyA, a], [keyB, b]) => time(b.at) - time(a.at) || byKey(keyA, keyB))
    .map(([key]) => key);

  const rows = [...bySubject]
    .filter(([, s]) => s.answered > 0 || s.covered > 0)
    .map(([subject, s]) => ({
      subject,
      answered: s.answered,
      right: s.right,
      wrong: s.answered - s.right,
      net: rules.marks(s.right, s.answered - s.right),
      covered: s.covered,
      total: s.total,
    }));
  // Enough answers to rank, then a few answers, then coverage alone.
  const tier = (r) => (r.answered >= MIN_ANSWERED ? 0 : r.answered > 0 ? 1 : 2);
  const subjects = rows.sort((a, b) => tier(a) - tier(b) || weakestFirst(a, b) || byText(a.subject, b.subject));

  const topics = [...byTopic]
    .filter(([, s]) => s.answered >= MIN_ANSWERED)
    .map(([key, s]) => {
      const [subject, topic] = key.split('\u0000');
      return { subject, topic, right: s.right, answered: s.answered };
    })
    .sort((a, b) => weakestFirst(a, b) || byText(a.topic, b.topic) || byText(a.subject, b.subject))
    .slice(0, TOPICS_SHOWN);

  return { subjects, topics, wrong, bySubject, byTopic };
}

/** The line under a subject or topic's heading, or null when the student has nothing there yet. */
export function statsLine(stats) {
  if (!stats) return null;
  const { answered, right, covered, total } = stats;
  const coverage = `Covered ${covered} of ${total}`;
  if (answered >= MIN_ANSWERED) {
    return `Your accuracy here: ${Math.round((100 * right) / answered)}% (${answered} answered) · ${coverage}`;
  }
  // One or two answers read as a verdict if given as a percentage.
  if (answered > 0) return `${right} of ${answered} right so far · ${coverage}`;
  return covered > 0 ? coverage : null;
}
