// One question as a block of markup. Used in the browser by the search page (to
// show API results) and the revision page (to show a list's questions from the
// per-year files), so a question looks the same wherever it appears. Pure: a
// string in, a string out, no DOM, so it can be tested under node.
//
// The input is the search API's result shape, which is also the shape of an
// entry in /upsc/full/<year>.json:
//   { year, q_no, subject, subtopic, difficulty, question, a, b, c, d,
//     answer, answer_note, status }

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Same rule as slugify in lib/corpus.js. Duplicated, not imported: corpus.js
// reads the question file from disk at build time and cannot run in a browser.
// tests/question-html.test.js checks the two have not drifted apart.
const slugify = (v) =>
  String(v).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The extraction emitted several labels for one subject; the static pages are
// built from the canonical names, so links must use the same mapping.
const ALIASES = {
  Polity: 'Indian Polity',
  Economy: 'Indian Economy',
  Environment: 'Environment & Ecology',
  'Science and Technology': 'Science & Technology',
  Science: 'Science & Technology',
};
const canonical = (s) => ALIASES[s] || s;

export function questionHTML(q) {
  // Year and number go into attributes and the address unescaped, so they
  // are made numbers first: whatever the API sends, only digits reach the page.
  const year = Number(q.year);
  const qNo = Number(q.q_no);
  const subject = canonical(q.subject);
  const sSlug = slugify(subject);
  const tSlug = slugify(q.subtopic);
  const qSlug = `${year}-q${qNo}-${slugify(String(q.question).slice(0, 60))}`;
  const opts = ['a', 'b', 'c', 'd']
    .map(
      (k) =>
        `<li class="${q.answer === k ? 'is-answer' : ''}"><span class="serial qopt-key">(${k})</span><span class="qopt-text">${esc(q[k])}</span></li>`
    )
    .join('');

  const flags = [
    q.status === 'cancelled' ? '<span class="qflag">Cancelled by UPSC</span>' : '',
    q.status === 'disputed' ? '<span class="qflag qflag-warn">Answer disputed</span>' : '',
  ].join('');

  const answer = q.answer
    ? `<details class="qanswer"><summary><span class="lbl-show">Show answer</span><span class="lbl-hide">Hide answer</span></summary>
         <div class="qanswer-body"><p><span class="field-label">Official answer</span><strong class="serial">(${q.answer})</strong> ${esc(q[q.answer])}</p>
         ${q.answer_note ? `<p class="qnote">${esc(q.answer_note)}</p>` : ''}</div></details>`
    : `<p class="qanswer-none">No answer is recorded for this question.</p>`;

  return `<article class="qblock" data-qkey="upsc-${year}-${qNo}">
      <div class="qhead">
        <a class="serial qref" href="/upsc/question/${qSlug}" tabindex="-1">${year} · Q${qNo}</a>
        <a href="/upsc/subject/${sSlug}">${esc(subject)}</a>
        <span class="qsep" aria-hidden="true">›</span>
        <a href="/upsc/topic/${sSlug}/${tSlug}">${esc(q.subtopic)}</a>
        <span class="qdiff qdiff-${esc(q.difficulty)}">${esc(q.difficulty)}</span>
        ${flags}
      </div>
      <h2 class="qtext"><a href="/upsc/question/${qSlug}">${esc(q.question)}</a></h2>
      <ol class="qopts">${opts}</ol>
      <div class="qmarks"></div>
      ${answer}
    </article>`;
}
