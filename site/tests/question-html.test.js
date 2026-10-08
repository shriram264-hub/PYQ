import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canonical, esc, questionHTML } from '../src/lib/question-html.js';
import { ALL_QUESTIONS, canonicalSubject } from '../src/lib/corpus.js';

// The question file as the extraction wrote it, which is what the search API
// serves: subjects under every label the extraction emitted ("Polity",
// "Environment", "Science and Technology"...), not the corpus's canonical names.
// ALL_QUESTIONS has already been through canonicalSubject, so a renderer whose
// aliases had drifted would still pass every check made with it alone.
const RAW = JSON.parse(readFileSync(new URL('../../data/questions.json', import.meta.url), 'utf-8'));

// These strings were captured from the renderer while it still lived inline in
// pages/upsc/search.astro, before it moved to lib/question-html.js. They pin the
// move: any difference in the markup the search page has always produced fails
// here. Each is one string per line, joined with a newline, so the whitespace
// the template literal produced (including a whitespace-only line) is exact.
const FIXTURES = {
  // a normal question, subject given under an alias, answer recorded, special characters in the stem
  normal: {
    input: {
      year: 2019,
      q_no: 7,
      subject: "Polity",
      subtopic: "Fundamental Rights",
      difficulty: "moderate",
      question: "Consider the following statements about Article 21 & the \"right to life\":\n1. It is available to citizens only.\n2. It can be suspended <during> Emergency.\nWhich of the statements given above is/are correct?",
      a: "1 only",
      b: "2 only",
      c: "Both 1 and 2",
      d: "Neither 1 nor 2",
      answer: "d",
      answer_note: "",
      status: "ok"
    },
    html: [
      "<article class=\"qblock\" data-qkey=\"upsc-2019-7\">",
      "      <div class=\"qhead\">",
      "        <a class=\"serial qref\" href=\"/upsc/question/2019-q7-consider-the-following-statements-about-article-21-and-the-ri\" tabindex=\"-1\">2019 · Q7</a>",
      "        <a href=\"/upsc/subject/indian-polity\">Indian Polity</a>",
      "        <span class=\"qsep\" aria-hidden=\"true\">›</span>",
      "        <a href=\"/upsc/topic/indian-polity/fundamental-rights\">Fundamental Rights</a>",
      "        <span class=\"qdiff qdiff-moderate\">moderate</span>",
      "        ",
      "      </div>",
      "      <h2 class=\"qtext\"><a href=\"/upsc/question/2019-q7-consider-the-following-statements-about-article-21-and-the-ri\">Consider the following statements about Article 21 &amp; the &quot;right to life&quot;:",
      "1. It is available to citizens only.",
      "2. It can be suspended &lt;during&gt; Emergency.",
      "Which of the statements given above is/are correct?</a></h2>",
      "      <ol class=\"qopts\"><li class=\"\"><span class=\"serial qopt-key\">(a)</span><span class=\"qopt-text\">1 only</span></li><li class=\"\"><span class=\"serial qopt-key\">(b)</span><span class=\"qopt-text\">2 only</span></li><li class=\"\"><span class=\"serial qopt-key\">(c)</span><span class=\"qopt-text\">Both 1 and 2</span></li><li class=\"is-answer\"><span class=\"serial qopt-key\">(d)</span><span class=\"qopt-text\">Neither 1 nor 2</span></li></ol>",
      "      <div class=\"qmarks\"></div>",
      "      <details class=\"qanswer\"><summary><span class=\"lbl-show\">Show answer</span><span class=\"lbl-hide\">Hide answer</span></summary>",
      "         <div class=\"qanswer-body\"><p><span class=\"field-label\">Official answer</span><strong class=\"serial\">(d)</strong> Neither 1 nor 2</p>",
      "         </div></details>",
      "    </article>",
    ].join('\n'),
  },
  // cancelled by UPSC, so no answer is recorded
  cancelled: {
    input: {
      year: 2015,
      q_no: 44,
      subject: "Science and Technology",
      subtopic: "Space Technology",
      difficulty: "easy",
      question: "Which one of the following is a communication satellite launched by ISRO?",
      a: "INSAT-4A",
      b: "Cartosat-1",
      c: "Oceansat-2",
      d: "RISAT-1",
      answer: "",
      answer_note: "",
      status: "cancelled"
    },
    html: [
      "<article class=\"qblock\" data-qkey=\"upsc-2015-44\">",
      "      <div class=\"qhead\">",
      "        <a class=\"serial qref\" href=\"/upsc/question/2015-q44-which-one-of-the-following-is-a-communication-satellite-laun\" tabindex=\"-1\">2015 · Q44</a>",
      "        <a href=\"/upsc/subject/science-and-technology\">Science &amp; Technology</a>",
      "        <span class=\"qsep\" aria-hidden=\"true\">›</span>",
      "        <a href=\"/upsc/topic/science-and-technology/space-technology\">Space Technology</a>",
      "        <span class=\"qdiff qdiff-easy\">easy</span>",
      "        <span class=\"qflag\">Cancelled by UPSC</span>",
      "      </div>",
      "      <h2 class=\"qtext\"><a href=\"/upsc/question/2015-q44-which-one-of-the-following-is-a-communication-satellite-laun\">Which one of the following is a communication satellite launched by ISRO?</a></h2>",
      "      <ol class=\"qopts\"><li class=\"\"><span class=\"serial qopt-key\">(a)</span><span class=\"qopt-text\">INSAT-4A</span></li><li class=\"\"><span class=\"serial qopt-key\">(b)</span><span class=\"qopt-text\">Cartosat-1</span></li><li class=\"\"><span class=\"serial qopt-key\">(c)</span><span class=\"qopt-text\">Oceansat-2</span></li><li class=\"\"><span class=\"serial qopt-key\">(d)</span><span class=\"qopt-text\">RISAT-1</span></li></ol>",
      "      <div class=\"qmarks\"></div>",
      "      <p class=\"qanswer-none\">No answer is recorded for this question.</p>",
      "    </article>",
    ].join('\n'),
  },
  // disputed, with a note beside the answer
  disputed: {
    input: {
      year: 2022,
      q_no: 91,
      subject: "Economy",
      subtopic: "Money & Banking",
      difficulty: "difficult",
      question: "With reference to the \"Monetary Policy Committee\" of India, consider:\n1. It has six members.\n2. Governor has a casting vote.",
      a: "1 only",
      b: "2 only",
      c: "Both 1 and 2",
      d: "Neither",
      answer: "c",
      answer_note: "UPSC key says (c); several coaching institutes argue (b) because the Governor holds a \"casting\" vote only on ties & not otherwise.",
      status: "disputed"
    },
    html: [
      "<article class=\"qblock\" data-qkey=\"upsc-2022-91\">",
      "      <div class=\"qhead\">",
      "        <a class=\"serial qref\" href=\"/upsc/question/2022-q91-with-reference-to-the-monetary-policy-committee-of-india\" tabindex=\"-1\">2022 · Q91</a>",
      "        <a href=\"/upsc/subject/indian-economy\">Indian Economy</a>",
      "        <span class=\"qsep\" aria-hidden=\"true\">›</span>",
      "        <a href=\"/upsc/topic/indian-economy/money-and-banking\">Money &amp; Banking</a>",
      "        <span class=\"qdiff qdiff-difficult\">difficult</span>",
      "        <span class=\"qflag qflag-warn\">Answer disputed</span>",
      "      </div>",
      "      <h2 class=\"qtext\"><a href=\"/upsc/question/2022-q91-with-reference-to-the-monetary-policy-committee-of-india\">With reference to the &quot;Monetary Policy Committee&quot; of India, consider:",
      "1. It has six members.",
      "2. Governor has a casting vote.</a></h2>",
      "      <ol class=\"qopts\"><li class=\"\"><span class=\"serial qopt-key\">(a)</span><span class=\"qopt-text\">1 only</span></li><li class=\"\"><span class=\"serial qopt-key\">(b)</span><span class=\"qopt-text\">2 only</span></li><li class=\"is-answer\"><span class=\"serial qopt-key\">(c)</span><span class=\"qopt-text\">Both 1 and 2</span></li><li class=\"\"><span class=\"serial qopt-key\">(d)</span><span class=\"qopt-text\">Neither</span></li></ol>",
      "      <div class=\"qmarks\"></div>",
      "      <details class=\"qanswer\"><summary><span class=\"lbl-show\">Show answer</span><span class=\"lbl-hide\">Hide answer</span></summary>",
      "         <div class=\"qanswer-body\"><p><span class=\"field-label\">Official answer</span><strong class=\"serial\">(c)</strong> Both 1 and 2</p>",
      "         <p class=\"qnote\">UPSC key says (c); several coaching institutes argue (b) because the Governor holds a &quot;casting&quot; vote only on ties &amp; not otherwise.</p></div></details>",
      "    </article>",
    ].join('\n'),
  },
};

for (const [name, { input, html }] of Object.entries(FIXTURES)) {
  test(`questionHTML renders the ${name} fixture exactly as the search page did`, () => {
    assert.equal(questionHTML(input), html);
  });
}

test('every block carries an empty qmarks slot for marks.js to fill', () => {
  for (const { input } of Object.values(FIXTURES)) {
    assert.match(questionHTML(input), /<div class="qmarks"><\/div>/);
  }
});

test('year and number reach the markup as numbers whatever the source sends', () => {
  const html = questionHTML({
    ...FIXTURES.normal.input,
    year: '2019"><script>x</script>',
    q_no: '7"><b>',
  });
  assert.doesNotMatch(html, /<script>|<b>/);
  assert.match(html, /data-qkey="upsc-NaN-NaN"/);
});

test('every text field is escaped', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const html = questionHTML({
    ...FIXTURES.disputed.input,
    subject: evil,
    subtopic: evil,
    difficulty: evil,
    question: evil,
    a: evil,
    b: evil,
    c: evil,
    d: evil,
    answer_note: evil,
    answer: evil,
  });
  assert.doesNotMatch(html, /<img/);
});

// The answer key goes into the markup twice, as "(d)" and as the option it
// picks out. Only the four keys are an answer; anything else is treated as no
// answer recorded, so it is never written into the page at all.
test('an answer that is not a, b, c or d is no answer, and is never written into the page', () => {
  const hostile = ['<img src=x onerror=alert(1)>', 'a"><script>x</script>', 'e', 'A', 'ab', ' a', 'a ', 'constructor', '__proto__'];
  const odd = [null, undefined, 1, ['a'], { toString: () => 'a' }, true];
  for (const answer of [...hostile, ...odd]) {
    const html = questionHTML({ ...FIXTURES.normal.input, answer });
    const label = JSON.stringify(String(answer));
    assert.doesNotMatch(html, /<img|<script/, label);
    assert.match(html, /<p class="qanswer-none">No answer is recorded for this question\.<\/p>/, label);
    assert.doesNotMatch(html, /is-answer|qanswer-body|undefined/, label);
  }
});

test('each of the four keys is still an answer', () => {
  for (const answer of ['a', 'b', 'c', 'd']) {
    const html = questionHTML({ ...FIXTURES.normal.input, answer });
    assert.equal(html.match(/class="is-answer"/g).length, 1, answer);
    assert.match(html, new RegExp(`<strong class="serial">\\(${answer}\\)</strong> `), answer);
  }
});

test('esc handles the four characters that matter and coerces non-strings', () => {
  assert.equal(esc('a & b < c > d "e"'), 'a &amp; b &lt; c &gt; d &quot;e&quot;');
  assert.equal(esc(7), '7');
});

// The search results link to the same pages the build generates. The renderer
// keeps its own copy of the subject aliases and slug rules (it also runs in the
// browser, where it cannot import the corpus), so this is the check that the
// copies have not drifted: for every real question, the links it renders are the
// ones the corpus builds the static pages from.
test('the renderer names every subject label the extraction emitted as the corpus does', () => {
  const labels = new Set(RAW.map((q) => q.subject));
  assert.ok(labels.has('Polity') && labels.has('Environment'), 'the raw file still carries aliased labels');
  for (const label of labels) {
    assert.equal(canonical(label), canonicalSubject(label), label);
    // The per-year files carry canonical names already: mapping one again keeps it.
    assert.equal(canonical(canonicalSubject(label)), canonicalSubject(label), label);
  }
});

test('links match the static pages, for every question as the search API sends it', () => {
  assert.equal(RAW.length, ALL_QUESTIONS.length);
  RAW.forEach((raw, i) => {
    const q = ALL_QUESTIONS[i];
    const label = `${q.qkey} (${raw.subject})`;
    assert.equal(`upsc-${raw.year}-${raw.q_no}`, q.qkey, 'RAW and ALL_QUESTIONS are in the same order');
    const html = questionHTML(raw);
    assert.ok(html.includes(`data-qkey="${q.qkey}"`), label);
    assert.ok(html.includes(`href="/upsc/question/${q.slug}"`), label);
    assert.ok(html.includes(`href="/upsc/subject/${q.subjectSlug}"`), label);
    assert.ok(html.includes(`href="/upsc/topic/${q.subjectSlug}/${q.subtopicSlug}"`), label);
    assert.ok(html.includes(`>${esc(q.subject)}</a>`), label);
  });
});

test('links match the static pages the corpus generates, for every question', () => {
  for (const q of ALL_QUESTIONS) {
    const html = questionHTML(q);
    const label = `${q.qkey}`;
    assert.ok(html.includes(`data-qkey="${q.qkey}"`), label);
    assert.ok(html.includes(`href="/upsc/question/${q.slug}"`), label);
    assert.ok(html.includes(`href="/upsc/subject/${q.subjectSlug}"`), label);
    assert.ok(html.includes(`href="/upsc/topic/${q.subjectSlug}/${q.subtopicSlug}"`), label);
  }
});
