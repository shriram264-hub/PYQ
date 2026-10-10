import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GET, getStaticPaths } from '../src/pages/upsc/full/[year].json.js';
import { PAPERS } from '../src/lib/papers.js';
import { paperKeys } from '../src/lib/tests/build.js';

// The papers list and the start screen say how many questions a paper has
// (PAPERS, worked out at build time from the corpus); the test screen serves
// the questions paperKeys picks out of the year's full file. Two routes to one
// number: if they drift, a student is promised 98 questions and sits 100.

// Built exactly as the build builds them: the endpoint's own GET, for every year it lists.
const files = new Map(
  await Promise.all(getStaticPaths().map(async ({ params }) => [Number(params.year), await GET({ params }).json()]))
);

test('there is a paper for every year with a full file, and no other', () => {
  assert.deepEqual(
    PAPERS.map((p) => p.year).sort((a, b) => a - b),
    [...files.keys()].sort((a, b) => a - b)
  );
});

test("every paper's advertised question count is the number of questions the test serves", () => {
  for (const { year, questions } of PAPERS) {
    assert.equal(questions, paperKeys(year, files.get(year)).length, String(year));
  }
});
