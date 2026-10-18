# Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Your analytics" page per exam, an accuracy and coverage line on subject and topic pages, and a "wrong answers" revise mode, all computed in the browser from the tests and marks students already save.

**Architecture:**
- **Pure rules.** These live in `site/src/lib/`: a per-exam settings source (`exam-rules.js`) and an analytics module (`lib/tests/analytics.js`), both unit-tested under `node --test`.
- **Catalogue.** The existing question catalogue (`/upsc/catalogue.json`) gains each question's official answer, so right and wrong can be told without the year files.
- **Pages.** Three thin page scripts draw from those rules: the analytics page, the subject and topic line, and the Revise wrong-answers mode. They follow the conventions of the test pages: gate, font wait, loader with timeout and Try again, colophon held while loading.

**Tech Stack:** Astro 7 static site, vanilla ES modules, `node:test`, headless Chrome via puppeteer-core for browser checks.

**Spec:** `docs/superpowers/specs/2026-10-18-analytics-design.md` (owner-approved 2026-10-18). Read it first: it is the authority, and its "Definitions" section fixes every number.

## Global Constraints

- **Everything is computed in the browser** from this device's stored attempts and marks. There is no new server, no new database table, and no server-side computation on student data.
- **Signed out, it works on this device. Signed in, it covers every device** through the existing sync of attempts and marks. The analytics page asks for a full pull when signed in (`data-sync-full`), as /account and /upsc/test do.
- **Exam-neutral:**
  - All exam-specific numbers come from one per-exam settings source (`site/src/lib/exam-rules.js`). Tests' scoring uses it too.
  - Paths are `/{exam}/…`.
  - Nothing in the analytics code names UPSC except the settings entry and the route files.
- **Paid later, free now.** Viewing analytics, including the subject and topic line, goes through one access check, `canSeeAnalytics(exam)` in `site/src/lib/tests/access.js`. It returns true during the beta. Nothing else gates analytics.
- **Page weight:**
  - Question pages load nothing new.
  - Subject and topic pages load nothing new for a visitor with no test attempts and no marks on this device.
  - For a student with data, these pages fetch at most the catalogue (about 17 KB gzipped, cached by the browser). They never fetch the year files.
- **No layout shift.** Nothing drawn after first paint may move what the reader can already see, on the analytics page or on subject and topic pages. Measure at 360, 390 and 1280 px, in light and dark.
- **Design:** follow DESIGN.md. That means:
  - tokens only and square corners;
  - no Unicode glyph icons, including arrows;
  - contrast ≥ 4.5:1 in both themes;
  - exactly one filled-green action per page;
  - colour is never the only signal: numbers are always written out.
- **Text rendering.** Everything from storage or fetched files is rendered via `textContent` or the shared escaper.
- **Progressive enhancement.** The analytics page carries a `<noscript>` line. Subject and topic pages are unchanged without JavaScript.
- **Accessibility.** The chart has a text equivalent: a list or table of the same scores.
- **Privacy.** Analytics stores nothing new and sends nothing anywhere. If any task finds that untrue, it stops and reports.
- **Checks.** These must pass:
  - `npm test`;
  - the build;
  - `node scripts/check-links.mjs`;
  - the detector `C:\Users\shrir\.claude\skills\impeccable\scripts\impeccable.cmd detect --json <files>`, reporting `[]` on changed pages. The homepage `.slot::after` finding is a sanctioned exception.
- **Never mention UnlockIAS.**

**Working rules (this repo, this machine):**
- Work in `C:\Users\shrir\Downloads\UPSC_project\.claude\worktrees\accounts` on branch `analytics`.
- Run tests from `site/` (`npm --prefix site test`). Give the build a long timeout.
- Keep shell commands simple: no `cd … &&` chains, no `$(…)`.
- WIP-commit before builds and long headless runs. Give every headless script a hard in-script timeout. Never run mutation checks by editing source in place.
- Headless checks use puppeteer-core from the session scratchpad `capture/` folder, served with `node serve.mjs <dist> <port>` (port 4327 is taken). Chrome is at `C:/Program Files/Google/Chrome/Application/chrome.exe`. Scripts and screenshots stay in that folder, never in the repo.
- Use conventional commits with the Co-Authored-By trailer.

## Review Focus

1. **Keys the catalogue doesn't know.** An attempt or mark may name a question key the catalogue lacks: a question removed from the data, a key of another exam, or a malformed key. It must be ignored. It counts nowhere, including totals, and nothing throws. *(Task 2 test.)*
2. **A stale catalogue from the browser cache.** An older catalogue has 4-element entries without answers. It must still parse, with `answer: null`, so the practice form keeps working. Analytics then treats those questions as unscored rather than crashing. *(Task 1 test; Task 2 test of an all-null-answer catalogue.)*
3. **Blocked or garbage storage.** The analytics page shows its empty state, and subject and topic pages hold no line and fetch nothing. Nothing throws. *(Task 3 and Task 4 headless checks.)*
4. **A test running in another visible tab saves every 5 s.** Neither the analytics page nor a subject or topic line may redraw unless the numbers they show changed. Each redraw re-announces focus to screen readers. *(Task 3 and Task 4 headless checks.)*
5. **The catalogue fails or is slow.** On the analytics page, the headline numbers and the chart still show, because they need no catalogue. The subject, topic and wrong sections show a failure note with Try again, and the colophon returns. On subject and topic pages a held line stays empty, with no shift and no retry loop. *(Task 3 and Task 4 headless checks.)*

---

### Task 1: Per-exam rules, catalogue answers, access check

**Files:**
- Create: `site/src/lib/exam-rules.js`, `site/tests/exam-rules.test.js`
- Modify:
  - `site/src/lib/tests/score.js`: scoring through the rules; existing exports and behaviour unchanged.
  - `site/src/lib/tests/catalogue.js`: entries carry the official answer.
  - `site/src/lib/tests/access.js`: `canSeeAnalytics`.
  - `site/src/lib/question-html.js`: export `slugify`.
  - `site/tests/catalogue.test.js`.
  - `site/tests/mock-score.test.js`: an access test.

**Interfaces:**
- **Consumes:** nothing new.
- **Produces:**
  - `makeRules({ options: string[], right: number, wrong: { numerator: number, denominator: number } }) → Rules`
  - `examRules(exam: string) → Rules | null`, for the exams in `EXAM_RULES`. The UPSC entry is `{ options: ['a','b','c','d'], right: 2, wrong: { numerator: 2, denominator: 3 } }`.
  - A `Rules` object is `{ options, marks(right, wrong) → number (2 dp), max(scored) → number, penalty(wrong) → number (2 dp) }`.
  - `scoreAttempt(keys, answers, officialOf, rules = examRules('upsc'))`: same result shape as today.
  - `marks` in score.js remains exported and equals `examRules('upsc').marks`.
  - Parsed catalogue entries: `{ key, subject, topic, year, flag, answer: 'a'|'b'|'c'|'d'|null }`.
  - `canSeeAnalytics(exam) → Promise<boolean>`.
  - `slugify(value) → string`, exported from `question-html.js` (same rule as corpus.js).

- [ ] **Step 1: Write the failing tests**

`site/tests/exam-rules.test.js`:
```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { examRules, makeRules } from '../src/lib/exam-rules.js';

test('UPSC: +2 right, minus two-thirds wrong, to two decimals', () => {
  const r = examRules('upsc');
  assert.deepEqual(r.options, ['a', 'b', 'c', 'd']);
  assert.equal(r.marks(62, 17), 112.67);
  assert.equal(r.marks(64, 18), 116);
  assert.equal(r.marks(0, 1), -0.67);
  assert.equal(r.max(98), 196);
  assert.equal(r.penalty(52), 34.67);
  assert.equal(r.penalty(0), 0);
});

test('another marking scheme gives other marks', () => {
  const half = makeRules({ options: ['a', 'b', 'c', 'd'], right: 2, wrong: { numerator: 1, denominator: 2 } });
  assert.equal(half.marks(10, 4), 18);
  assert.equal(half.penalty(4), 2);
  assert.equal(half.max(100), 200);
});

test('an exam with no rules is null', () => {
  assert.equal(examRules('nope'), null);
  assert.equal(examRules('constructor'), null);
});
```

In `site/tests/catalogue.test.js`, add:
- **`every scored question carries its official answer`.** For every corpus question, the parsed entry's `answer` equals the question's `answer` when that is `a`–`d` and the question is not cancelled. Otherwise it is `null`.
- **`a catalogue from before answers still parses`.** `parseCatalogue({ subjects: ['Geography'], topics: [[0, 'Rivers']], questions: { 'upsc-2019-1': [0, 0, 2019, 0] } })` gives one entry with `answer: null`. An entry `[0, 0, 2019, 0, 7]` (an index out of range) is dropped.
- **Size.** Keep the existing "under 25 KB gzipped" test unchanged; it must still pass.

In `site/tests/mock-score.test.js`, add:
```js
test('during the beta anyone can see analytics', async () => {
  assert.equal(await canSeeAnalytics('upsc'), true);
});
```
Every existing test in mock-score.test.js must pass unchanged.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix site test`
Expected: FAIL. `exam-rules.js` is missing, the catalogue entries have no `answer`, and `canSeeAnalytics` is not exported.

- [ ] **Step 3: Implement**
  - `exam-rules.js`: with `R` points per right answer and a penalty of n/d per wrong one, `marks(r, w)` is `Math.round(((R·d·r − n·w) / d) · 100) / 100`. For UPSC that is `(6r − 2w) / 3`, exact for thirds, as today's `marks` is. `penalty(w)` is `Math.round((n·w / d) · 100) / 100`, and `max(s)` is `R·s`. Use `Object.hasOwn` on `EXAM_RULES`.
  - `score.js`: `marks` and `max` come from the rules. Leave the comment explaining the thirds next to `makeRules`.
  - `buildCatalogue`: append a 5th element, the answer's index in `examRules('upsc').options`, or `-1` when the question has no scored answer (cancelled, or no `a`–`d` answer).
  - `parseCatalogue`: accept 4- or 5-element entries. A 5th element must be `-1` or a valid option index, or the entry is dropped.
  - Update the catalogue.js header comment to describe the new element.

- [ ] **Step 4: Run all tests**

Run: `npm --prefix site test`
Expected: PASS, with all earlier tests unchanged. Then `npm --prefix site run build` and record `dist/upsc/catalogue.json`'s raw and gzip sizes in the report.

- [ ] **Step 5: Commit**

`feat(analytics): per-exam rules, official answers in the catalogue, analytics access check`

---

### Task 2: The analytics rules

**Files:**
- Create: `site/src/lib/tests/analytics.js`, `site/tests/analytics.test.js`

**Interfaces:**
- **Consumes:**
  - `Rules` from Task 1, and the parsed catalogue from Task 1.
  - Attempts, as `parseAttempt` returns them, from `store.js`.
  - Marks, as `loadState().entries`: `{ [key]: { status: 'done'|'review', updatedAt } }`.
- **Produces:**
  - `MIN_ANSWERED = 5`.
  - `submittedFor(tests, exam) → attempt[]`: the submitted attempts with `attempt.exam === exam`, oldest `submittedAt` first.
  - `headline(attempts, rules) → { tests, papers, accuracy: { right, answered }, blank: { blank, scored }, lost: number, latestPaper: { year, score, max, change: number|null } | null }`. It is computed from each attempt's stored `result`.
  - `paperHistory(attempts) → [{ id, year, score, max, submittedAt }]`. Papers only, oldest first.
  - `breakdown(attempts, marks, catalogue, rules, exam) → { subjects: SubjectRow[], topics: TopicRow[], wrong: string[], bySubject: Map<string, Stats>, byTopic: Map<string, Stats> }`. The `byTopic` key is `${subject}\u0000${topic}`.
    - `SubjectRow = { subject, answered, right, wrong, net, covered, total }`.
    - `TopicRow = { subject, topic, right, answered }`.
    - `Stats = { answered, right, covered, total }`.
  - `statsLine(stats) → string | null`.

**Rules, all from the spec's "Definitions":**
- **Scored answers.** Only submitted attempts of this exam count. For each key in an attempt, look up the catalogue entry. A key the catalogue lacks is skipped entirely. A key whose entry has `answer === null` is unscored: it never counts in answered, right or wrong. An answered unscored question still counts as covered.
- **Accuracy** counts every scored answer in every submitted attempt.
- **Net marks** are `rules.marks(right, wrong)`.
- **Coverage** is the distinct keys of this exam that are answered in a submitted attempt, or marked `done` or `review`, and present in the catalogue. The total is every catalogue entry of that subject or topic, cancelled ones included.
- **Wrong pile.** For each key, take its last non-blank scored answer, by attempt `submittedAt`. The key is in the pile when that answer is wrong, and the mark is not `done` with `updatedAt` later than that attempt's `submittedAt`. Order the pile newest wrong first, with the key as the tie-break.
- **Subject order.** First, subjects with `answered ≥ MIN_ANSWERED`, by accuracy ascending, then answered descending, then name. Next, subjects with `0 < answered < MIN_ANSWERED`, in the same order. Last, coverage-only subjects, by name. Subjects with neither answers nor coverage are omitted.
- **Topics to work on.** Topics with `answered ≥ MIN_ANSWERED`, by accuracy ascending, then answered descending, then name. Keep the first three.
- **Latest paper.** Take the most recently submitted `kind: 'paper'` attempt. `change` is its score minus the previous paper's score, rounded to 2 dp, when both have the same `max`. Otherwise `change` is `null`. With no paper, `latestPaper` is `null`.
- **Lost marks.** `lost = rules.penalty(Σ result.wrong)`.

- [ ] **Step 1: Write the failing tests**

Build the fixtures with the real helpers. Use `newAttempt`, `chooseAnswer` and `submitAttempt` from `attempt.js`, with each `result` computed by `scoreAttempt` against the fixture's answers. Use a small parsed catalogue:

| key | subject | topic | answer |
|---|---|---|---|
| upsc-2020-1 | Indian Polity | Parliament | a |
| upsc-2020-2 | Indian Polity | Parliament | b |
| upsc-2020-3 | Indian Polity | Fundamental Rights | c |
| upsc-2020-4 | Geography | Rivers | d |
| upsc-2020-5 | Geography | Rivers | null (cancelled) |
| upsc-2020-6 | Indian Economy | Banking | a |

Attempts and marks:
- **T1**, submitted 10:00: answers `{1:'a', 2:'c', 3:'c', 4:'a', 5:'b'}`, with 6 blank.
- **T2**, submitted 11:00: keys `[2, 4, 6]`, answers `{2:'b', 4:'a'}`.
- **T3**, abandoned: `{1:'b'}`.
- **Marks:**
  - `upsc-2020-6` review;
  - `upsc-2020-4` done at 10:30;
  - `upsc-2019-9` done (a key not in the catalogue);
  - `ssc-2020-1` done (another exam).

Tests, by name, with assertions:

1. **`subjects: counts, net marks and coverage, weakest first`.** The rows, in order, are:
   - `{subject:'Geography', answered:2, right:0, wrong:2, net:-1.33, covered:2, total:2}`;
   - `{subject:'Indian Polity', answered:4, right:3, wrong:1, net:5.33, covered:3, total:3}`;
   - `{subject:'Indian Economy', answered:0, right:0, wrong:0, net:0, covered:1, total:1}`.
2. **`unknown keys, other exams and abandoned attempts count nowhere`.** The marks on `upsc-2019-9` and `ssc-2020-1`, and T3, change nothing above. `breakdown` doesn't throw.
3. **`the wrong pile uses the last actual answer and a later Done`.**
   - With the fixture, `wrong` is `['upsc-2020-4']`: it was wrong again at 11:00, after the 10:30 Done.
   - With the Done moved to 11:30, `wrong` is `[]`.
   - Add **T4** at 12:00 with `{1:'b'}`, then **T5** at 13:00 with key 1 blank. Now `upsc-2020-1` is in the pile, because a blank doesn't clear it.
   - `upsc-2020-2` stays out, because its last actual answer (T2) was right.
4. **`topics to work on need five answers and keep three`.** A synthetic catalogue has topics P (5 answered, 2 right), Q (6 answered, 5 right), R (4 answered, 0 right), S (5 answered, 2 right) and T (7 answered, 3 right). The result is `[P, S, T]` by `topic`: P and S tie at 0.4 and order by name, then T is 0.43; R is too few to rank and Q is cut by the limit of three.
5. **`another exam's marking changes net marks`.** With `makeRules({ ..., right: 2, wrong: { numerator: 1, denominator: 2 } })`, Geography's `net` is `-1`.
6. **`a catalogue without answers makes everything unscored`.** With every `answer: null`, all rows have `answered:0`, coverage still counts, and `wrong` is `[]`.
7. **`headline from stored results`.** Three submitted attempts:
   - **P1**, paper 2022: right 50, wrong 30, blank 20, score 80, max 200.
   - **P2**, paper 2023: right 60, wrong 20, blank 20, score 106.67, max 200.
   - **C1**, custom: right 7, wrong 2, blank 1, score 12.67, max 20.

   Expect:
   ```js
   { tests: 3, papers: 2, accuracy: { right: 117, answered: 169 }, blank: { blank: 41, scored: 210 },
     lost: 34.67, latestPaper: { year: 2023, score: 106.67, max: 200, change: 26.67 } }
   ```
   With P1's max set to 300, `change` is `null`. With no papers, `latestPaper` is `null`.
8. **`paper history is papers only, oldest first`.** The result is `[P1, P2]` with `{ year, score, max }`.
9. **`statsLine says what the student has`.** The outputs are:
   - `{answered:25,right:12,covered:60,total:422}` gives `'Your accuracy here: 48% (25 answered) · Covered 60 of 422'`;
   - `{answered:3,right:2,covered:3,total:10}` gives `'2 of 3 right so far · Covered 3 of 10'`;
   - `{answered:0,right:0,covered:12,total:422}` gives `'Covered 12 of 422'`;
   - `{answered:0,right:0,covered:0,total:5}` gives `null`, and `undefined` gives `null`.

- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix site test`
Expected: FAIL, because `analytics.js` is missing.

- [ ] **Step 3: Implement `analytics.js`** to the rules above. It is pure: no DOM, no storage. Read `Object.hasOwn` on answers and marks.

- [ ] **Step 4: Run all tests**

Run: `npm --prefix site test`
Expected: PASS.

- [ ] **Step 5: Commit**

`feat(analytics): the analytics rules`

---

### Task 3: The "Your analytics" page and the ways to it

**Files:**
- Create: `site/src/pages/upsc/analytics.astro`, `site/src/scripts/analytics-page.js`
- Modify:
  - `site/src/pages/upsc/test/index.astro`: a "Your analytics" link in the page's intro or near Past results.
  - `site/src/scripts/result-page.js`: a "Your analytics" link in `[data-links]`.
  - `site/src/pages/upsc/index.astro`: a "Your analytics" link in the Practice tests panel's link row.
  - `site/src/pages/account.astro`: a "Your analytics" link in the Practice tests section.

**Interfaces:**
- **Consumes:** Task 1 (`examRules`, `canSeeAnalytics`, `parseCatalogue`, `slugify`), Task 2 (all of it), and `loadTests` and `MAX_ATTEMPTS` (store.js).
  - `loadState` (progress-store.js).
  - `formatScore`, `formatDate` (score.js).
- **Produces:** the page `/upsc/analytics`. The script reads its exam from `data-exam` on the page's main element. All of its paths derive from that: `/${exam}/catalogue.json`, `/${exam}/test`, `/revise?wrong=${exam}`.

**Behaviour** (the spec's section 1 is binding, in the agreed mockup's order):
- **Drawn at once from storage, no catalogue needed:**
  - **Headline numbers**, from `headline()`:
    - "Latest paper": score / max, plus the change when it isn't null. With no paper, a short line linking to the papers list.
    - "Accuracy": percentage, with "*right* of *answered*" written out.
    - "Left blank": percentage.
    - "Lost to wrong answers": a minus sign and `formatScore(lost)`.
  - **The papers chart**, from `paperHistory()`. It is an inline SVG built with DOM methods, plotting percent of max, with each point's real score written out. Under it, or visually hidden, a table of the same scores. With one paper, a single point and a note. With none, the section is left out.
- **After the catalogue loads, drawn below:**
  - **By subject.** Rows from `breakdown().subjects`, each with:
    - accuracy as a bar plus the written percentage;
    - for rows below `MIN_ANSWERED`, "*n* of *m* right so far" instead;
    - answered, net marks and "Covered *x* of *y*";
    - a **Practise** link to `/${exam}/test?subject=${slugify(subject)}#practice`.
  - **Topics to work on.** Each row reads "*right* of *answered* right" with a **Practise this topic** link (`&topic=${slugify(topic)}`). With none ranked, the line "Answer at least 5 questions in a topic to see it here."
  - **Questions you got wrong.** A count and a **Revise them** link to `/revise?wrong=${exam}`, shown only when the count is above 0.
- **Empty states.**
  - No submitted tests: one or two lines saying analytics fills in as the student takes tests, with a link to `/${exam}/test`. Coverage rows still show if there are marks.
  - Nothing at all: only that explanation.
- **Capped.** When the device holds `MAX_ATTEMPTS` attempts, one line says "Covers your latest 200 tests."
- **Access.** `await canSeeAnalytics(exam)` runs before drawing. If it returns false, show one line saying analytics needs a pass. It never does during the beta.
- **Loading the catalogue.** It uses the /revise loader conventions: a 15 s timeout, a failure note with **Try again**, and a retry on `online`. While it loads, the colophon is `display: none` (not `visibility`); it returns when loading succeeds or fails.
- **Gate.** `main[data-pending]`, hidden under `@media (scripting: enabled)` with a 4 s reveal fallback, until the first draw after the font wait, as on the test pages. Add `data-sync-full` when sign-in is enabled.
- **Redraws.** These happen on `sawaalbox:synced` and on `storage` events for the tests or progress keys. Each redraws only when a signature of the shown numbers changed. Never rebuild the page on a running test's 5 s time saves elsewhere.
- **One filled-green action.** The page has none needed. Revise them and Practise are outlined or plain links.
- **No index.** `noindex`, kept out of the sitemap, with a `<noscript>` line.

- [ ] **Step 1: Build the page and script.** WIP-commit.
- [ ] **Step 2: Add the four links in.** The /upsc panel must still end at or above the Search box's bottom at 1000–1280 px. If a third link doesn't fit the row, put "Your analytics" on its own line under the record row instead, and say so in the report.
- [ ] **Step 3: Run tests, build, check-links and the detector.**

Run: `npm --prefix site test`, then `npm --prefix site run build`, then (from site/) `node scripts/check-links.mjs`, then the detector on the changed `.astro` files.
Expected: all pass, and the detector reports `[]`.

- [ ] **Step 4: Run the headless checks** (scratchpad `capture/an-*.mjs`, hard timeouts). Seed storage with known attempts and marks.
  - **The page renders the expected numbers.** Compute the expected values in the script with the Task 2 functions against the built catalogue.
  - **Each empty state renders**, and so does the capped line (seed 200 attempts).
  - **Review Focus 3.** Blocked storage (a getter that throws) and garbage JSON both show the empty state, with no console errors.
  - **Review Focus 4.** With a second page running a test, over 12 s the analytics page's sections stay the same elements, and nothing redraws.
  - **Review Focus 5.** Abort the catalogue request. The headline and chart still show, the failure note and Try again appear, the colophon returns, and Try again recovers.
  - **Links.** Practise, Practise this topic and Revise them all land correctly. The four links in exist and work.
  - **Layout shift.** CLS is 0 at 360, 390 and 1280, in light and dark.
  - **Accessibility.** The chart's table equivalent is in the accessibility tree.
  - **Screenshots** at 390 and 1280, in light and dark.
- [ ] **Step 5: Commit**

`feat(analytics): Your analytics page, linked from tests, results, the UPSC panel and My progress`

---

### Task 4: The line on subject and topic pages

**Files:**
- Create: `site/src/components/YouLine.astro`, `site/src/scripts/you-line.js`
- Modify:
  - `site/src/pages/upsc/subject/[slug]/[...page].astro`: `<YouLine slot="meta" exam="upsc" subject={subject.name} />`, after the Practise line.
  - `site/src/pages/upsc/topic/[subject]/[topic]/[...page].astro`: the same with `topic={topic.subtopic}` and `subject={topic.subject}`.

**Interfaces:**
- **Consumes:** Task 1 (`examRules`, `canSeeAnalytics`, `parseCatalogue`), Task 2 (`submittedFor`, `breakdown`, `statsLine`), `loadTests`, `loadState`, and the storage key constants `TESTS_KEY` and `STORAGE_KEY`.
- **Produces:** nothing other tasks use.

**Behaviour** (the spec's section 2, including "When the line's space is held"):
- `YouLine.astro` renders `<p class="you-line" data-you-line data-exam=… data-subject=… data-topic=…></p>`, then an `is:inline` script placed immediately after it. That script runs during parse, before first paint. If localStorage holds any attempt in the tests key, or any entry in the progress key, it sets `data-hold` on the line. Wrap it in try/catch; if storage is blocked, nothing is held. It cannot import modules, so a comment names the keys it reads and where they are defined.
- **CSS.** `.you-line[data-hold]` reserves one line (`min-height`, matching the Practise line's font). An un-held line takes no space.
- **`you-line.js`.** It does nothing for an un-held line: no fetch and no work. For a held line it:
  1. awaits `canSeeAnalytics(exam)`;
  2. fetches `/${exam}/catalogue.json` (15 s timeout, one attempt, no retry loop);
  3. computes `breakdown(...)`;
  4. looks up `bySubject.get(subject)`, or `byTopic.get(`${subject}\u0000${topic}`)` on topic pages;
  5. sets `textContent` to `statsLine(...)`, or leaves the line empty.
- **Refills.** On `sawaalbox:synced` and on storage events for the two keys, it refills the held line only if the text changes. It never draws into an un-held line.
- **One module instance.** The line appears once per page, and the script is imported once.

- [ ] **Step 1: Build the component, script and page edits.** WIP-commit.
- [ ] **Step 2: Run tests, build, check-links and the detector** on both page files.

Run: `npm --prefix site test`, then `npm --prefix site run build`, then (from site/) `node scripts/check-links.mjs`, then the detector on both page files.
Expected: all pass, and the detector reports `[]`.

- [ ] **Step 3: Run the headless checks** (`capture/yl-*.mjs`), on a subject page and a topic page each:
  - **No data:** no `data-hold`, the line is 0 px tall, there is no request to `catalogue.json`, and the page is identical in layout to the base build at 390 and 1280.
  - **Data elsewhere only:** the line is held and stays empty, with no shift.
  - **Few answers:** the line reads "*n* of *m* right so far · Covered …".
  - **Five or more answers:** the line reads "Your accuracy here: …".
  - **Coverage only:** the line reads "Covered *x* of *y*".
  - **Review Focus 3:** blocked storage holds nothing and fetches nothing.
  - **Review Focus 4:** a test running in another tab causes no redraw (the same text node, no mutations over 12 s).
  - **Review Focus 5:** an aborted catalogue request leaves the held line empty, with no shift and exactly one request.
  - **Layout shift:** CLS is no worse than the base build at 360, 390 and 1280, in light and dark, for each case.
- [ ] **Step 4: Commit**

`feat(analytics): your accuracy and coverage on subject and topic pages`

---

### Task 5: Revise the questions you got wrong

**Files:**
- Modify:
  - `site/src/lib/accounts/summary.js`: `reviseTarget`.
  - `site/src/scripts/revise-page.js`: the wrong mode.
  - `site/src/pages/revise.astro`: copy only, if needed.
  - `site/tests/summary.test.js`.

**Interfaces:**
- **Consumes:** Task 1 (`examRules`, `parseCatalogue`) and Task 2 (`submittedFor`, `breakdown`).
- **Produces:** `reviseTarget(search)`. Its precedence is `?review` first, then `?wrong[=<exam>]`, which gives `{ mode: 'wrong', exam }` (exam defaults to `'upsc'` and must match `/^[a-z]+$/`, or the mode is `none`), then `?list=<id>`.

- [ ] **Step 1: Write the failing tests** in `site/tests/summary.test.js`:
  - `reviseTarget('?wrong')` gives `{ mode: 'wrong', exam: 'upsc' }`.
  - `reviseTarget('?wrong=upsc')` gives the same.
  - `reviseTarget('?wrong=UPSC!')` gives `{ mode: 'none' }`.
  - `reviseTarget('?review&wrong')` gives `{ mode: 'review' }`.
  - `reviseTarget('?wrong&list=abc')` gives `{ mode: 'wrong', exam: 'upsc' }`.
- [ ] **Step 2: Run them to see them fail**

Run: `npm --prefix site test`
Expected: FAIL.

- [ ] **Step 3: Implement the wrong mode** in `revise-page.js`:
  - **Questions.** Fetch the catalogue with the page's existing loader conventions. The question order is `breakdown(...).wrong`, captured when the page opens, as Needs review is.
  - **Title** "Questions you got wrong".
  - **Count line** as the other modes have.
  - **Empty state.** "No wrong answers to revise. Questions you answer wrongly in practice tests appear here."
  - **Back link.** It points to `/${exam}/analytics` instead of /account.
  - **Controls.** Mark done, Needs review and Save to list work as in the other modes. A question marked Done stays on the page until the next visit, as in Needs review mode.
- [ ] **Step 4: Run tests and build.**

Run: `npm --prefix site test`, then `npm --prefix site run build`.
Expected: PASS.

- [ ] **Step 5: Run the headless checks** (`capture/rw-*.mjs`):
  - **The list.** With seeded attempts, `/revise?wrong` lists exactly the keys `breakdown().wrong` gives, in that order.
  - **Done.** Marking one Done, then reloading, removes it. The analytics page's count drops by one.
  - **Empty state.** It renders when there are no wrong answers.
  - **Catalogue failure.** It shows the failure note and Try again.
  - **Layout shift.** CLS is 0 at 390 and 1280.
- [ ] **Step 6: Commit**

`feat(analytics): revise the questions you got wrong`

---

## After the last task

- **Whole-branch checks** (run from `site/`):
  - `npm test`;
  - the build;
  - `check-links`;
  - the detector on every changed page;
  - question pages load no new script (compare the script tags in `dist/upsc/question/*.html` with base 5b558e4).
- **Owner hand-over.** No database change is needed: analytics reads only what already exists. Publishing needs the owner's OK; it is a fast-forward push of `analytics` to master.
