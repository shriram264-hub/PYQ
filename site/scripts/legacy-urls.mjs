/**
 * One-off generator for data/legacy-urls.json: every subject and topic address
 * the site had before the taxonomy change and no longer builds, each with the
 * address it forwards to. Run once, by hand, at the time of the change, from
 * site/ (corpus.js resolves the data from the working directory):
 *
 *   git show a2f3a17:data/questions.json > old-questions.json
 *   node scripts/legacy-urls.mjs old-questions.json
 *
 * The result is committed. Re-running it later against newer data would mix
 * later edits into the list, so it is a record of one moment, not a build step.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { slugify } from '../src/lib/corpus.js';
import { destinationOf, pagedDestination } from '../src/lib/legacy.js';

setTimeout(() => process.exit(2), 110000).unref();

// Both route files paginate at 25: PAGE_SIZE in subject/[slug]/[...page].astro,
// and the literal pageSize in topic/[subject]/[topic]/[...page].astro.
const PAGE_SIZE = 25;

// Frozen on purpose. The old site tidied raw subject labels with an alias table
// before building addresses, so the addresses people bookmarked came from the
// tidied names (/upsc/subject/indian-polity, never /upsc/subject/polity). That
// table has been deleted from the site, so it is reproduced here to rebuild the
// old addresses exactly. Do not extend it.
const OLD_SUBJECT_ALIASES = {
  Polity: 'Indian Polity',
  Economy: 'Indian Economy',
  Environment: 'Environment & Ecology',
  'Science and Technology': 'Science & Technology',
  Science: 'Science & Technology',
};
const oldSubject = (subject) => OLD_SUBJECT_ALIASES[subject] ?? subject;

const oldFile = process.argv[2];
if (!oldFile) {
  console.error('usage: node scripts/legacy-urls.mjs <old questions.json>');
  process.exit(1);
}

const oldQuestions = JSON.parse(readFileSync(oldFile, 'utf-8'));
const newQuestions = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../data/questions.json', import.meta.url)), 'utf-8')
);

// Only labels changed, and record order was kept, so row i is the same question
// in both files. Anything else would make "where its questions went" meaningless.
if (oldQuestions.length !== newQuestions.length) {
  console.error(`old has ${oldQuestions.length} questions, new has ${newQuestions.length}`);
  process.exit(1);
}
oldQuestions.forEach((o, i) => {
  const n = newQuestions[i];
  if (o.year !== n.year || o.q_no !== n.q_no || o.question !== n.question) {
    console.error(`row ${i} is a different question in the old and new files`);
    process.exit(1);
  }
});

const subjectPath = (subject) => `/upsc/subject/${slugify(subject)}`;
const topicPath = (subject, subtopic) =>
  `/upsc/topic/${slugify(subject)}/${slugify(subtopic)}`;

const pageCount = (n) => Math.ceil(n / PAGE_SIZE);
const withPage = (base, page) => (page === 1 ? base : `${base}/${page}`);

/** address -> number of questions, for either side. */
function tally(questions, pathOf) {
  const counts = new Map();
  for (const q of questions) {
    const path = pathOf(q);
    counts.set(path, (counts.get(path) ?? 0) + 1);
  }
  return counts;
}

// New addresses: every one the site now builds, with its page count.
const newSubjects = tally(newQuestions, (q) => subjectPath(q.subject));
const newTopics = tally(newQuestions, (q) => topicPath(q.subject, q.subtopic));
const newPages = new Set();
for (const counts of [newSubjects, newTopics]) {
  for (const [base, n] of counts) {
    for (let p = 1; p <= pageCount(n); p += 1) newPages.add(withPage(base, p));
  }
}

// Old addresses, grouped by kind so the report can say what was forwarded.
const kinds = [
  {
    name: 'subject',
    oldPath: (q) => subjectPath(oldSubject(q.subject)),
    newPath: (q) => subjectPath(q.subject),
    newCounts: newSubjects,
  },
  {
    name: 'topic',
    oldPath: (q) => topicPath(oldSubject(q.subject), q.subtopic),
    newPath: (q) => topicPath(q.subject, q.subtopic),
    newCounts: newTopics,
  },
];

const entries = {};
const byKind = {};

for (const kind of kinds) {
  // old address -> (new address -> how many of its questions now live there)
  const moved = new Map();
  const oldCounts = new Map();
  oldQuestions.forEach((o, i) => {
    const from = kind.oldPath(o);
    const to = kind.newPath(newQuestions[i]);
    oldCounts.set(from, (oldCounts.get(from) ?? 0) + 1);
    if (!moved.has(from)) moved.set(from, new Map());
    const dest = moved.get(from);
    dest.set(to, (dest.get(to) ?? 0) + 1);
  });

  for (const [base, count] of oldCounts) {
    const dest = destinationOf(moved.get(base));
    const destPages = pageCount(kind.newCounts.get(dest));
    for (let page = 1; page <= pageCount(count); page += 1) {
      const from = withPage(base, page);
      if (newPages.has(from)) continue; // still built; nothing to forward
      const to = pagedDestination(page, dest, destPages);
      if (!newPages.has(to)) throw new Error(`${from} would forward to ${to}, which is not built`);
      entries[from] = to;
      const label = `${kind.name}${page === 1 ? '' : ' (page 2+)'}`;
      byKind[label] = (byKind[label] ?? 0) + 1;
    }
  }
}

const sorted = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

writeFileSync(
  fileURLToPath(new URL('../../data/legacy-urls.json', import.meta.url)),
  `${JSON.stringify(sorted, null, 2)}\n`
);

console.log(`${Object.keys(sorted).length} entries written to data/legacy-urls.json`);
for (const [label, n] of Object.entries(byKind)) console.log(`  ${label}: ${n}`);
