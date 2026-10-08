import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GET, getStaticPaths } from '../src/pages/upsc/full/[year].json.js';
import { YEARS, canonicalSubject } from '../src/lib/corpus.js';
import { questionHTML } from '../src/lib/question-html.js';

// The per-year full-question files (/upsc/full/<year>.json) are what the revise
// page renders from. Each entry is the search API's result shape and nothing
// more: the corpus object also carries id, slug, qkey and the slug parts, and
// letting those through would only add weight to every file a student fetches.
const FIELDS = ['year', 'q_no', 'subject', 'subtopic', 'difficulty', 'question', 'a', 'b', 'c', 'd', 'answer', 'answer_note', 'status'];

const RAW = JSON.parse(readFileSync(new URL('../../data/questions.json', import.meta.url), 'utf-8'));
const rawByKey = new Map(RAW.map((q) => [`upsc-${q.year}-${q.q_no}`, q]));

// Built exactly as the build builds it: the endpoint's own GET, for every year it lists.
const files = await Promise.all(
  getStaticPaths().map(async ({ params }) => [params.year, await GET({ params }).json()])
);

test('there is one file per year, holding every question of that year', () => {
  assert.deepEqual(files.map(([year]) => Number(year)), YEARS.map((y) => y.year));
  for (const [year, file] of files) {
    assert.equal(Object.keys(file).length, YEARS.find((y) => y.year === Number(year)).count, year);
  }
});

test('every entry has exactly the 13 fields, in order, and no id, slug or key', () => {
  for (const [, file] of files) {
    for (const [key, entry] of Object.entries(file)) {
      assert.deepEqual(Object.keys(entry), FIELDS, key);
      for (const extra of ['id', 'slug', 'qkey', 'subjectSlug', 'subtopicSlug']) assert.ok(!(extra in entry), `${key} ${extra}`);
    }
  }
});

test('every entry is filed under its own key, with numbers as numbers, text as text, and the canonical subject', () => {
  for (const [year, file] of files) {
    for (const [key, entry] of Object.entries(file)) {
      assert.equal(key, `upsc-${year}-${entry.q_no}`);
      assert.equal(entry.year, Number(year), key);
      assert.ok(Number.isInteger(entry.year) && Number.isInteger(entry.q_no), key);
      for (const field of FIELDS.slice(2)) assert.equal(typeof entry[field], 'string', `${key} ${field}`);
      // The canonical name, as the static pages use: the revise page's subjects
      // line counts by it, and an alias would make one subject two.
      assert.equal(entry.subject, canonicalSubject(entry.subject), key);
    }
  }
});

test('a question looks the same on the revise page as in search results', () => {
  for (const [, file] of files) {
    for (const [key, entry] of Object.entries(file)) {
      assert.equal(questionHTML(entry), questionHTML(rawByKey.get(key)), key);
    }
  }
});
