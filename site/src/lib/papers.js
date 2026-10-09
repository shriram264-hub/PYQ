import { YEARS, questionsForYear } from './corpus.js';
import { paperInfo, paperNotes } from './tests/build.js';

// Build time only (corpus.js reads the question file from disk): one entry per
// year for the papers list on /upsc/test, the year pages' "Sit this paper" line
// and the take page's start screen. Newest first, as YEARS is.
export const PAPERS = YEARS.map(({ year }) => {
  const info = paperInfo(year, questionsForYear(year));
  return { year, questions: info.questions, notes: paperNotes(info) };
});
