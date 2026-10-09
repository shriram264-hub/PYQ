# New subjects and topics: design

Date: 2026-10-10
Status: Approved in conversation (categories, data and search, pages and old addresses); this spec is for the owner's review
Categories: `docs/superpowers/specs/2026-10-10-subject-taxonomy-proposal.md` (owner-approved 2026-10-10). It is the source of every name and count below.

## Goal

Replace the extracted subject and topic labels with the approved taxonomy:
- 11 subjects (from 13) and 116 topics (from 203), with no topic under 5 questions.
- **Reasoning & Aptitude** becomes a subject of its own.
- Every part of the system uses the same names: the site, the search API, the search filter and the search index.
- Every old subject or topic address still leads somewhere.

## Non-goals

- Changing question text, answers, keys, years or numbering.
- Any change to accounts, sync, marks or lists. Question keys are `<exam>-<year>-<n>` and never involve subjects.
- Re-designing the subject and topic pages. They render as today, with new data.
- Analytics. Part 2 will build on these categories.

## 1. The mapping and the data build

- **`data/taxonomy.json`** (new, committed) holds the approved mapping:
  - `topics`: `"<old subject as extracted>|<old topic>" → ["<new subject>", "<new topic>"]`, covering every pair that occurs in the extracted data. The raw aliases (`Polity`, `Economy`, `Environment`, `Science and Technology`, `Science`) map directly to the new names, so no alias table is needed anywhere afterwards.
  - `questions`: `"<year>-<q_no>" → ["<new subject>", "<new topic>"]`, the 16 questions placed one by one. These apply only to questions whose old pair is in `topics`, as in the proposal.
  - `subjects`: the 11 approved subject names. `allowed`: the 116 approved `[subject, topic]` pairs.
- **`data/scripts/extract_questions.py`** applies the taxonomy after `apply_corrections()`, before writing `questions.json` and `questions.csv`. It **fails the run** if:
  - a question's old pair has no mapping and isn't an identity pair in `allowed`;
  - any output pair is outside `allowed`;
  - any allowed topic ends up with fewer than 5 questions;
  - the total count changes.
  It prints the per-subject counts. They must equal the proposal's: Science & Technology 670, Indian Economy 621, Geography 544, Indian Polity 422, Environment & Ecology 385, Current Affairs 353, Modern History 324, Reasoning & Aptitude 253, Art & Culture 220, Ancient History 101, Medieval History 88.
- **The proposal's generator** (a scratch script) is the reference. The committed mapping must reproduce its exact per-question result: same 3,981 rows, same destinations.
- **`data/embeddings.npy` is rebuilt** with `data/scripts/build_index.py`, which embeds `"<subject> - <subtopic>. <question> Options: …"`. The row count must still equal the question count (the backend asserts this).
- **Search quality spot-check.** Before shipping, run the same 8–10 real queries against the old and new index and record the top results side by side: e.g. *Indus Valley civilisation*, *El Nino and the monsoon*, *Fundamental Rights*, *inflation targeting*, *tiger reserves*, *Sufi saints*, *compound interest*, *Grand Slam*. Expect the relevant questions to stay near the top. Large losses block the release.

## 2. Site

- **Aliases removed.** `SUBJECT_ALIASES` / `canonicalSubject` in `site/src/lib/corpus.js` and `ALIASES` / `canonical` in `site/src/lib/question-html.js` become unnecessary.
  - Remove them, or reduce them to identity with a test proving the data holds only approved subject names.
  - The drift and alias tests from the signed-in work are updated to match: the corpus now holds only approved names, and the renderer must still produce correct links from API results.
- **Generated pages.** Subject pages, topic pages, the sitemap, the search filter's subject list, the /upsc cover's counts, the per-year index and full files, and every subject or topic link on question pages are all generated from the data. They change automatically. No hand-written subject lists remain; grep to confirm.
- **Search filter bug fixed.** Today the filter sends a tidied name such as "Indian Polity" while the API holds raw labels such as "Polity". Once the API data uses the approved names, every filter value matches.

## 3. Old addresses

- **`data/legacy-urls.json`** (new, committed) is generated once, at the time of the change, from the **old** `questions.json`. It lists every subject and topic URL that existed before and won't exist after, each with its new destination:
  - **An old subject page that disappears** (`international-relations`, `governance`, `sports`) goes to the subject that took most of its questions.
  - **An old topic page** goes to the new topic that took most of its questions. A tie goes to the alphabetically first destination.
  - **An old paginated page** (`/2`, `/3`, …) goes to the same page number of the destination if that page exists, else to the destination's first page. This covers Science & Technology's later pages, which disappear.
  - **Unchanged addresses** are not listed.
- **Forwarding pages.** The site builds one at each listed old address, the same way as today's `/search` page:
  - The `<head>` holds `<meta http-equiv="refresh" content="0; url=…">`, `<link rel="canonical" href="…">` to the new address, and an inline `location.replace(…)` keeping any query or hash.
  - The page shows a one-line visible link to the new home.
  - These pages are not in the sitemap. They do **not** carry `noindex`, because the canonical plus the instant refresh tell search engines the address moved.
- **`node scripts/check-links.mjs` is extended.** It fails if any forwarding page points at an address that isn't built, and checks that every old subject or topic address that existed before the change (from `legacy-urls.json` plus the unchanged ones) resolves to a built page.

## 4. Students and other effects

- **No data migration.** Marks and lists are keyed by question. The "By subject" table on /account and the subjects line on /revise and on cards show the new names after the next visit.
- **Backend.** No code change. The `render.yaml` buildFilter already redeploys the API when `data/questions.json` or `data/embeddings.npy` change.
- **Brief disagreement during deploy.** The static site and the API deploy separately from the same push, so for a few minutes their subject names may differ and a subject filter could return nothing. Publish at a quiet time; the owner approves the push.
- **Product docs.** PRODUCT.md's corpus description (currently "13 subjects … 203 subject+subtopic pairs … 82 of those hold fewer than 5") is updated to the new numbers.

## Testing

- **Pipeline.** The validations in section 1 run on every extract. A small Python test covers `apply_taxonomy` with fixtures: an unmapped pair fails, an out-of-list pair fails, an override applies only within a mapped pair, and the counts are checked.
- **Mapping equals the approved proposal.** A test, or a one-off committed check script, compares the committed `taxonomy.json` result per question against the proposal's generator output (all 3,981 rows identical).
- **Site.** `npm test` with updated alias and drift tests, the build, and the extended `check-links`. A unit test covers the legacy-URL destination rule: majority, tie-break, page-number fallback.
- **Search.** The spot-check in section 1, recorded in the implementation report.
- **Browser.** A few old addresses forward correctly in a real browser: a merged topic, a removed subject, and a dropped Science & Technology page number. The search filter for Indian Polity returns the questions formerly labelled "Polity".
