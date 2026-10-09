// Scoring a test by today's UPSC rules (spec, Decisions): +2 for a right
// answer, minus two-thirds of a mark for a wrong one, 0 for a blank. A question
// with no official answer (cancelled, or disputed with none recorded) is not
// scored: it counts in none of the numbers. Pure, so the rules are tested here.

const OPTION = /^[abcd]$/;

/** The answer a question is scored against, from a full-file entry: 'a'..'d', or null when it is not scored. */
export function officialAnswer(entry) {
  if (!entry || entry.status === 'cancelled' || typeof entry.answer !== 'string') return null;
  return OPTION.test(entry.answer) ? entry.answer : null;
}

// (6r − 2w) / 3 is 2r − ⅔w without adding up thirds in floating point. Its
// hundredths are whole or a third or two-thirds off, never a half, so
// Math.round has no tie to break.
export const marks = (right, wrong) => Math.round(((6 * right - 2 * wrong) / 3) * 100) / 100;

/**
 * @param keys       the test's questions, in order
 * @param answers    { [key]: 'a'..'d' } as the student left them
 * @param officialOf key -> 'a'..'d' | null (null: not scored)
 */
export function scoreAttempt(keys, answers, officialOf) {
  let scored = 0;
  let right = 0;
  let wrong = 0;
  for (const key of keys) {
    const official = officialOf(key);
    if (!official) continue;
    scored += 1;
    const mine = Object.hasOwn(answers, key) ? answers[key] : null;
    if (!mine) continue;
    if (mine === official) right += 1;
    else wrong += 1;
  }
  return { scored, right, wrong, blank: scored - right - wrong, score: marks(right, wrong), max: 2 * scored };
}

export const formatScore = (n) => n.toFixed(2);

/** Right ÷ answered, or null when nothing scored was answered. */
export const accuracy = (r) => (r.right + r.wrong ? r.right / (r.right + r.wrong) : null);

export function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function resultLine(result, usedMs) {
  return [
    `Score ${formatScore(result.score)} / ${result.max}`,
    `${result.right} right`,
    `${result.wrong} wrong`,
    `${result.blank} not answered`,
    formatDuration(usedMs),
  ].join(' · ');
}

/**
 * Right, wrong and blank per subject, A to Z, over the scored questions.
 * `entryOf(key)` is the question's full-file entry, or null when its year did
 * not load or it is gone: such a question is in no row.
 */
export function bySubject(keys, answers, entryOf) {
  const rows = new Map();
  for (const key of keys) {
    const entry = entryOf(key);
    const official = officialAnswer(entry);
    if (!official) continue;
    const row = rows.get(entry.subject) ?? { subject: entry.subject, right: 0, wrong: 0, blank: 0 };
    const mine = Object.hasOwn(answers, key) ? answers[key] : null;
    if (!mine) row.blank += 1;
    else if (mine === official) row.right += 1;
    else row.wrong += 1;
    rows.set(entry.subject, row);
  }
  return [...rows.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'en'));
}
