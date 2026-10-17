// The results page's review (spec, "Review"): what each question scored, and
// which questions each filter shows. Pure; scripts/result-page.js draws it.

export const REVIEW_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'wrong', label: 'Wrong' },
  { id: 'blank', label: 'Not answered' },
  { id: 'review', label: 'Marked for review' },
];

const chosen = (attempt, key) => (Object.hasOwn(attempt.answers, key) ? attempt.answers[key] : null);

/** 'right' | 'wrong' | 'blank' (scored, not answered) | 'unscored' (no official answer). */
export function verdictOf(attempt, key, official) {
  if (!official) return 'unscored';
  const mine = chosen(attempt, key);
  if (!mine) return 'blank';
  return mine === official ? 'right' : 'wrong';
}

export function verdictText(verdict, mine, official) {
  if (verdict === 'right') return `Your answer: (${mine}). Right, +2.`;
  if (verdict === 'wrong') return `Your answer: (${mine}). Wrong, −0.67. The official answer is (${official}).`;
  if (verdict === 'blank') return `Not answered. The official answer is (${official}).`;
  return `Not scored: UPSC gives no answer for this question.${mine ? ` You chose (${mine}).` : ''}`;
}

/**
 * The keys a filter shows, in test order. "Not answered" is every question
 * without an answer, scored or not; "Wrong" needs an official answer to be wrong
 * against; "Marked for review" is the student's own flag.
 */
export function reviewKeys(attempt, officialOf, filter) {
  if (filter === 'review') return attempt.keys.filter((k) => attempt.review.includes(k));
  if (filter === 'blank') return attempt.keys.filter((k) => !chosen(attempt, k));
  if (filter === 'wrong') return attempt.keys.filter((k) => verdictOf(attempt, k, officialOf(k)) === 'wrong');
  return [...attempt.keys];
}
