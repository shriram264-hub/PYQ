import { YEARS, questionsForYear } from '../../../lib/corpus.js';

// One small file per exam year, built into dist/upsc/full/<year>.json: each
// question's full content, keyed by its question key. The revision page fetches
// only the years a list's questions come from, then renders them with the same
// renderer the search page uses (lib/question-html.js). A year is about 60 KB
// raw and 16 KB gzipped; one file for every question would be about 2 MB raw,
// which a student on mobile data should not pay for to revise three questions.
// The sibling ../index/<year>.json files carry just enough to name a question;
// these carry enough to show it.
export function getStaticPaths() {
  return YEARS.map(({ year }) => ({ params: { year: String(year) } }));
}

// { [qkey]: { year, q_no, subject, subtopic, difficulty, question, a, b, c, d,
//   answer, answer_note, status } } is the shape of a search API result, which
// is what questionHTML takes. The fields are listed, not spread: the corpus
// object also carries id, slug and the slug parts, which the renderer rebuilds
// from the fields below and which would only add weight to every file. The
// subject is the corpus's canonical one, so links match the static pages.
export function GET({ params }) {
  const full = Object.fromEntries(
    questionsForYear(params.year).map((q) => [
      q.qkey,
      {
        year: q.year,
        q_no: q.q_no,
        subject: q.subject,
        subtopic: q.subtopic,
        difficulty: q.difficulty,
        question: q.question,
        a: q.a,
        b: q.b,
        c: q.c,
        d: q.d,
        answer: q.answer,
        answer_note: q.answer_note,
        status: q.status,
      },
    ])
  );
  return new Response(JSON.stringify(full), { headers: { 'Content-Type': 'application/json' } });
}
