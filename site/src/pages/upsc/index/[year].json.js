import { YEARS, questionsForYear } from '../../../lib/corpus.js';

// One small file per exam year, built into dist/upsc/index/<year>.json. The
// account page fetches only the years a student has marked or saved, to turn
// stored question keys back into subjects, titles and links. A single file for
// every question would be ~0.8 MB raw, which a student on mobile data would pay
// for to see three questions.
export function getStaticPaths() {
  return YEARS.map(({ year }) => ({ params: { year: String(year) } }));
}

// { [qkey]: [path, subject, title] }, shaped for lib/accounts/summary.js.
export function GET({ params }) {
  const index = Object.fromEntries(
    questionsForYear(params.year).map((q) => [
      q.qkey,
      [`/upsc/question/${q.slug}`, q.subject, q.question.split('\n')[0].trim().slice(0, 140)],
    ])
  );
  return new Response(JSON.stringify(index), { headers: { 'Content-Type': 'application/json' } });
}
