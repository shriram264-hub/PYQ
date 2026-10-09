# New Subjects and Topics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the extracted subject and topic labels with the owner-approved taxonomy (11 subjects, 116 topics), consistently across data, the search index, the API and the site. Old addresses forward to their new homes.

**Architecture:**
- A committed mapping (`data/taxonomy.json`) is applied by the extraction pipeline, which fails on any deviation. The search index is rebuilt from the relabelled data.
- The site loses its alias tables, since the data is canonical.
- A frozen list of removed addresses (`data/legacy-urls.json`) drives static forwarding pages, verified by the link checker.

**Tech Stack:** Python 3.12 (pypdf, sentence-transformers, pytest) for `data/`, Astro 7 and `node:test` for `site/`, FastAPI backend (no code change).

**Spec:** `docs/superpowers/specs/2026-10-10-subject-taxonomy-design.md`. Categories, names and counts come from `docs/superpowers/specs/2026-10-10-subject-taxonomy-proposal.md` (both owner-approved 2026-10-10). The approved per-question result is produced by the frozen generator `C:\Users\shrir\AppData\Local\Temp\claude\C--Users-shrir-Downloads-UPSC-project\7252f56d-4445-4291-ac44-3c8ab2940d5d\scratchpad\taxonomy-approved.cjs`. It reads `data/questions.json` from the worktree, so run it against the **pre-change** data. That data is `git show a2f3a17:data/questions.json`, today's live master.

**Branch:** `taxonomy` in `C:\Users\shrir\Downloads\UPSC_project\.claude\worktrees\accounts` (from live master a2f3a17). Run git there, npm in `site/`, Python in `data/scripts/`. Never push.

## Global Constraints

- **Counts.** Final per-subject counts must be exactly: Science & Technology 670, Indian Economy 621, Geography 544, Indian Polity 422, Environment & Ecology 385, Current Affairs 353, Modern History 324, Reasoning & Aptitude 253, Art & Culture 220, Ancient History 101, Medieval History 88. That is 3,981 in total, in 116 topics, none with fewer than 5 questions.
- **Only labels change.** Only `subject` and `subtopic` may change in `data/questions.json`. Every other field of every record, and the record order, stay byte-identical. `id` stays as the pipeline assigns it.
- **Every 3,981-row assignment equals the approved generator's output.**
- **No aliases afterwards.** The raw aliases (`Polity`, `Economy`, `Environment`, `Science and Technology`, `Science`) map straight to approved names in `taxonomy.json`. The site keeps no alias table afterwards.
- **Search index.** `data/embeddings.npy` row count equals the question count.
- **Search quality is checked** before shipping: old index against new index on the spec's queries, and recorded.
- **Forwarding pages.** Each one has `<meta http-equiv="refresh" content="0; url=…">`, `<link rel="canonical">` to the new address, an inline `location.replace` that keeps query and hash, and a visible link. No `noindex`, and they are not in the sitemap.
- **Checks.** `npm test`, `npm run build` and `node scripts/check-links.mjs` must pass. The design detector on changed UI files must report `[]`.
- **Commits.** Conventional commits, each ending with a blank line and then `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.
- **Avoiding stalls.** Earlier helpers stalled, so run every long or headless command with a hard timeout and put servers in the background, killed afterwards. Scratch files go in the session scratchpad, never the repo.

## File structure

| Path | Responsibility | Task |
|---|---|---|
| `data/taxonomy.json` | The approved mapping: `subjects`, `allowed`, `topics`, `questions` | 1 |
| `data/scripts/extract_questions.py` | `apply_taxonomy()` after corrections, plus validations | 1 |
| `data/tests/test_taxonomy.py` | pytest for `apply_taxonomy` | 1 |
| `data/questions.json`, `data/questions.csv` | Regenerated with the new labels | 1 |
| `data/embeddings.npy` | Rebuilt | 2 |
| `site/src/lib/corpus.js`, `site/src/lib/question-html.js`, `site/src/scripts/revise-page.js`, `site/tests/*.test.js` | Aliases removed, tests updated | 3 |
| `PRODUCT.md` | Corpus numbers updated | 3 |
| `site/scripts/legacy-urls.mjs` | One-off generator of `data/legacy-urls.json` from old and new data | 4 |
| `data/legacy-urls.json` | Frozen list: old address → new address | 4 |
| `site/src/lib/legacy.js` | Pure destination rule (majority, tie-break, page fallback) | 4 |
| `site/src/pages/[...legacy].astro` | Forwarding pages | 4 |
| `site/scripts/check-links.mjs` | Also verifies forwarding pages | 4 |

---

### Task 1: The mapping and the data pipeline

**Files:**
- Create: `data/taxonomy.json`, `data/tests/test_taxonomy.py`
- Modify: `data/scripts/extract_questions.py`, `data/questions.json`, `data/questions.csv` (regenerated)

**Interfaces:**
- **Produces:** `data/taxonomy.json`:

```json
{
  "subjects": ["Science & Technology", "…11 names…"],
  "allowed": [["Science & Technology", "Physics"], "…116 pairs…"],
  "topics": { "Polity|Fundamental Duties": ["Indian Polity", "Fundamental Rights & Duties"], "…": ["…", "…"] },
  "questions": { "2022-71": ["Indian Economy", "Human Development, Poverty & Employment Schemes"], "…16 entries…": [] }
}
```

  - `topics` keys use the **raw extracted subject** (as in the PDF, e.g. `Polity`, `Science`), a `|`, then the raw topic.
  - Every raw pair in the extracted data must have an entry, including pairs that keep their name. Identity pairs map raw aliases to approved names too, e.g. `"Polity|Judiciary": ["Indian Polity", "Judiciary"]`. This makes the mapping total and explicit.
  - `questions` overrides apply only when that question's raw pair is in `topics` with a *different* destination than its own name. Copy the generator's `O` semantics: an override applies when the canonical pair is in the generator's `T` table.
- **Produces:** `apply_taxonomy(questions: list[dict], taxonomy: dict) -> Counter`. It mutates `subject` and `subtopic` in place and returns the per-subject counts. It calls `sys.exit(message)` when:
  - a raw pair has no `topics` entry;
  - a result is not in `allowed`;
  - an allowed topic has fewer than 5 questions;
  - a subject in the result is not in `subjects`.

- [ ] **Step 1: Generate the expected assignment.** First extract the pre-change data to scratch with `git show a2f3a17:data/questions.json`, and point the generator at it (edit a copy's `require` path, in scratch). Run the frozen generator `taxonomy-approved.cjs` and save, in scratch, `expected.json` = `{ "<year>-<q_no>": ["<subject>", "<topic>"] }` for all 3,981 rows. From the same run, build the `topics`, `questions`, `subjects` and `allowed` content for `data/taxonomy.json`:
  - `topics` covers every raw `(subject, subtopic)` pair in the old data.
  - Its destination is the generator's `T` entry for the canonical subject, else the identity with the canonical subject name.
- [ ] **Step 2: Write the failing pytest.** In `data/tests/test_taxonomy.py`, import `apply_taxonomy` from `data/scripts/extract_questions.py` (add `data/scripts` to `sys.path` in the test).

```python
import sys, pytest
from collections import Counter
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'scripts'))
from extract_questions import apply_taxonomy

TAX = {
    "subjects": ["A", "B"],
    "allowed": [["A", "x"], ["B", "y"]],
    "topics": {"Raw|x": ["A", "x"], "Raw|old": ["B", "y"], "Other|z": ["A", "x"]},
    "questions": {"2020-2": ["A", "x"]},
}

def q(year, n, s, t):
    return {"year": year, "q_no": n, "subject": s, "subtopic": t}

def five(s, t, start=100):
    return [q(2000, start + i, s, t) for i in range(5)]

def test_maps_pairs_and_applies_overrides_only_inside_remapped_pairs():
    qs = five("Raw", "x") + five("Raw", "old", 200) + [q(2020, 2, "Raw", "old"), q(2020, 3, "Other", "z")]
    counts = apply_taxonomy(qs, TAX)
    assert qs[-2]["subject"] == "A" and qs[-2]["subtopic"] == "x"   # override applied (Raw|old is remapped)
    assert qs[5]["subject"] == "B" and qs[5]["subtopic"] == "y"
    assert counts == Counter({"A": 7, "B": 5})

def test_unmapped_pair_fails():
    with pytest.raises(SystemExit, match="no taxonomy mapping"):
        apply_taxonomy(five("Raw", "x") + [q(2001, 1, "Raw", "new")], TAX)

def test_result_outside_allowed_fails():
    bad = {**TAX, "topics": {**TAX["topics"], "Raw|x": ["A", "nope"]}}
    with pytest.raises(SystemExit, match="not an approved"):
        apply_taxonomy(five("Raw", "x"), bad)

def test_small_topic_fails():
    with pytest.raises(SystemExit, match="fewer than 5"):
        apply_taxonomy(five("Raw", "x") + [q(2001, 9, "Raw", "old")], TAX)
```

- [ ] **Step 3: Run it and see it fail.** Run `python -m pytest data/tests/test_taxonomy.py -q` from the worktree root. Expect an import error, or a missing `apply_taxonomy`.
- [ ] **Step 4: Implement** `apply_taxonomy` in `extract_questions.py`. In `main()`, call it after `apply_corrections` with `json.loads((out / "taxonomy.json").read_text(encoding="utf-8"))`, before ids are assigned and the files are written. Print the per-subject counts.
  - Error message wording must include the phrases the tests match: "no taxonomy mapping", "not an approved", "fewer than 5". Each message also names the year, Q number and pair, or the topic.
  - A subject not in `subjects` must fail too.
- [ ] **Step 5: Write `data/taxonomy.json`** from Step 1's content, with readable formatting (one pair per line where practical). Run `python -m pytest data/tests -q`, which should be green.
- [ ] **Step 6: Regenerate.** From `data/scripts`, run `python extract_questions.py ../question_bank.pdf`, with a timeout of about 10 minutes. Then verify, with a scratch script, comparing to `git show a2f3a17:data/questions.json`:
  - **Fields:** every record is identical except `subject` and `subtopic`, and the order and count are unchanged.
  - **Assignments:** every record's `(subject, subtopic)` equals `expected.json`.
  - **Counts:** the per-subject counts equal the Global Constraints.
  - **Problems:** `problems.txt` is unchanged from master.
  Record the outputs in the report.
- [ ] **Step 7: Commit.** `feat(data): relabel questions with the approved subjects and topics`. This covers `taxonomy.json`, the script, the test, `questions.json` and `questions.csv`.

---

### Task 2: Rebuild the search index, and check search quality

**Files:**
- Modify: `data/embeddings.npy` (rebuilt)

**Interfaces:**
- **Consumes:** Task 1's `data/questions.json`.

- [ ] **Step 1: Keep the old index.** Copy `git show a2f3a17:data/embeddings.npy` and the old `questions.json` to scratch.
- [ ] **Step 2: Rebuild.** From `data/scripts`, run `python build_index.py`, with a timeout of about 15 minutes. Confirm the row count is 3,981, and that `backend/app/data.py`'s assert would hold: load both files in a scratch script and compare lengths.
- [ ] **Step 3: Spot-check quality.**
  - Write a scratch script that loads `BAAI/bge-small-en-v1.5` (sentence-transformers) and embeds each query with the backend's prefix `"Represent this sentence for searching relevant passages: "`, normalised.
  - Rank old and new questions by dot product. The backend also adds `0.15 × keyword_score`; replicate that from `backend/app/search.py` so results match production. Use the question's own fields for the keyword text, which do not change.
  - Queries: *Indus Valley civilisation*, *El Nino and the monsoon*, *Fundamental Rights*, *inflation targeting*, *tiger reserves*, *Sufi saints*, *compound interest*, *Grand Slam tennis*, *Mughal administration*, *ozone layer*.
  - For each query, record the top 10 old and new as `year-q_no` with a short title, and the overlap count.
  - **Acceptance:** for each query, at least 7 of the old top 10 remain in the new top 10, or the new results are at least as on-topic, judged by reading them. Write the judgement per query in the report. If any query clearly degrades, stop and report DONE_WITH_CONCERNS with the evidence. Don't tune anything.
- [ ] **Step 4: Run the backend tests.** From `backend/`, run `python -m pytest -q`. They load the data and embeddings.
- [ ] **Step 5: Commit.** `feat(data): rebuild the search index for the new subjects and topics`

---

### Task 3: Site: one set of names

**Files:**
- Modify: `site/src/lib/corpus.js`, `site/src/lib/question-html.js`, `site/src/scripts/revise-page.js`, `site/tests/question-html.test.js`, `site/tests/full-file.test.js`, `PRODUCT.md`

**Interfaces:**
- **Consumes:** Task 1's data.
- **Produces:** the corpus no longer exports `canonicalSubject`. `question-html.js` no longer exports `canonical`, and uses `q.subject` directly.

- [ ] **Step 1: Update the tests first.**
  - Replace the alias tests in `question-html.test.js` (the raw-label drift test and `canonical(...)` assertions) with a test that the corpus holds only approved subjects. Read `data/taxonomy.json` `subjects` and assert every `ALL_QUESTIONS` subject is in it, with exactly 11 distinct subjects. Keep the test that renders every corpus question and checks its subject and topic links resolve to the corpus slugs.
  - In `full-file.test.js`, replace the `canonicalSubject` assertion with "subject is in the approved list".
  - Run them and see them fail: the import of `canonicalSubject` / `canonical` still exists, or the new assertion fails before the data is final. Note what you saw.
- [ ] **Step 2: Remove the aliases.** Delete `SUBJECT_ALIASES` / `canonicalSubject` from `corpus.js`, and use `q.subject` directly. Delete `ALIASES` / `canonical` from `question-html.js`, and use `q.subject`. In `revise-page.js`, replace `canonical(entry.q.subject)` with `entry.q.subject`. Grep the whole `site/src` and `site/tests` for `canonical`, `ALIASES` and any hand-written subject list; there should be none left.
- [ ] **Step 3: Update `PRODUCT.md`'s corpus paragraph** with the new numbers: 3,981 questions, 1995–2026, 11 subjects, 116 subject and topic pairs, none under 5. Replace the canonicalisation note with "labels follow `data/taxonomy.json`". Keep the rest of the file.
- [ ] **Step 4: Verify.**
  - `npm test`, `npm run build` and `node scripts/check-links.mjs`.
  - In `dist/upsc/search/index.html`, the subject `<select>` lists exactly the 11 subjects.
  - `dist/upsc/subject/reasoning-and-aptitude/index.html` exists.
  - The /upsc cover shows the new subject count.
  - Note in the report how many subject and topic pages the build has (`dist/upsc/topic/**`). Old addresses are Task 4's job, so check-links passing now proves no internal link still points at a removed page.
- [ ] **Step 5: Commit.** `refactor(site): one set of subject names, from the data`

---

### Task 4: Old addresses forward to their new homes

**Files:**
- Create: `site/scripts/legacy-urls.mjs`, `data/legacy-urls.json`, `site/src/lib/legacy.js`, `site/tests/legacy.test.js`, `site/src/pages/[...legacy].astro`
- Modify: `site/scripts/check-links.mjs`

**Interfaces:**
- **Produces:** `site/src/lib/legacy.js` (pure):
  - `destinationOf(counts: Map<string,number>): string`. Returns the key with the highest count; ties go to the alphabetically first key (`localeCompare('en')`).
  - `pagedDestination(sourcePage: number, destPath: string, destPages: number): string`. Returns `destPath` when `sourcePage <= 1` or `sourcePage > destPages`, else `${destPath}/${sourcePage}`.
- **Produces:** `data/legacy-urls.json`, of the form `{ "<old path>": "<new path>", … }`. Paths start with `/upsc/`, without a trailing slash, for example `"/upsc/topic/indian-polity/fundamental-duties": "/upsc/topic/indian-polity/fundamental-rights-and-duties"`.

- [ ] **Step 1: Write the failing test** for `legacy.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { destinationOf, pagedDestination } from '../src/lib/legacy.js';

test('destination is where most questions went; ties go alphabetically', () => {
  assert.equal(destinationOf(new Map([['/b', 3], ['/a', 1]])), '/b');
  assert.equal(destinationOf(new Map([['/b', 2], ['/a', 2]])), '/a');
});

test('a page number survives only if the destination has that page', () => {
  assert.equal(pagedDestination(1, '/upsc/subject/x', 4), '/upsc/subject/x');
  assert.equal(pagedDestination(3, '/upsc/subject/x', 4), '/upsc/subject/x/3');
  assert.equal(pagedDestination(9, '/upsc/subject/x', 4), '/upsc/subject/x');
});
```

  Run it, see it fail, implement `legacy.js`, and run it again until it passes.
- [ ] **Step 2: Write the generator** `site/scripts/legacy-urls.mjs`. It is run once by hand as `node scripts/legacy-urls.mjs <old questions.json>`, with the old file from `git show a2f3a17:data/questions.json` saved to scratch.
  - It reproduces the **old** site's addresses. It applies the old alias table, frozen inside the script with a comment saying why: Polity→Indian Polity, Economy→Indian Economy, Environment→Environment & Ecology, Science and Technology→Science & Technology, Science→Science & Technology. It also uses the site's `slugify` from `site/src/lib/corpus.js`, and the same page size as the pages (25: subject pages use `PAGE_SIZE`; check the topic route's page size and use it).
  - **Old addresses:**
    - subject pages: `/upsc/subject/<slug>` and `/<slug>/<n>` for n = 2..pages;
    - topic pages: `/upsc/topic/<subjectSlug>/<topicSlug>` and `/n`.
  - **New addresses:** computed the same way from the current `data/questions.json`, without aliases.
  - **Entry rule.** For each old address that is not a new address:
    - destination = `pagedDestination(page, destinationOf(where its questions now live), destPages)`;
    - for a subject page, "where they live" is the new subject page;
    - for a topic page, it is the new topic page.
  - **Output.** Write `data/legacy-urls.json`, keys sorted. Print how many entries there are by kind.
- [ ] **Step 3: Add the forwarding pages** in `site/src/pages/[...legacy].astro`:
  - `getStaticPaths` reads `data/legacy-urls.json` and returns `{ params: { legacy: '<old path without leading slash>' }, props: { to } }` for each entry.
  - The page renders through the existing `Document` layout (see `site/src/pages/search.astro` for the pattern). Use the title "Moved" and a short description.
  - In `<head>`, include the meta refresh, the canonical, and `<script is:inline>location.replace(to + location.search + location.hash)</script>`. If the layout has no head slot for meta, use the `head` slot added during the accounts work (`<slot name="head" />` in `Document.astro`).
  - The body shows a one-line link: "This page has moved: <a href={to}>…new title…</a>". Plain "the new page" is acceptable if a title is awkward.
  - No `noindex`. Make sure these pages are **not** in `sitemap.xml.js`; the sitemap is built from corpus data, so confirm.
- [ ] **Step 4: Extend `check-links.mjs`** (after the existing check):
  - load `../data/legacy-urls.json`;
  - for each entry, assert a built forwarding page exists at the old path and the destination resolves to a real page that is not itself a forwarding page;
  - fail with a clear list otherwise;
  - print the count.
- [ ] **Step 5: Verify.**
  - Run `npm test`, `npm run build`, `node scripts/check-links.mjs`, and the detector on `[...legacy].astro`.
  - **Headless check** (bounded, background server, killed afterwards):
    - `/upsc/topic/indian-polity/fundamental-duties` lands on `/upsc/topic/indian-polity/fundamental-rights-and-duties`;
    - `/upsc/subject/sports` lands on `/upsc/subject/current-affairs`;
    - an old Science & Technology page number beyond the new count lands on the first page;
    - a query string survives.
  - **Live search filter check** (bounded, against the production API with `--disable-web-security` as earlier tasks did): note that the live API still has old labels until publish. So instead verify against a locally run backend: from `backend/`, run `uvicorn app.main:app` in the background with a timeout, and point the built search page at it, or call `/api/search?q=&subject=Indian%20Polity&top=200` directly. Assert that the total for Indian Polity equals 422, and includes `2017-16` (formerly "Polity › Local Government").
- [ ] **Step 6: Commit.** `feat(site): old subject and topic addresses forward to their new homes`

---

## Self-review (writer's checklist, done)

- **Spec coverage.**
  - §1: the mapping file, pipeline validations, embeddings, spot-check (Tasks 1 and 2).
  - §2: aliases removed, generated pages, the filter fix (Task 3; filter verified in Task 4 Step 5).
  - §3: legacy list, forwarding pages, check-links (Task 4).
  - §4: no migration, backend unchanged, PRODUCT.md (Task 3). Publish timing is the owner's.
  - Testing: covered in each task.
- **Names.**
  - `apply_taxonomy`, `taxonomy.json` keys (`subjects`, `allowed`, `topics`, `questions`)
  - `destinationOf`, `pagedDestination`
  - `legacy-urls.json`
  - `[...legacy].astro`
