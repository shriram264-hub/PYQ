import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Build-time only: the corpus is baked into static pages, never fetched at runtime.
// Resolved from the working directory rather than import.meta.url, because the
// bundler relocates this chunk and would break a module-relative path.
const questions = JSON.parse(
  readFileSync(resolve(process.cwd(), '../data/questions.json'), 'utf-8')
);

/**
 * The PDF extraction emitted several labels for the same subject. Left alone
 * these produce competing pages (a 401-question "Indian Polity" and a
 * 20-question "Polity"), which is both confusing in filters and actively bad
 * for search indexing.
 */
const SUBJECT_ALIASES = {
  Polity: 'Indian Polity',
  Economy: 'Indian Economy',
  Environment: 'Environment & Ecology',
  'Science and Technology': 'Science & Technology',
  Science: 'Science & Technology',
};

export function canonicalSubject(subject) {
  return SUBJECT_ALIASES[subject] ?? subject;
}

export function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export const ALL_QUESTIONS = questions.map((q) => {
  const subject = canonicalSubject(q.subject);
  return {
    ...q,
    subject,
    subjectSlug: slugify(subject),
    subtopicSlug: slugify(q.subtopic),
    slug: `${q.year}-q${q.q_no}-${slugify(q.question.slice(0, 60))}`,
  };
});

function countBy(items, key) {
  const map = new Map();
  for (const item of items) {
    const value = item[key];
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return map;
}

const subjectCounts = countBy(ALL_QUESTIONS, 'subject');

export const SUBJECTS = [...subjectCounts.entries()]
  .map(([name, count]) => ({ name, count, slug: slugify(name) }))
  .sort((a, b) => b.count - a.count);

const yearCounts = countBy(ALL_QUESTIONS, 'year');

export const YEARS = [...yearCounts.entries()]
  .map(([year, count]) => ({ year, count }))
  .sort((a, b) => b.year - a.year);

const subtopicMap = new Map();
for (const q of ALL_QUESTIONS) {
  const key = `${q.subject}||${q.subtopic}`;
  if (!subtopicMap.has(key)) {
    subtopicMap.set(key, {
      subject: q.subject,
      subjectSlug: q.subjectSlug,
      subtopic: q.subtopic,
      slug: q.subtopicSlug,
      count: 0,
    });
  }
  subtopicMap.get(key).count += 1;
}

export const SUBTOPICS = [...subtopicMap.values()].sort((a, b) => b.count - a.count);

/**
 * Subtopics thin enough that their own page would carry almost nothing. They
 * stay reachable inside their subject page, but do not get indexed pages of
 * their own.
 */
export const SUBSTANTIAL_SUBTOPICS = SUBTOPICS.filter((s) => s.count >= 5);

export const CORPUS = {
  total: ALL_QUESTIONS.length,
  subjectCount: SUBJECTS.length,
  yearCount: YEARS.length,
  subtopicCount: SUBTOPICS.length,
  minYear: Math.min(...YEARS.map((y) => y.year)),
  maxYear: Math.max(...YEARS.map((y) => y.year)),
  cancelled: ALL_QUESTIONS.filter((q) => q.status === 'cancelled').length,
  disputed: ALL_QUESTIONS.filter((q) => q.status === 'disputed').length,
};

export function questionsForSubject(slug) {
  return ALL_QUESTIONS.filter((q) => q.subjectSlug === slug);
}

export function questionsForYear(year) {
  return ALL_QUESTIONS.filter((q) => q.year === Number(year));
}

export function questionsForSubtopic(subjectSlug, subtopicSlug) {
  return ALL_QUESTIONS.filter(
    (q) => q.subjectSlug === subjectSlug && q.subtopicSlug === subtopicSlug
  );
}
