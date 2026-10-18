// The one place an exam's own numbers live: how many options a question has, and
// the marks for a right and a wrong answer. Test scoring and analytics both read
// them from here, so a second exam is one entry in EXAM_RULES and nothing else.
// Pure and browser-safe: no DOM, no file reads.

/**
 * @param spec.options  the answer keys, in order, e.g. ['a', 'b', 'c', 'd']
 * @param spec.right    marks for a right answer
 * @param spec.wrong    the penalty for a wrong answer: `numerator / denominator` marks
 */
export function makeRules({ options, right, wrong }) {
  const { numerator, denominator } = wrong;
  // Marks are (R·d·r − n·w) / d, not R·r − (n/d)·w: for UPSC that is (6r − 2w) / 3,
  // which keeps the thirds out of floating point until the single division. Its
  // hundredths are whole or a third or two-thirds off, never a half, so
  // Math.round has no tie to break.
  const toTwoDecimals = (n) => Math.round(n * 100) / 100;
  return {
    options: [...options],
    marks: (r, w) => toTwoDecimals((right * denominator * r - numerator * w) / denominator),
    max: (scored) => right * scored,
    penalty: (w) => toTwoDecimals((numerator * w) / denominator),
  };
}

// UPSC prelims today: four options, +2 for a right answer, minus 2/3 of a mark
// for a wrong one, 0 for a blank.
const EXAM_RULES = {
  upsc: makeRules({ options: ['a', 'b', 'c', 'd'], right: 2, wrong: { numerator: 2, denominator: 3 } }),
};

/** The exam's rules, or null for an exam with none. Own keys only, so 'constructor' is not an exam. */
export const examRules = (exam) => (Object.hasOwn(EXAM_RULES, exam) ? EXAM_RULES[exam] : null);
