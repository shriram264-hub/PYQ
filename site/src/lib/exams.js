import { CORPUS, SUBJECTS } from './corpus.js';

/**
 * Every exam the site serves. The homepage rack, breadcrumbs and anything else
 * that needs to know "which exams exist" reads this list, so adding an exam is
 * one entry here plus its corpus — not a hunt through templates.
 *
 * `path` is the exam's root, and every page for that exam lives beneath it.
 */
export const EXAMS = [
  {
    slug: 'upsc',
    path: '/upsc',
    short: 'UPSC',
    name: 'UPSC Civil Services Prelims',
    series: 'CSE-P',
    corpus: CORPUS,
    topSubjects: SUBJECTS.slice(0, 4),
  },
];

/** The exam whose pages live under this URL path, if any. */
export function examForPath(pathname) {
  return EXAMS.find((exam) => pathname === exam.path || pathname.startsWith(`${exam.path}/`));
}

/**
 * Prefixes a page's breadcrumb trail with its exam, so UPSC pages read
 * UPSC / Subjects / Indian Polity. The visible trail and the structured data
 * both call this, which keeps them from disagreeing.
 */
export function withExamCrumb(pathname, crumbs) {
  const exam = examForPath(pathname);
  if (!exam || crumbs.length === 0) return crumbs;
  return [{ name: exam.short, href: exam.path }, ...crumbs];
}
