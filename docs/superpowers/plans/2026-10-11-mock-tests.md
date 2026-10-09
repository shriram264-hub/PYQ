# Mock Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Timed full past papers and custom practice sets, taken one question at a time in the browser. Today's UPSC scoring applies. Attempts are kept on the device and synced to the account when signed in.

**Architecture:**
- **Pure logic in `site/src/lib/tests/`.** This covers the attempt record, storage, scoring, building papers and sets, the catalogue, merging and clock maths. It has no DOM, so all of it is unit-tested under `node --test`.
- **Three pages, each with one script:**
  - `/upsc/test` lists papers, carry-on attempts, the practice-set form and past results.
  - `/upsc/test/take` is the test screen.
  - `/upsc/test/result` is the results page.
- **Data:** questions come from the existing `/upsc/full/{year}.json` files and a new `/upsc/catalogue.json`.
- **Sync:** attempts sync through a third step in the existing single-flight run (`site/src/scripts/sync.js`) to a new Supabase table `test_attempts`.

**Tech Stack:** Astro 7 static site, vanilla ES modules, `node:test`, Supabase (supabase-js, lazy-loaded), headless Chrome via puppeteer-core for the browser checks.

**Spec:** `docs/superpowers/specs/2026-10-11-mock-tests-design.md` (owner-approved 2026-10-11). Read it before starting any task. It is the authority, and this plan argues from it.

## Global Constraints

- **Design.** `DESIGN.md`: tokens only, square corners, no Unicode glyph icons, contrast ≥ 4.5:1 in both themes, and one filled-green action per page. On the test screen that action is **Submit**.
- **No layout shift.** Nothing injected or loaded after first paint may shift the layout: test chrome, grid, question changes, results.
- **Page weight.** Question pages load nothing new. The test screen loads the catalogue only for custom sets, plus only the needed year files.
- **No supabase-js upfront.** supabase-js is never in the initial bundle and loads only as it does today.
- **Text rendering.** Everything from storage, the catalogue or the year files is rendered via `textContent` or the shared escaper. The review uses the shared `questionHTML`.
- **Progressive enhancement.** `/upsc/test` lists papers without JavaScript. The test and results pages carry `<noscript>`.
- **Checks.** `npm test`, the build and `check-links` pass, and the detector reports `[]`.
- **No real accounts on the hosted project** in tests.
- **Scoring.** +2 right, −⅔ wrong, 0 blank. Cancelled questions are not scored. Score = 2 × right − ⅔ × wrong, out of 2 × the number of scored questions, shown to two decimals.
- **Access hook.** Starting any test goes through `canStartTest(exam)` in `site/src/lib/tests/access.js`, which returns true during the beta. No other code may gate tests.
- **Never deleted.** Attempts are never deleted, on the device or in the account. An abandoned attempt keeps its data.
- **Never mention UnlockIAS** anywhere on the site.

**Working rules for every task** (this repo, this machine):
- Work in `C:\Users\shrir\Downloads\UPSC_project\.claude\worktrees\accounts` on branch `mock-tests`.
- Run site commands from `site/`, e.g. `npm test`, `npm run build`, `node scripts/check-links.mjs`.
- Keep shell commands simple: no `cd … &&` chains, no `$(…)`. Use `npm --prefix site …` or the tool's working directory.
- Start servers in the background and give every headless script a hard timeout.
- Make a WIP commit before any long-running check.
- Headless checks use puppeteer-core with the local Chrome. Earlier tasks keep their scripts and node_modules in the session scratchpad's `capture/` folder. Put new scripts there too, never in the repo.
- Detector: `C:\Users\shrir\.claude\skills\impeccable\scripts\impeccable.cmd detect --json <files>`. The homepage `.slot::after` side-tab finding is a sanctioned exception.
- Conventional commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Decisions made while planning

Each decision gives the choice, then the reason.

1. **Questions with no official answer.** Three disputed questions have none (1995 Q119, 1998 Q78, 2003 Q53).
   - They stay in their full paper, which matches "All of a year's questions except cancelled ones". They are **not scored**: they count in neither `scored`, `right`, `wrong` nor `blank`.
   - The review says *"Not scored: UPSC gives no answer for this question."*
   - Practice sets leave them out of the pool, since a slot spent on an unscorable question is wasted.
   - The scoring helper takes an `officialOf(key)` that returns `'a'..'d'` or `null`, and `null` means unscored. This is how "scored against the official answer" works when there is no official answer.
2. **Device-only field `syncedAt`.** The attempt record gets `syncedAt: ISO | null`: the `updatedAt` the account held at the last sync. It is never sent to the database.
   - An attempt is *dirty* (needs upload) when `syncedAt` is null or differs from `updatedAt`.
   - The rebase keeps only attempts whose `syncedAt` is null.
   - This plays the role `synced` plays for marks.
3. **`canStartTest` is async** (`async function canStartTest(exam)`). Part 3's entitlement check will need the network, and callers already `await` it.
4. **Starting a paper.**
   - Links to a paper go to `/upsc/test/take?paper=<year>`. They are plain links, so they work from server-rendered pages.
   - With an unfinished attempt of that paper on the device, the take page resumes it.
   - Otherwise it shows a start screen (name, count, notes, rules) with **Start the test**.
   - The attempt is created only on Start, so a stray click or a crawler creates nothing.
   - Custom sets are created by the form on `/upsc/test`, which then goes to `?attempt=<id>`.
5. **Catalogue format.** The form is `{ subjects: [name], topics: [[subjectIndex, name]], questions: { key: [subjectIndex, topicIndex, year, flag] } }`, with flag 0 = ok, 1 = disputed with an answer, 2 = no official answer, 3 = cancelled.
   - This is the spec's `[subject, topic, year, status]`, with names indexed.
   - Measured during planning: **17.4 KB gzip** (121.9 KB raw). Spelling out the names would be 26.1 KB gzip, over the 25 KB target.
6. **Topics in a set's spec** are `[subject, topic]` pairs, since a topic name can repeat across subjects.
   - **Empty `subjects` means every subject.** The form starts with nothing ticked, so a student can just pick a count and go.
   - Ticking a topic ticks its subject.
7. **Wording on subject pages.** Subject pages say **Practise this subject**; topic pages say **Practise this topic**. The spec names only the latter. On a subject page, "this topic" would be wrong.
8. **Sync triggers.** A sync run is asked for (`sawaalbox:test` event) when an attempt starts, is submitted or is abandoned, not on every answer, which would mean a request per click.
   - Every page load also runs a sync when signed in, as today.
   - Answers given mid-test therefore reach the account on the next page load or the next start, submit or abandon.
9. **The spec's example score is arithmetically off.** 64 right and 18 wrong is 116.00, not 112.67 (62 right and 17 wrong is 112.67). The formula is the authority. Tests use the formula.
10. **Clock across sleep.** Each tick adds at most 5 s (`TICK_CAP_MS`), so a laptop asleep with the page technically visible does not burn time.
11. **The device keeps the 200 most recently updated attempts** (`saveTests` prunes). Older ones remain in the account.
12. **Timestamps from the database** (`2026-10-09T10:00:00+00:00`) are normalised with `toISOString()` when read. Comparisons always go through `Date.parse`.
13. **Keyboard.** ← / → always move between questions, even with focus on a radio, and `preventDefault` stops the native radio change. ↑ / ↓ still move between options natively.

## File structure

**Pure logic** (`site/src/lib/tests/`): no DOM, storage only through an injectable `storage`.

| File | Responsibility |
|---|---|
| `attempt.js` | The attempt record: constants, `newAttempt`, `parseAttempt`, transitions (answer, clear, review, move, time, submit, abandon), `attemptName`, `progressLine` |
| `store.js` | `sawaalbox-tests-v1`: `parseTests`, `loadTests`, `saveTests` (prunes to 200), `putAttempt`, `getAttempt`, `unfinished`, `finished`, `inProgressPaper`, `latestLine` |
| `score.js` | `officialAnswer`, `marks`, `scoreAttempt`, `formatScore`, `accuracy`, `formatDuration`, `formatDate`, `resultLine`, `bySubject` |
| `access.js` | `canStartTest(exam)` |
| `catalogue.js` | `FLAG`, `flagOf`, `buildCatalogue` (build time), `parseCatalogue` (client) |
| `build.js` | `paperKeys`, `paperInfo`, `paperNotes`, `setPool`, `drawSet`, `mulberry32`, `newSeed`, `defaultMinutes` |
| `merge.js` | `isDirty`, `toRow`, `fromRow`, `pickAttempt`, `mergeAttempts`, `settleAttempts`, `rebaseTests`, `attemptsEqual` |
| `clock.js` | `TICK_CAP_MS`, `SAVE_EVERY_MS`, `formatClock`, `announcementFor`, `keyAction` |
| `review.js` | `REVIEW_FILTERS`, `verdictOf`, `verdictText`, `reviewKeys` |
| `form.js` | `readSpec`, `poolMessage`, `preselection` |

**Build time and scripts:**

| File | Responsibility |
|---|---|
| `site/src/lib/papers.js` | Build time only (imports corpus.js): `PAPERS`, one `{ year, questions, notes }` per year, newest first |
| `site/src/pages/upsc/catalogue.json.js` | The catalogue endpoint |
| `site/src/scripts/sync-tests.js` | `syncTests`, `forgetTestsPull`, `TESTS_MARKER_KEY` |
| `site/src/scripts/sync.js` (modify) | Third step in the run, tests rebase in `claimDevice`, `sawaalbox:test` listener |
| `supabase/migrations/20261011120000_test_attempts.sql` | Table, grants and policies |
| `supabase/tests/rls_test.sql` (modify) | `test_attempts` checks |
| `site/tests/support/fake-supabase.js` | The fake Supabase client, moved out of `sync.test.js` and extended with `test_attempts` |

**Pages, scripts and links:**

| File | Responsibility |
|---|---|
| `site/src/pages/upsc/test/take.astro` + `site/src/scripts/take-page.js` | The test screen |
| `site/src/pages/upsc/test/result.astro` + `site/src/scripts/result-page.js` | The results page |
| `site/src/pages/upsc/test/index.astro` + `site/src/scripts/tests-page.js` | Practice tests page (papers, carry on, past results) |
| `site/src/scripts/practice-form.js` | The practice-set form on `/upsc/test` |
| `site/src/components/Masthead.astro` | "Tests" nav link |
| Year, subject and topic pages | Sit this paper, Practise this subject, Practise this topic |
| `site/src/pages/index.astro` | Homepage Coming → Available |
| `site/src/pages/sitemap.xml.js` | `/upsc/test` |
| `site/src/pages/account.astro`, `site/src/scripts/progress-page.js` | The Practice tests line on /account |

**Unit tests** (`site/tests/`): `mock-attempt`, `mock-store`, `mock-score`, `mock-build`, `catalogue`, `mock-merge`, `sync-tests`, `mock-clock`, `mock-review` and `mock-form`, each as `.test.js`.

---

### Task 1: The attempt record, storage, scoring and the access hook

**Files:**
- Create: `site/src/lib/tests/attempt.js`, `site/src/lib/tests/store.js`, `site/src/lib/tests/score.js`, `site/src/lib/tests/access.js`
- Test: `site/tests/mock-attempt.test.js`, `site/tests/mock-store.test.js`, `site/tests/mock-score.test.js`

**Interfaces:**
- Consumes: `isQuestionKey(key)` from `site/src/lib/accounts/qkey.js`.
- Produces (later tasks rely on these exact names):
  - `attempt.js`:
    - Constants: `EXAM = 'upsc'`, `MAX_KEYS = 150`, `OPTIONS = ['a','b','c','d']`, `COUNTS = [10,25,50,100]`, `PAPER_MINUTES = 120`, `MIN_MINUTES = 5`, `MAX_MINUTES = 180`, `MINUTE = 60000`, `STATUSES`.
    - `newAttempt({ id, kind, spec, keys, limitMs, now }) → attempt`
    - `parseAttempt(raw) → attempt | null`
    - Transitions (each returns the same object when nothing changes): `chooseAnswer(a, key, option, now)`, `clearAnswer(a, key, now)`, `toggleReview(a, key, now)`, `moveTo(a, index, now)`, `addElapsed(a, ms, now)`, `submitAttempt(a, result, now)`, `abandonAttempt(a, now)`
    - `remainingMs(a)`, `attemptName(a)`, `progressLine(a)`
  - `store.js`:
    - Constants: `TESTS_KEY = 'sawaalbox-tests-v1'`, `MAX_ATTEMPTS = 200`.
    - `emptyTests()`, `parseTests(raw)`, `loadTests(storage?)`, `saveTests(tests, storage?) → boolean`, `pruneAttempts(attempts, max?)`
    - `putAttempt(tests, a)`, `getAttempt(tests, id)`
    - `unfinished(tests)`, `finished(tests)`, `inProgressPaper(tests, year)`, `latestLine(tests) → string`
  - `score.js`:
    - `officialAnswer(entry) → 'a'..'d' | null`, `marks(right, wrong)`
    - `scoreAttempt(keys, answers, officialOf) → { scored, right, wrong, blank, score, max }`
    - Formatting: `formatScore(n)`, `accuracy(result) → number | null`, `formatDuration(ms)`, `formatDate(iso)`, `resultLine(result, usedMs)`
    - `bySubject(keys, answers, entryOf) → [{ subject, right, wrong, blank }]`
  - `access.js`: `canStartTest(exam) → Promise<boolean>`

An attempt is exactly:

```
{ id, exam, kind: 'paper'|'custom',
  spec: { year } | { subjects, topics: [[subject, topic]], fromYear, toYear, count, minutes, skipDone, onlyReview, seed },
  keys, answers: { [key]: 'a'|'b'|'c'|'d' }, review: [key], current, limitMs, elapsedMs,
  status: 'in_progress'|'submitted'|'abandoned', startedAt, updatedAt, submittedAt: ISO|null,
  result: null|{ scored, right, wrong, blank, score, max }, syncedAt: ISO|null }
```

- [ ] **Step 1: Write the failing tests for the attempt record**

`site/tests/mock-attempt.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_KEYS,
  MINUTE,
  abandonAttempt,
  addElapsed,
  attemptName,
  chooseAnswer,
  clearAnswer,
  moveTo,
  newAttempt,
  parseAttempt,
  progressLine,
  remainingMs,
  submitAttempt,
  toggleReview,
} from '../src/lib/tests/attempt.js';

const ID = '11111111-1111-4111-8111-111111111111';
const T0 = '2026-10-09T10:00:00.000Z';
const T1 = '2026-10-09T10:05:00.000Z';
const T2 = '2026-10-09T10:09:00.000Z';
const KEYS = ['upsc-2019-1', 'upsc-2019-2', 'upsc-2019-3'];
const RESULT = { scored: 3, right: 1, wrong: 1, blank: 1, score: 1.33, max: 6 };

const paper = () => newAttempt({ id: ID, kind: 'paper', spec: { year: 2019 }, keys: KEYS, limitMs: 120 * MINUTE, now: T0 });
const customSpec = (o = {}) => ({
  subjects: ['Indian Polity'],
  topics: [['Indian Polity', 'Fundamental Rights and Duties']],
  fromYear: 1995,
  toYear: 2026,
  count: 25,
  minutes: 30,
  skipDone: false,
  onlyReview: false,
  seed: 42,
  ...o,
});
const custom = (o) => newAttempt({ id: ID, kind: 'custom', spec: customSpec(o), keys: KEYS, limitMs: 30 * MINUTE, now: T0 });

test('a new attempt starts at the first question with nothing answered and the full time left', () => {
  assert.deepEqual(paper(), {
    id: ID,
    exam: 'upsc',
    kind: 'paper',
    spec: { year: 2019 },
    keys: KEYS,
    answers: {},
    review: [],
    current: 0,
    limitMs: 120 * MINUTE,
    elapsedMs: 0,
    status: 'in_progress',
    startedAt: T0,
    updatedAt: T0,
    submittedAt: null,
    result: null,
    syncedAt: null,
  });
  assert.equal(remainingMs(paper()), 120 * MINUTE);
});

test('choosing an answer records it and the time; a second choice replaces it', () => {
  const a = chooseAnswer(paper(), KEYS[1], 'c', T1);
  assert.deepEqual(a.answers, { [KEYS[1]]: 'c' });
  assert.equal(a.updatedAt, T1);
  assert.deepEqual(chooseAnswer(a, KEYS[1], 'a', T2).answers, { [KEYS[1]]: 'a' });
});

test('an answer to a question not in the test, an option that is not one, or the same option again changes nothing', () => {
  const a = chooseAnswer(paper(), KEYS[0], 'b', T1);
  assert.equal(chooseAnswer(a, 'upsc-2020-1', 'a', T2), a);
  assert.equal(chooseAnswer(a, KEYS[0], 'e', T2), a);
  assert.equal(chooseAnswer(a, KEYS[0], 'b', T2), a);
});

test('clearing an answer removes it; clearing a blank question changes nothing', () => {
  const a = chooseAnswer(paper(), KEYS[0], 'b', T1);
  const cleared = clearAnswer(a, KEYS[0], T2);
  assert.deepEqual(cleared.answers, {});
  assert.equal(cleared.updatedAt, T2);
  assert.equal(clearAnswer(cleared, KEYS[0], T2), cleared);
});

test('mark for review toggles, independently of the answer', () => {
  const a = toggleReview(chooseAnswer(paper(), KEYS[2], 'd', T1), KEYS[2], T1);
  assert.deepEqual(a.review, [KEYS[2]]);
  assert.deepEqual(a.answers, { [KEYS[2]]: 'd' });
  assert.deepEqual(toggleReview(a, KEYS[2], T2).review, []);
  assert.equal(toggleReview(a, 'upsc-2020-1', T2), a);
});

test('moving is clamped to the test, and moving to where you are changes nothing', () => {
  assert.equal(moveTo(paper(), 2, T1).current, 2);
  assert.equal(moveTo(paper(), 99, T1).current, 2);
  assert.equal(moveTo(paper(), -4, T1).current, 0);
  const a = paper();
  assert.equal(moveTo(a, 0, T1), a);
});

test('time adds up, never past the limit, and nothing is added for zero or less', () => {
  let a = addElapsed(paper(), 1500, T1);
  a = addElapsed(a, 2500, T2);
  assert.equal(a.elapsedMs, 4000);
  assert.equal(a.updatedAt, T2);
  assert.equal(remainingMs(a), 120 * MINUTE - 4000);
  assert.equal(addElapsed(a, 0, T2), a);
  assert.equal(addElapsed(a, -5, T2), a);
  assert.equal(addElapsed(a, 999 * MINUTE, T2).elapsedMs, 120 * MINUTE);
  assert.equal(remainingMs(addElapsed(a, 999 * MINUTE, T2)), 0);
});

test('submitting closes the attempt with its result; a closed attempt takes no more changes', () => {
  const done = submitAttempt(chooseAnswer(paper(), KEYS[0], 'a', T1), RESULT, T2);
  assert.equal(done.status, 'submitted');
  assert.equal(done.submittedAt, T2);
  assert.deepEqual(done.result, RESULT);
  for (const change of [
    (a) => chooseAnswer(a, KEYS[1], 'b', T2),
    (a) => clearAnswer(a, KEYS[0], T2),
    (a) => toggleReview(a, KEYS[0], T2),
    (a) => moveTo(a, 2, T2),
    (a) => addElapsed(a, 1000, T2),
    (a) => submitAttempt(a, RESULT, T2),
    (a) => abandonAttempt(a, T2),
  ]) {
    assert.equal(change(done), done);
  }
});

test('abandoning keeps every answer and cannot then be submitted', () => {
  const left = abandonAttempt(chooseAnswer(paper(), KEYS[0], 'a', T1), T2);
  assert.equal(left.status, 'abandoned');
  assert.deepEqual(left.answers, { [KEYS[0]]: 'a' });
  assert.equal(left.submittedAt, null);
  assert.equal(submitAttempt(left, RESULT, T2), left);
});

test('names: a paper by its year, a set by its one topic, its one subject, or how many subjects', () => {
  assert.equal(attemptName(paper()), 'UPSC Prelims 2019');
  assert.equal(attemptName(custom()), 'Practice: Fundamental Rights and Duties');
  assert.equal(attemptName(custom({ topics: [] })), 'Practice: Indian Polity');
  assert.equal(
    attemptName(custom({ topics: [['Indian Polity', 'A'], ['Indian Polity', 'B']] })),
    'Practice: Indian Polity'
  );
  assert.equal(attemptName(custom({ subjects: ['Indian Polity', 'Geography'] })), 'Practice: 2 subjects');
  assert.equal(attemptName(custom({ subjects: [], topics: [] })), 'Practice: all subjects');
});

test('progress line counts answered questions', () => {
  assert.equal(progressLine(chooseAnswer(paper(), KEYS[0], 'a', T1)), '1 of 3 answered');
});

// --- parseAttempt: storage and the account are not trusted ---

const roundTrip = (a) => parseAttempt(JSON.parse(JSON.stringify(a)));

test('a well-formed attempt survives storage unchanged', () => {
  const a = submitAttempt(toggleReview(chooseAnswer(paper(), KEYS[0], 'a', T1), KEYS[1], T1), RESULT, T2);
  assert.deepEqual(roundTrip(a), a);
  const c = { ...custom(), syncedAt: T0 };
  assert.deepEqual(roundTrip(c), c);
});

test('answers and review marks for questions not in the test, or not an option, are dropped', () => {
  const a = { ...paper(), answers: { [KEYS[0]]: 'a', [KEYS[1]]: 'z', 'upsc-2020-1': 'b', [KEYS[2]]: 3 }, review: [KEYS[0], 'x', KEYS[0]] };
  const parsed = roundTrip(a);
  assert.deepEqual(parsed.answers, { [KEYS[0]]: 'a' });
  assert.deepEqual(parsed.review, [KEYS[0]]);
});

test('the current index and elapsed time are clamped', () => {
  const parsed = roundTrip({ ...paper(), current: 7, elapsedMs: 999 * MINUTE });
  assert.equal(parsed.current, 2);
  assert.equal(parsed.elapsedMs, 120 * MINUTE);
});

test('bad shapes are refused, not trusted', () => {
  const bad = [
    null,
    'x',
    [],
    { ...paper(), id: 'not-a-uuid' },
    { ...paper(), exam: 'UPSC!' },
    { ...paper(), kind: 'quiz' },
    { ...paper(), status: 'paused' },
    { ...paper(), spec: {} },
    { ...paper(), keys: [] },
    { ...paper(), keys: ['upsc-2019-1', 'upsc-2019-1'] },
    { ...paper(), keys: ['not a key'] },
    { ...paper(), keys: Array.from({ length: MAX_KEYS + 1 }, (_, i) => `upsc-2019-${i + 1}`) },
    { ...paper(), limitMs: 1000 },
    { ...paper(), limitMs: 181 * MINUTE },
    { ...paper(), elapsedMs: -1 },
    { ...paper(), startedAt: 'yesterday' },
    { ...paper(), status: 'submitted', submittedAt: T1, result: null },
    { ...paper(), status: 'submitted', submittedAt: null, result: RESULT },
    { ...paper(), status: 'submitted', submittedAt: T1, result: { ...RESULT, max: 7 } },
    { ...custom(), spec: customSpec({ count: 30 }) },
    { ...custom(), spec: customSpec({ minutes: 4 }) },
    { ...custom(), spec: customSpec({ fromYear: 2020, toYear: 2019 }) },
    { ...custom(), spec: customSpec({ seed: -1 }) },
    { ...custom(), spec: customSpec({ skipDone: 'yes' }) },
  ];
  for (const raw of bad) assert.equal(parseAttempt(raw), null, JSON.stringify(raw)?.slice(0, 120));
});

test('a set spec keeps only topics inside its subjects, once each', () => {
  const parsed = roundTrip({
    ...custom(),
    spec: customSpec({ topics: [['Indian Polity', 'X'], ['Geography', 'Y'], ['Indian Polity', 'X']] }),
  });
  assert.deepEqual(parsed.spec.topics, [['Indian Polity', 'X']]);
});

test('an attempt that is not submitted carries no submit time or result', () => {
  const parsed = roundTrip({ ...paper(), submittedAt: T1, result: RESULT });
  assert.equal(parsed.submittedAt, null);
  assert.equal(parsed.result, null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `site/`): `node --test tests/mock-attempt.test.js`
Expected: FAIL, because `Cannot find module '../src/lib/tests/attempt.js'`.

- [ ] **Step 3: Implement `attempt.js`**

`site/src/lib/tests/attempt.js`:

```js
import { isQuestionKey } from '../accounts/qkey.js';

// One mock test, as this device keeps it (store.js) and the account holds it
// (merge.js maps it to a test_attempts row). Pure: no DOM, no storage. Every
// change is a function from one attempt to the next, returning the very same
// object when nothing changes, so a caller can tell "nothing to save" with ===.
// A closed attempt (submitted or abandoned) takes no further change.

export const EXAM = 'upsc';
export const MAX_KEYS = 150; // the longest UPSC paper (1995–2010) had 150 questions
export const OPTIONS = ['a', 'b', 'c', 'd'];
export const COUNTS = [10, 25, 50, 100];
export const PAPER_MINUTES = 120; // GS Paper I
export const MIN_MINUTES = 5;
export const MAX_MINUTES = 180;
export const MINUTE = 60 * 1000;
export const STATUSES = ['in_progress', 'submitted', 'abandoned'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const isIso = (v) => typeof v === 'string' && Number.isFinite(Date.parse(v));
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isOption = (v) => typeof v === 'string' && OPTIONS.includes(v);

export function newAttempt({ id, kind, spec, keys, limitMs, now }) {
  return {
    id,
    exam: EXAM,
    kind,
    spec,
    keys: [...keys],
    answers: {},
    review: [],
    current: 0,
    limitMs,
    elapsedMs: 0,
    status: 'in_progress',
    startedAt: now,
    updatedAt: now,
    submittedAt: null,
    result: null,
    syncedAt: null,
  };
}

const open = (a) => a.status === 'in_progress';
const touch = (a, changes, now) => ({ ...a, ...changes, updatedAt: now });

export function chooseAnswer(a, key, option, now) {
  if (!open(a) || !a.keys.includes(key) || !isOption(option) || a.answers[key] === option) return a;
  return touch(a, { answers: { ...a.answers, [key]: option } }, now);
}

export function clearAnswer(a, key, now) {
  if (!open(a) || !Object.hasOwn(a.answers, key)) return a;
  const answers = { ...a.answers };
  delete answers[key];
  return touch(a, { answers }, now);
}

export function toggleReview(a, key, now) {
  if (!open(a) || !a.keys.includes(key)) return a;
  const review = a.review.includes(key) ? a.review.filter((k) => k !== key) : [...a.review, key];
  return touch(a, { review }, now);
}

export function moveTo(a, index, now) {
  if (!open(a)) return a;
  const current = Math.min(Math.max(0, Math.trunc(index) || 0), a.keys.length - 1);
  return current === a.current ? a : touch(a, { current }, now);
}

export function addElapsed(a, ms, now) {
  if (!open(a) || !(ms > 0)) return a;
  return touch(a, { elapsedMs: Math.min(a.limitMs, a.elapsedMs + Math.round(ms)) }, now);
}

export const remainingMs = (a) => Math.max(0, a.limitMs - a.elapsedMs);

export function submitAttempt(a, result, now) {
  if (!open(a)) return a;
  return touch(a, { status: 'submitted', submittedAt: now, result }, now);
}

export function abandonAttempt(a, now) {
  if (!open(a)) return a;
  return touch(a, { status: 'abandoned' }, now);
}

/** What the student sees an attempt called: in Carry on, Past results and the test screen. */
export function attemptName(a) {
  if (a.kind === 'paper') return `UPSC Prelims ${a.spec.year}`;
  const { subjects, topics } = a.spec;
  if (subjects.length === 0) return 'Practice: all subjects';
  if (subjects.length > 1) return `Practice: ${subjects.length} subjects`;
  const mine = topics.filter(([s]) => s === subjects[0]);
  return mine.length === 1 ? `Practice: ${mine[0][1]}` : `Practice: ${subjects[0]}`;
}

export const progressLine = (a) => `${Object.keys(a.answers).length} of ${a.keys.length} answered`;

// --- Reading an attempt back. Storage and the account are not trusted: a bad
// shape is refused (null), a bad part inside a good shape is dropped. ---

function parseSpec(kind, s) {
  if (!isObject(s)) return null;
  if (kind === 'paper') return isInt(s.year, 1900, 2999) ? { year: s.year } : null;
  if (!Array.isArray(s.subjects) || !s.subjects.every((x) => typeof x === 'string')) return null;
  if (!Array.isArray(s.topics)) return null;
  const subjects = [...new Set(s.subjects)];
  const topics = new Map();
  for (const t of s.topics) {
    if (Array.isArray(t) && t.length === 2 && typeof t[0] === 'string' && typeof t[1] === 'string' && subjects.includes(t[0])) {
      topics.set(JSON.stringify(t), [t[0], t[1]]);
    }
  }
  if (!isInt(s.fromYear, 1900, 2999) || !isInt(s.toYear, s.fromYear, 2999)) return null;
  if (!COUNTS.includes(s.count) || !isInt(s.minutes, MIN_MINUTES, MAX_MINUTES) || !isInt(s.seed, 0, 0xffffffff)) return null;
  if (typeof s.skipDone !== 'boolean' || typeof s.onlyReview !== 'boolean') return null;
  return {
    subjects,
    topics: [...topics.values()],
    fromYear: s.fromYear,
    toYear: s.toYear,
    count: s.count,
    minutes: s.minutes,
    skipDone: s.skipDone,
    onlyReview: s.onlyReview,
    seed: s.seed,
  };
}

function parseResult(r) {
  if (!isObject(r)) return null;
  const { scored, right, wrong, blank, score, max } = r;
  if (![scored, right, wrong, blank].every((n) => isInt(n, 0, MAX_KEYS))) return null;
  if (right + wrong + blank !== scored || max !== 2 * scored) return null;
  if (typeof score !== 'number' || !Number.isFinite(score)) return null;
  return { scored, right, wrong, blank, score, max };
}

export function parseAttempt(raw) {
  if (!isObject(raw)) return null;
  const { id, exam, kind, status } = raw;
  if (typeof id !== 'string' || !UUID.test(id)) return null;
  if (typeof exam !== 'string' || !/^[a-z]+$/.test(exam)) return null;
  if (kind !== 'paper' && kind !== 'custom') return null;
  if (!STATUSES.includes(status)) return null;
  const spec = parseSpec(kind, raw.spec);
  if (!spec) return null;

  const keys = raw.keys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > MAX_KEYS || !keys.every(isQuestionKey)) return null;
  const inTest = new Set(keys);
  if (inTest.size !== keys.length) return null;

  const answers = {};
  if (isObject(raw.answers)) {
    for (const [k, v] of Object.entries(raw.answers)) if (inTest.has(k) && isOption(v)) answers[k] = v;
  }
  const review = Array.isArray(raw.review) ? [...new Set(raw.review.filter((k) => inTest.has(k)))] : [];

  const limitMs = raw.limitMs;
  if (!isInt(limitMs, MIN_MINUTES * MINUTE, MAX_MINUTES * MINUTE)) return null;
  if (!isInt(raw.elapsedMs, 0, Number.MAX_SAFE_INTEGER)) return null;
  const elapsedMs = Math.min(raw.elapsedMs, limitMs);
  const current = Number.isInteger(raw.current) ? Math.min(Math.max(raw.current, 0), keys.length - 1) : 0;

  if (!isIso(raw.startedAt) || !isIso(raw.updatedAt)) return null;
  const submitted = status === 'submitted';
  const result = submitted ? parseResult(raw.result) : null;
  if (submitted && (!result || !isIso(raw.submittedAt))) return null;

  return {
    id,
    exam,
    kind,
    spec,
    keys: [...keys],
    answers,
    review,
    current,
    limitMs,
    elapsedMs,
    status,
    startedAt: raw.startedAt,
    updatedAt: raw.updatedAt,
    submittedAt: submitted ? raw.submittedAt : null,
    result,
    syncedAt: isIso(raw.syncedAt) ? raw.syncedAt : null,
  };
}
```

- [ ] **Step 4: Run the attempt tests to verify they pass**

Run: `node --test tests/mock-attempt.test.js`
Expected: PASS (all tests).

- [ ] **Step 5: Write the failing tests for scoring**

`site/tests/mock-score.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  accuracy,
  bySubject,
  formatDate,
  formatDuration,
  formatScore,
  marks,
  officialAnswer,
  resultLine,
  scoreAttempt,
} from '../src/lib/tests/score.js';
import { canStartTest } from '../src/lib/tests/access.js';

test('marks: +2 right, minus two-thirds wrong, to two decimals', () => {
  assert.equal(marks(62, 17), 112.67);
  assert.equal(marks(64, 18), 116);
  assert.equal(marks(0, 1), -0.67);
  assert.equal(marks(0, 2), -1.33);
  assert.equal(marks(0, 3), -2);
  assert.equal(marks(0, 0), 0);
  assert.equal(marks(100, 0), 200);
});

test('only an option is an official answer, and a cancelled question has none', () => {
  assert.equal(officialAnswer({ answer: 'b', status: 'ok' }), 'b');
  assert.equal(officialAnswer({ answer: 'c', status: 'disputed' }), 'c');
  assert.equal(officialAnswer({ answer: '', status: 'disputed' }), null);
  assert.equal(officialAnswer({ answer: 'a', status: 'cancelled' }), null);
  assert.equal(officialAnswer({ answer: 'e', status: 'ok' }), null);
  assert.equal(officialAnswer(null), null);
});

test('scoring counts right, wrong and blank among scored questions only', () => {
  const official = { k1: 'a', k2: 'b', k3: 'c', k4: null, k5: 'd' };
  const r = scoreAttempt(['k1', 'k2', 'k3', 'k4', 'k5'], { k1: 'a', k2: 'c', k4: 'a' }, (k) => official[k]);
  assert.deepEqual(r, { scored: 4, right: 1, wrong: 1, blank: 2, score: 1.33, max: 8 });
});

test('a test with nothing scorable scores 0 out of 0', () => {
  assert.deepEqual(scoreAttempt(['k1'], { k1: 'a' }, () => null), { scored: 0, right: 0, wrong: 0, blank: 0, score: 0, max: 0 });
});

test('formatting: score to two decimals, accuracy of answered, durations in hours and minutes', () => {
  assert.equal(formatScore(112.67), '112.67');
  assert.equal(formatScore(116), '116.00');
  assert.equal(formatScore(-0.67), '-0.67');
  assert.equal(accuracy({ right: 3, wrong: 1 }), 0.75);
  assert.equal(accuracy({ right: 0, wrong: 0 }), null);
  assert.equal(formatDuration(108 * 60000 + 59000), '1 h 48 m');
  assert.equal(formatDuration(120 * 60000), '2 h 0 m');
  assert.equal(formatDuration(12 * 60000), '12 m');
  assert.equal(formatDuration(59000), '0 m');
});

test('the result line reads as the spec shows it', () => {
  const r = { scored: 100, right: 62, wrong: 17, blank: 21, score: 112.67, max: 200 };
  assert.equal(resultLine(r, 108 * 60000), 'Score 112.67 / 200 · 62 right · 17 wrong · 21 not answered · 1 h 48 m');
});

test('dates read as day, short month, year', () => {
  assert.equal(formatDate('2026-10-09T12:00:00.000Z'), new Date('2026-10-09T12:00:00.000Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }));
});

test('by subject: right, wrong and blank per subject, A to Z, scored questions only', () => {
  const entries = {
    k1: { subject: 'Indian Polity', answer: 'a', status: 'ok' },
    k2: { subject: 'Geography', answer: 'b', status: 'ok' },
    k3: { subject: 'Indian Polity', answer: 'c', status: 'ok' },
    k4: { subject: 'Geography', answer: '', status: 'disputed' },
    k5: { subject: 'Art & Culture', answer: 'd', status: 'ok' },
  };
  const rows = bySubject(['k1', 'k2', 'k3', 'k4', 'k5', 'gone'], { k1: 'a', k2: 'a', k4: 'b' }, (k) => entries[k] ?? null);
  assert.deepEqual(rows, [
    { subject: 'Art & Culture', right: 0, wrong: 0, blank: 1 },
    { subject: 'Geography', right: 0, wrong: 1, blank: 0 },
    { subject: 'Indian Polity', right: 1, wrong: 0, blank: 1 },
  ]);
});

test('during the beta anyone can start a test', async () => {
  assert.equal(await canStartTest('upsc'), true);
});
```

- [ ] **Step 6: Run to verify they fail**

Run: `node --test tests/mock-score.test.js`
Expected: FAIL, because the modules are missing.

- [ ] **Step 7: Implement `score.js` and `access.js`**

`site/src/lib/tests/score.js`:

```js
// Scoring a test by today's UPSC rules (spec, Decisions): +2 for a right
// answer, minus two-thirds of a mark for a wrong one, 0 for a blank. A question
// with no official answer (cancelled, or disputed with none recorded) is not
// scored: it counts in none of the numbers. Pure, so the rules are tested here.

const OPTION = /^[abcd]$/;

/** The answer a question is scored against, from a full-file entry: 'a'..'d', or null when it is not scored. */
export function officialAnswer(entry) {
  if (!entry || entry.status === 'cancelled' || typeof entry.answer !== 'string') return null;
  return OPTION.test(entry.answer) ? entry.answer : null;
}

// (6r − 2w) / 3 is 2r − ⅔w without adding up thirds in floating point. Its
// hundredths are whole or a third or two-thirds off, never a half, so
// Math.round has no tie to break.
export const marks = (right, wrong) => Math.round(((6 * right - 2 * wrong) / 3) * 100) / 100;

/**
 * @param keys       the test's questions, in order
 * @param answers    { [key]: 'a'..'d' } as the student left them
 * @param officialOf key -> 'a'..'d' | null (null: not scored)
 */
export function scoreAttempt(keys, answers, officialOf) {
  let scored = 0;
  let right = 0;
  let wrong = 0;
  for (const key of keys) {
    const official = officialOf(key);
    if (!official) continue;
    scored += 1;
    const mine = Object.hasOwn(answers, key) ? answers[key] : null;
    if (!mine) continue;
    if (mine === official) right += 1;
    else wrong += 1;
  }
  return { scored, right, wrong, blank: scored - right - wrong, score: marks(right, wrong), max: 2 * scored };
}

export const formatScore = (n) => n.toFixed(2);

/** Right ÷ answered, or null when nothing scored was answered. */
export const accuracy = (r) => (r.right + r.wrong ? r.right / (r.right + r.wrong) : null);

export function formatDuration(ms) {
  const minutes = Math.floor(ms / 60000);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} h ${m} m` : `${m} m`;
}

export const formatDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

export function resultLine(result, usedMs) {
  return [
    `Score ${formatScore(result.score)} / ${result.max}`,
    `${result.right} right`,
    `${result.wrong} wrong`,
    `${result.blank} not answered`,
    formatDuration(usedMs),
  ].join(' · ');
}

/**
 * Right, wrong and blank per subject, A to Z, over the scored questions.
 * `entryOf(key)` is the question's full-file entry, or null when its year did
 * not load or it is gone: such a question is in no row.
 */
export function bySubject(keys, answers, entryOf) {
  const rows = new Map();
  for (const key of keys) {
    const entry = entryOf(key);
    const official = officialAnswer(entry);
    if (!official) continue;
    const row = rows.get(entry.subject) ?? { subject: entry.subject, right: 0, wrong: 0, blank: 0 };
    const mine = Object.hasOwn(answers, key) ? answers[key] : null;
    if (!mine) row.blank += 1;
    else if (mine === official) row.right += 1;
    else row.wrong += 1;
    rows.set(entry.subject, row);
  }
  return [...rows.values()].sort((a, b) => a.subject.localeCompare(b.subject, 'en'));
}
```

`site/src/lib/tests/access.js`:

```js
// Every way into a test asks this first: the Start button on a paper, and the
// practice-set form. During the beta tests are free, so the answer is yes.
// Part 3 (payments) replaces this body with the entitlement check for `exam`;
// no other code may decide who can take a test (spec, "Future upgrade check").
// Async already, because that check will need the network.
export async function canStartTest(exam) {
  void exam;
  return true;
}
```

- [ ] **Step 8: Run to verify the scoring tests pass**

Run: `node --test tests/mock-score.test.js`
Expected: PASS.

- [ ] **Step 9: Write the failing tests for storage**

`site/tests/mock-store.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, chooseAnswer, newAttempt, submitAttempt } from '../src/lib/tests/attempt.js';
import {
  MAX_ATTEMPTS,
  TESTS_KEY,
  emptyTests,
  finished,
  getAttempt,
  inProgressPaper,
  latestLine,
  loadTests,
  parseTests,
  pruneAttempts,
  putAttempt,
  saveTests,
  unfinished,
} from '../src/lib/tests/store.js';
import { formatDate } from '../src/lib/tests/score.js';

const KEYS = ['upsc-2019-1', 'upsc-2019-2'];
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = (minute) => new Date(Date.UTC(2026, 9, 9, 10, minute)).toISOString();
const make = (n, { year = 2019, minute = n } = {}) =>
  newAttempt({ id: id(n), kind: 'paper', spec: { year }, keys: KEYS, limitMs: 120 * MINUTE, now: at(minute) });
const RESULT = { scored: 2, right: 1, wrong: 0, blank: 1, score: 2, max: 4 };

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)) };
}

test('nothing stored, or garbage stored, reads as no attempts', () => {
  for (const raw of [null, '', 'nope', '[]', '{"attempts":[]}', '{"attempts":null}']) {
    assert.deepEqual(parseTests(raw), emptyTests(), String(raw));
  }
});

test('a stored attempt filed under another id, or malformed, is dropped; good ones stay', () => {
  const good = make(1);
  const raw = JSON.stringify({ attempts: { [good.id]: good, [id(9)]: make(2), [id(3)]: { nope: true } } });
  assert.deepEqual(parseTests(raw), { attempts: { [good.id]: good } });
});

test('save then load gives the same attempts', () => {
  const storage = memoryStorage();
  const tests = putAttempt(putAttempt(emptyTests(), make(1)), make(2));
  assert.equal(saveTests(tests, storage), true);
  assert.ok(storage.map.has(TESTS_KEY));
  assert.deepEqual(loadTests(storage), tests);
});

test('storage that refuses: save says false, load reads empty, neither throws', () => {
  const refusing = {
    getItem() {
      throw new Error('SecurityError');
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
  };
  assert.equal(saveTests(putAttempt(emptyTests(), make(1)), refusing), false);
  assert.deepEqual(loadTests(refusing), emptyTests());
});

test('the device keeps the 200 most recently updated attempts', () => {
  let tests = emptyTests();
  for (let n = 1; n <= MAX_ATTEMPTS + 5; n += 1) tests = putAttempt(tests, make(n));
  const kept = pruneAttempts(tests.attempts);
  assert.equal(Object.keys(kept).length, MAX_ATTEMPTS);
  for (let n = 1; n <= 5; n += 1) assert.ok(!(id(n) in kept), `oldest ${n} dropped`);
  const storage = memoryStorage();
  saveTests(tests, storage);
  assert.equal(Object.keys(loadTests(storage).attempts).length, MAX_ATTEMPTS);
});

test('unfinished newest first; finished newest submitted first; abandoned in neither', () => {
  const a = make(1);
  const b = make(2);
  const c = submitAttempt(make(3), RESULT, at(30));
  const d = submitAttempt(make(4), RESULT, at(20));
  const e = { ...make(5), status: 'abandoned' };
  const tests = [a, b, c, d, e].reduce(putAttempt, emptyTests());
  assert.deepEqual(unfinished(tests).map((x) => x.id), [b.id, a.id]);
  assert.deepEqual(finished(tests).map((x) => x.id), [c.id, d.id]);
});

test('the unfinished attempt of a paper is found by year', () => {
  const tests = [make(1, { year: 2018 }), make(2, { year: 2019 }), submitAttempt(make(3, { year: 2020 }), RESULT, at(9))].reduce(
    putAttempt,
    emptyTests()
  );
  assert.equal(inProgressPaper(tests, 2019).id, id(2));
  assert.equal(inProgressPaper(tests, 2020), null);
});

test('getAttempt reads own entries only', () => {
  const tests = putAttempt(emptyTests(), make(1));
  assert.equal(getAttempt(tests, id(1)).id, id(1));
  assert.equal(getAttempt(tests, 'constructor'), null);
});

test('the /account line: the latest result, or that there is none', () => {
  assert.equal(latestLine(emptyTests()), 'No tests taken yet.');
  const done = submitAttempt(chooseAnswer(make(1), KEYS[0], 'a', at(2)), RESULT, at(40));
  assert.equal(latestLine(putAttempt(emptyTests(), done)), `Latest: UPSC Prelims 2019, 2.00 / 4, on ${formatDate(at(40))}.`);
});
```

- [ ] **Step 10: Run to verify they fail**

Run: `node --test tests/mock-store.test.js`
Expected: FAIL, because `store.js` is missing.

- [ ] **Step 11: Implement `store.js`**

`site/src/lib/tests/store.js`:

```js
import { attemptName, parseAttempt } from './attempt.js';
import { formatDate, formatScore } from './score.js';

// The device's attempts, under their own key, apart from marks and lists
// (sawaalbox-progress-v1). Signed out, this is all there is; signed in, it is
// a cache of the account that works offline. Shape: { attempts: { [id]: attempt } }.
export const TESTS_KEY = 'sawaalbox-tests-v1';

// The device keeps this many, the most recently updated; older ones stay in
// the account (spec, "Attempt record").
export const MAX_ATTEMPTS = 200;

export const emptyTests = () => ({ attempts: {} });

export function parseTests(raw) {
  try {
    const s = JSON.parse(raw);
    const attempts = {};
    if (s && typeof s === 'object' && s.attempts && typeof s.attempts === 'object' && !Array.isArray(s.attempts)) {
      for (const [id, value] of Object.entries(s.attempts)) {
        const a = parseAttempt(value);
        // Filed under its own id, or not at all: the id is what sync matches on.
        if (a && a.id === id) attempts[id] = a;
      }
    }
    return { attempts };
  } catch {
    return emptyTests();
  }
}

export function loadTests(storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    return parseTests(s.getItem(TESTS_KEY));
  } catch {
    return emptyTests();
  }
}

const newestFirst = (field) => (x, y) => Date.parse(y[field]) - Date.parse(x[field]) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);

export function pruneAttempts(attempts, max = MAX_ATTEMPTS) {
  const all = Object.values(attempts);
  if (all.length <= max) return attempts;
  return Object.fromEntries(all.sort(newestFirst('updatedAt')).slice(0, max).map((a) => [a.id, a]));
}

// True when written, false when storage refused (blocked, private mode, full).
// Never throws: the caller holds the attempt in memory and says it is not saved.
export function saveTests(tests, storage = undefined) {
  try {
    const s = storage ?? globalThis.localStorage;
    s.setItem(TESTS_KEY, JSON.stringify({ attempts: pruneAttempts(tests.attempts) }));
    return true;
  } catch {
    return false;
  }
}

export const putAttempt = (tests, a) => ({ ...tests, attempts: { ...tests.attempts, [a.id]: a } });

export const getAttempt = (tests, id) => (Object.hasOwn(tests.attempts, id) ? tests.attempts[id] : null);

/** Carry on: unfinished attempts, the one touched last first. */
export const unfinished = (tests) =>
  Object.values(tests.attempts)
    .filter((a) => a.status === 'in_progress')
    .sort(newestFirst('updatedAt'));

/** Past results: submitted attempts, the newest submission first. Abandoned ones never count. */
export const finished = (tests) =>
  Object.values(tests.attempts)
    .filter((a) => a.status === 'submitted')
    .sort(newestFirst('submittedAt'));

export const inProgressPaper = (tests, year) =>
  unfinished(tests).find((a) => a.kind === 'paper' && a.spec.year === year) ?? null;

/** The line /account shows under Practice tests. */
export function latestLine(tests) {
  const [latest] = finished(tests);
  if (!latest) return 'No tests taken yet.';
  return `Latest: ${attemptName(latest)}, ${formatScore(latest.result.score)} / ${latest.result.max}, on ${formatDate(latest.submittedAt)}.`;
}
```

- [ ] **Step 12: Run every test**

Run: `npm test` (from `site/`)
Expected: PASS. All pre-existing tests still pass, plus the three new files.

- [ ] **Step 13: Commit**

```bash
git add site/src/lib/tests site/tests/mock-attempt.test.js site/tests/mock-score.test.js site/tests/mock-store.test.js
git commit -m "feat(tests): attempt record, device storage, scoring and the access hook"
```

### Task 2: Papers, practice sets and the catalogue

**Files:**
- Create: `site/src/lib/tests/catalogue.js`, `site/src/lib/tests/build.js`, `site/src/lib/papers.js`, `site/src/pages/upsc/catalogue.json.js`
- Test: `site/tests/mock-build.test.js`, `site/tests/catalogue.test.js`

**Interfaces:**
- **Consumes:**
  - `questionKey(exam, year, qNo)` and `isQuestionKey` from `site/src/lib/accounts/qkey.js`.
  - `fullEntry(file, key)` and `parseKey(key)` from `site/src/lib/accounts/summary.js`.
  - `ALL_QUESTIONS`, `YEARS` and `questionsForYear` from `site/src/lib/corpus.js` (build time only).
  - `MIN_MINUTES` and `MAX_MINUTES` from Task 1's `attempt.js`.
- **Produces:**
  - `catalogue.js`:
    - `FLAG = { ok: 0, disputed: 1, unanswered: 2, cancelled: 3 }`, `flagOf(q)`
    - `buildCatalogue(questions) → { subjects, topics, questions }`
    - `parseCatalogue(data) → { subjects: string[], topics: { subject, name }[], entries: { key, subject, topic, year, flag }[] } | null`, with entries ordered by year, then number.
  - `build.js`:
    - `paperKeys(year, fullFile) → string[]`
    - `paperInfo(year, questions) → { year, present, highest, missing, cancelled, questions }`
    - `paperNotes(info) → string[]`
    - `setPool(spec, catalogue, entries) → string[]`
    - `drawSet(pool, count, seed) → string[]`
    - `mulberry32(seed) → () => number`, `newSeed() → number`
    - `defaultMinutes(n) → number`
  - `papers.js` (build time): `PAPERS: { year, questions, notes: string[] }[]`, newest first.
  - The endpoint `/upsc/catalogue.json`.

- [ ] **Step 1: Write the failing tests for building papers and sets**

`site/tests/mock-build.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLAG } from '../src/lib/tests/catalogue.js';
import { defaultMinutes, drawSet, mulberry32, newSeed, paperInfo, paperKeys, paperNotes, setPool } from '../src/lib/tests/build.js';
import { questionsForYear } from '../src/lib/corpus.js';

const full = (year, qNo, status = 'ok', answer = 'a') => ({
  year,
  q_no: qNo,
  subject: 'Geography',
  subtopic: 'Rivers',
  difficulty: 'easy',
  question: `Q${qNo}`,
  a: 'A',
  b: 'B',
  c: 'C',
  d: 'D',
  answer,
  answer_note: '',
  status,
});

test('a paper is every question of its year but the cancelled ones, in question-number order', () => {
  const file = {
    'upsc-2020-3': full(2020, 3),
    'upsc-2020-1': full(2020, 1),
    'upsc-2020-2': full(2020, 2, 'cancelled', ''),
    'upsc-2020-10': full(2020, 10, 'disputed', ''),
    'upsc-2019-4': full(2019, 4), // filed in the wrong year's file
    'upsc-2020-7': { nope: true }, // malformed
  };
  assert.deepEqual(paperKeys(2020, file), ['upsc-2020-1', 'upsc-2020-3', 'upsc-2020-10']);
});

test('paper notes say what is missing and what UPSC cancelled', () => {
  assert.deepEqual(paperNotes({ present: 98, highest: 100, missing: 2, cancelled: 0 }), ["98 of 100 questions: 2 aren't in our copy"]);
  assert.deepEqual(paperNotes({ present: 99, highest: 100, missing: 1, cancelled: 1 }), [
    "99 of 100 questions: 1 isn't in our copy",
    '1 question cancelled by UPSC is left out',
  ]);
  assert.deepEqual(paperNotes({ present: 100, highest: 100, missing: 0, cancelled: 2 }), ['2 questions cancelled by UPSC are left out']);
  assert.deepEqual(paperNotes({ present: 100, highest: 100, missing: 0, cancelled: 0 }), []);
});

test('paper info from the real corpus: 1995 lacks 3 numbers, 2020 had 2 cancelled', () => {
  const y1995 = paperInfo(1995, questionsForYear(1995));
  assert.deepEqual(y1995, { year: 1995, present: 147, highest: 150, missing: 3, cancelled: 0, questions: 147 });
  assert.deepEqual(paperNotes(y1995), ["147 of 150 questions: 3 aren't in our copy"]);
  const y2020 = paperInfo(2020, questionsForYear(2020));
  assert.deepEqual(y2020, { year: 2020, present: 100, highest: 100, missing: 0, cancelled: 2, questions: 98 });
});

// A small catalogue, as parseCatalogue returns it.
const entry = (key, subject, topic, flag = FLAG.ok) => ({ key, subject, topic, year: Number(key.split('-')[1]), flag });
const CATALOGUE = {
  subjects: ['Geography', 'Indian Polity'],
  topics: [],
  entries: [
    entry('upsc-2001-1', 'Indian Polity', 'Parliament'),
    entry('upsc-2001-2', 'Geography', 'Rivers'),
    entry('upsc-2010-5', 'Indian Polity', 'Fundamental Rights'),
    entry('upsc-2015-9', 'Indian Polity', 'Parliament', FLAG.cancelled),
    entry('upsc-2016-3', 'Indian Polity', 'Parliament', FLAG.unanswered),
    entry('upsc-2018-7', 'Indian Polity', 'Parliament', FLAG.disputed),
    entry('upsc-2020-2', 'Geography', 'Rivers'),
  ],
};
const spec = (o = {}) => ({ subjects: [], topics: [], fromYear: 1995, toYear: 2026, count: 10, minutes: 12, skipDone: false, onlyReview: false, seed: 1, ...o });
const mark = (status) => ({ status, updatedAt: '2026-10-01T00:00:00.000Z', synced: false });

test('the pool: every scorable question, nothing cancelled or without an answer', () => {
  assert.deepEqual(setPool(spec(), CATALOGUE, {}), ['upsc-2001-1', 'upsc-2001-2', 'upsc-2010-5', 'upsc-2018-7', 'upsc-2020-2']);
});

test('the pool follows subjects, topics within a subject, and years', () => {
  assert.deepEqual(setPool(spec({ subjects: ['Geography'] }), CATALOGUE, {}), ['upsc-2001-2', 'upsc-2020-2']);
  assert.deepEqual(
    setPool(spec({ subjects: ['Indian Polity', 'Geography'], topics: [['Indian Polity', 'Parliament']] }), CATALOGUE, {}),
    ['upsc-2001-1', 'upsc-2001-2', 'upsc-2018-7', 'upsc-2020-2']
  );
  assert.deepEqual(setPool(spec({ fromYear: 2005, toYear: 2018 }), CATALOGUE, {}), ['upsc-2010-5', 'upsc-2018-7']);
});

test('the switches: skip Done, or only Needs review (filters still apply)', () => {
  const marks = { 'upsc-2001-1': mark('done'), 'upsc-2010-5': mark('review'), 'upsc-2020-2': mark('review') };
  assert.deepEqual(setPool(spec({ skipDone: true }), CATALOGUE, marks), ['upsc-2001-2', 'upsc-2010-5', 'upsc-2018-7', 'upsc-2020-2']);
  assert.deepEqual(setPool(spec({ onlyReview: true }), CATALOGUE, marks), ['upsc-2010-5', 'upsc-2020-2']);
  assert.deepEqual(setPool(spec({ onlyReview: true, subjects: ['Geography'] }), CATALOGUE, marks), ['upsc-2020-2']);
});

test('the draw: no repeats, the requested count, all of a small pool, and the same seed gives the same set', () => {
  const pool = Array.from({ length: 300 }, (_, i) => `upsc-2019-${i + 1}`);
  const a = drawSet(pool, 25, 12345);
  assert.equal(a.length, 25);
  assert.equal(new Set(a).size, 25);
  assert.ok(a.every((k) => pool.includes(k)));
  assert.deepEqual(drawSet(pool, 25, 12345), a);
  assert.notDeepEqual(drawSet(pool, 25, 54321), a);
  assert.deepEqual(new Set(drawSet(pool.slice(0, 7), 25, 1)), new Set(pool.slice(0, 7)));
  assert.deepEqual(drawSet([], 10, 1), []);
  assert.deepEqual(pool.length, 300, 'the pool itself is not shuffled');
  assert.equal(pool[0], 'upsc-2019-1');
});

test('the generator is deterministic and stays in [0, 1)', () => {
  const r1 = mulberry32(7);
  const r2 = mulberry32(7);
  for (let i = 0; i < 1000; i += 1) {
    const x = r1();
    assert.equal(x, r2());
    assert.ok(x >= 0 && x < 1);
  }
  const seed = newSeed();
  assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff);
});

test('default time is 1.2 minutes a question, rounded up, between 5 and 180', () => {
  assert.deepEqual([10, 25, 50, 100, 3, 12, 150, 1000].map(defaultMinutes), [12, 30, 60, 120, 5, 15, 180, 180]);
});
```

- [ ] **Step 2: Write the failing tests for the catalogue**

`site/tests/catalogue.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { GET } from '../src/pages/upsc/catalogue.json.js';
import { ALL_QUESTIONS } from '../src/lib/corpus.js';
import { FLAG, buildCatalogue, flagOf, parseCatalogue } from '../src/lib/tests/catalogue.js';

// Built exactly as the build builds it.
const body = await GET().text();
const data = JSON.parse(body);

test('every question is in the catalogue, under its key', () => {
  assert.equal(Object.keys(data.questions).length, ALL_QUESTIONS.length);
  for (const q of ALL_QUESTIONS) assert.ok(Object.hasOwn(data.questions, q.qkey), q.qkey);
});

test('the endpoint serves buildCatalogue of the corpus', () => {
  assert.deepEqual(data, buildCatalogue(ALL_QUESTIONS));
});

test('flags: 9 cancelled, 3 with no official answer, 1 disputed with one', () => {
  const counts = [0, 0, 0, 0];
  for (const [, , , flag] of Object.values(data.questions)) counts[flag] += 1;
  assert.equal(counts[FLAG.cancelled], 9);
  assert.equal(counts[FLAG.unanswered], 3);
  assert.equal(counts[FLAG.disputed], 1);
  assert.equal(counts[FLAG.ok], ALL_QUESTIONS.length - 13);
  assert.equal(flagOf({ status: 'disputed', answer: '' }), FLAG.unanswered);
  assert.equal(flagOf({ status: 'cancelled', answer: 'a' }), FLAG.cancelled);
});

test('it parses back to every question with its subject, topic and year', () => {
  const cat = parseCatalogue(data);
  assert.equal(cat.entries.length, ALL_QUESTIONS.length);
  const byKey = new Map(cat.entries.map((e) => [e.key, e]));
  for (const q of ALL_QUESTIONS) {
    const e = byKey.get(q.qkey);
    assert.deepEqual([e.subject, e.topic, e.year], [q.subject, q.subtopic, q.year], q.qkey);
  }
  assert.deepEqual(cat.subjects, [...cat.subjects].sort((a, b) => a.localeCompare(b, 'en')));
  // In order: by year, then number.
  const order = cat.entries.map((e) => [e.year, Number(e.key.split('-')[2])]);
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1][0] < order[i][0] || (order[i - 1][0] === order[i][0] && order[i - 1][1] < order[i][1]));
  }
});

test('it is small: under 25 KB gzipped', () => {
  const size = gzipSync(body).length;
  assert.ok(size < 25 * 1024, `${size} bytes`);
});

test('a catalogue that is not one is refused, and bad entries are dropped', () => {
  for (const bad of [null, [], {}, { subjects: 'x', topics: [], questions: {} }]) assert.equal(parseCatalogue(bad), null);
  const cat = parseCatalogue({
    subjects: ['Geography'],
    topics: [[0, 'Rivers'], [5, 'Bad']],
    questions: {
      'upsc-2019-1': [0, 0, 2019, 0],
      'upsc-2019-2': [0, 1, 2019, 0], // topic 1 names a subject that is not there
      'upsc-2019-3': [0, 0, 2018, 0], // year disagrees with the key
      'not-a-key': [0, 0, 2019, 0],
      'upsc-2019-4': [0, 0, 2019, 9], // no such flag
      'upsc-2019-5': 'x',
    },
  });
  assert.deepEqual(cat.entries, [{ key: 'upsc-2019-1', subject: 'Geography', topic: 'Rivers', year: 2019, flag: 0 }]);
});
```

- [ ] **Step 3: Run both to verify they fail**

Run: `node --test tests/mock-build.test.js tests/catalogue.test.js`
Expected: FAIL, because the modules are missing.

- [ ] **Step 4: Implement `catalogue.js`**

`site/src/lib/tests/catalogue.js`:

```js
import { isQuestionKey, questionKey } from '../accounts/qkey.js';

// The practice-set form's index of every question: which subject and topic it
// is filed under, its year, and whether it can be scored. Built into
// /upsc/catalogue.json (pages/upsc/catalogue.json.js) and fetched only when a
// student builds a set. Names are listed once and referred to by position:
// spelled out on every question the file is 26 KB gzipped, indexed it is 17 KB.
//   { subjects: [name], topics: [[subjectIndex, name]], questions: { key: [subjectIndex, topicIndex, year, flag] } }

export const FLAG = { ok: 0, disputed: 1, unanswered: 2, cancelled: 3 };

const OPTION = /^[abcd]$/;

/** Cancelled; else no official answer to score against; else disputed; else ok. */
export function flagOf(q) {
  if (q.status === 'cancelled') return FLAG.cancelled;
  if (typeof q.answer !== 'string' || !OPTION.test(q.answer)) return FLAG.unanswered;
  return q.status === 'disputed' ? FLAG.disputed : FLAG.ok;
}

const byText = (a, b) => a.localeCompare(b, 'en');

/** Build time: from corpus questions ({ year, q_no, subject, subtopic, status, answer }). */
export function buildCatalogue(questions) {
  const subjects = [...new Set(questions.map((q) => q.subject))].sort(byText);
  const subjectIndex = new Map(subjects.map((s, i) => [s, i]));
  const pairs = [...new Map(questions.map((q) => [`${q.subject}\u0000${q.subtopic}`, [q.subject, q.subtopic]])).values()].sort(
    (a, b) => byText(a[0], b[0]) || byText(a[1], b[1])
  );
  const topicIndex = new Map(pairs.map(([s, t], i) => [`${s}\u0000${t}`, i]));
  const topics = pairs.map(([s, t]) => [subjectIndex.get(s), t]);
  const ordered = [...questions].sort((a, b) => a.year - b.year || a.q_no - b.q_no);
  const entries = {};
  for (const q of ordered) {
    entries[questionKey('upsc', q.year, q.q_no)] = [
      subjectIndex.get(q.subject),
      topicIndex.get(`${q.subject}\u0000${q.subtopic}`),
      q.year,
      flagOf(q),
    ];
  }
  return { subjects, topics, questions: entries };
}

const KEY = /^upsc-(\d{4})-(\d{1,3})$/;
const isIndex = (v, length) => Number.isInteger(v) && v >= 0 && v < length;

/**
 * In the browser: the fetched file, checked before the form trusts it. Null
 * when it is not a catalogue at all; an entry that does not add up (an index
 * out of range, a topic of another subject, a year that is not the key's, an
 * unknown flag) is dropped. Entries come back ordered by year, then number.
 */
export function parseCatalogue(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const { subjects, topics, questions } = data;
  if (!Array.isArray(subjects) || !subjects.every((s) => typeof s === 'string')) return null;
  if (!Array.isArray(topics) || !questions || typeof questions !== 'object' || Array.isArray(questions)) return null;
  const topicList = topics.map((t) =>
    Array.isArray(t) && t.length === 2 && isIndex(t[0], subjects.length) && typeof t[1] === 'string'
      ? { subject: subjects[t[0]], name: t[1] }
      : null
  );
  const entries = [];
  for (const [key, value] of Object.entries(questions)) {
    const m = KEY.exec(key);
    if (!m || !isQuestionKey(key) || !Array.isArray(value) || value.length !== 4) continue;
    const [s, t, year, flag] = value;
    if (!isIndex(s, subjects.length) || !isIndex(t, topicList.length) || !topicList[t]) continue;
    if (topicList[t].subject !== subjects[s] || year !== Number(m[1]) || !Object.values(FLAG).includes(flag)) continue;
    entries.push({ key, subject: subjects[s], topic: topicList[t].name, year, flag, n: Number(m[2]) });
  }
  entries.sort((a, b) => a.year - b.year || a.n - b.n);
  return {
    subjects: [...subjects],
    topics: topicList.filter(Boolean),
    entries: entries.map(({ n, ...e }) => e),
  };
}
```

- [ ] **Step 5: Implement `build.js`**

`site/src/lib/tests/build.js`:

```js
import { fullEntry, parseKey } from '../accounts/summary.js';
import { MAX_MINUTES, MIN_MINUTES } from './attempt.js';
import { FLAG } from './catalogue.js';

// Which questions a test is made of. Pure: the year files, the catalogue and
// the marks come in as arguments.

/**
 * A full paper (spec, "Sit a past paper"): every question of the year in its
 * full file except those UPSC cancelled, in question-number order. Only entries
 * fullEntry accepts, filed under this year, are taken.
 */
export function paperKeys(year, fullFile) {
  return Object.keys(fullFile ?? {})
    .filter((key) => parseKey(key)?.year === year)
    .map((key) => ({ key, entry: fullEntry(fullFile, key) }))
    .filter(({ entry }) => entry.status === 'ok' && entry.q.status !== 'cancelled')
    .sort((a, b) => a.entry.q.q_no - b.entry.q.q_no)
    .map(({ key }) => key);
}

/** Build time: what the papers list says about one year, from that year's corpus questions. */
export function paperInfo(year, questions) {
  const numbers = new Set(questions.map((q) => q.q_no));
  const highest = Math.max(...numbers);
  const cancelled = questions.filter((q) => q.status === 'cancelled').length;
  return { year, present: numbers.size, highest, missing: highest - numbers.size, cancelled, questions: questions.length - cancelled };
}

export function paperNotes({ present, highest, missing, cancelled }) {
  const notes = [];
  if (missing > 0) notes.push(`${present} of ${highest} questions: ${missing} ${missing === 1 ? "isn't" : "aren't"} in our copy`);
  if (cancelled > 0) {
    notes.push(`${cancelled} ${cancelled === 1 ? 'question' : 'questions'} cancelled by UPSC ${cancelled === 1 ? 'is' : 'are'} left out`);
  }
  return notes;
}

/**
 * A practice set's pool (spec, "Picking questions"): the catalogue entries
 * matching the filters, minus questions that cannot be scored and those the
 * switches exclude, in catalogue order (year, then number), so a seed always
 * draws from the same sequence. `entries` is the progress marks,
 * { [key]: { status: 'done'|'review' } }. No subjects means every subject; a
 * subject with topics chosen is narrowed to those topics.
 */
export function setPool(spec, catalogue, entries) {
  const subjects = new Set(spec.subjects);
  const topics = new Map();
  for (const [s, t] of spec.topics) topics.set(s, (topics.get(s) ?? new Set()).add(t));
  return catalogue.entries
    .filter((e) => {
      if (e.flag === FLAG.cancelled || e.flag === FLAG.unanswered) return false;
      if (e.year < spec.fromYear || e.year > spec.toYear) return false;
      if (subjects.size && !subjects.has(e.subject)) return false;
      if (topics.has(e.subject) && !topics.get(e.subject).has(e.topic)) return false;
      const mark = Object.hasOwn(entries, e.key) ? entries[e.key].status : null;
      if (spec.onlyReview && mark !== 'review') return false;
      if (spec.skipDone && mark === 'done') return false;
      return true;
    })
    .map((e) => e.key);
}

/** A small, well-mixed generator: the same seed gives the same draw on every device. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newSeed() {
  return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
}

/** `count` keys from the pool, uniformly, without repeats (a partial Fisher–Yates on a copy). */
export function drawSet(pool, count, seed) {
  const random = mulberry32(seed);
  const keys = [...pool];
  const n = Math.min(count, keys.length);
  for (let i = 0; i < n; i += 1) {
    const j = i + Math.floor(random() * (keys.length - i));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys.slice(0, n);
}

/** ceil(1.2 × n) minutes, in whole numbers (6n/5), kept between 5 and 180. */
export const defaultMinutes = (n) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, Math.ceil((6 * n) / 5)));
```

- [ ] **Step 6: Implement the endpoint and the papers list**

`site/src/pages/upsc/catalogue.json.js`:

```js
import { ALL_QUESTIONS } from '../../lib/corpus.js';
import { buildCatalogue } from '../../lib/tests/catalogue.js';

// /upsc/catalogue.json: the practice-set form's index of every question
// (lib/tests/catalogue.js). Fetched only when a student builds a set; question
// pages and the test screen never load it.
export function GET() {
  return new Response(JSON.stringify(buildCatalogue(ALL_QUESTIONS)), {
    headers: { 'Content-Type': 'application/json' },
  });
}
```

`site/src/lib/papers.js`:

```js
import { YEARS, questionsForYear } from './corpus.js';
import { paperInfo, paperNotes } from './tests/build.js';

// Build time only (corpus.js reads the question file from disk): one entry per
// year for the papers list on /upsc/test, the year pages' "Sit this paper" line
// and the take page's start screen. Newest first, as YEARS is.
export const PAPERS = YEARS.map(({ year }) => {
  const info = paperInfo(year, questionsForYear(year));
  return { year, questions: info.questions, notes: paperNotes(info) };
});
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `node --test tests/mock-build.test.js tests/catalogue.test.js`
Expected: PASS. Note the gzip size the size test measured, for the report.

- [ ] **Step 8: Build and check the file is served**

Run: `npm run build` (from `site/`), then check that `dist/upsc/catalogue.json` exists. Record its raw and gzip sizes in the report: `node -e "const z=require('zlib'),f=require('fs').readFileSync('dist/upsc/catalogue.json');console.log(f.length, z.gzipSync(f).length)"`.
Expected: the build succeeds and the file has about 122 KB raw and 17 KB gzip.

- [ ] **Step 9: Run the whole suite and commit**

Run: `npm test`
Expected: PASS.

```bash
git add site/src/lib/tests/catalogue.js site/src/lib/tests/build.js site/src/lib/papers.js site/src/pages/upsc/catalogue.json.js site/tests/mock-build.test.js site/tests/catalogue.test.js
git commit -m "feat(tests): build papers and practice sets; serve the question catalogue"
```

### Task 3: Syncing attempts with the account

**Files:**
- Create: `supabase/migrations/20261011120000_test_attempts.sql`, `site/src/lib/tests/merge.js`, `site/src/scripts/sync-tests.js`, `site/tests/support/fake-supabase.js`, `site/tests/mock-merge.test.js`, `site/tests/sync-tests.test.js`
- Modify: `supabase/tests/rls_test.sql` (append the `test_attempts` block before the final `select 'All RLS checks passed'`), `site/src/scripts/sync.js` (third step, rebase, listener, markers), `site/tests/sync.test.js` (import the fake client from the support module; adjust assertions the third step changes)

**Interfaces:**
- **Consumes:**
  - From Task 1: `parseAttempt`, `loadTests`, `saveTests`, `TESTS_KEY`.
  - From the accounts code: `pullPages`, `pullMarker` and `deviceOwner` from `site/src/lib/accounts/pull.js`.
  - The run in `site/src/scripts/sync.js` (`syncOnce`, `claimDevice`, `forgetMarkers`, `onSignedOut`).
- **Produces:**
  - `merge.js`:
    - `isDirty(a)`
    - `toRow(a, userId)`, `fromRow(row) → attempt | null` (with `syncedAt = updatedAt`)
    - `pickAttempt(mine, theirs) → 'mine' | 'theirs'`
    - `mergeAttempts(local, rows) → { attempts, toUpload }`
    - `settleAttempts(snapshot, current, merged, scopeIds) → attempts`
    - `rebaseTests(tests) → tests`
    - `attemptsEqual(a, b)`
  - `sync-tests.js`: `syncTests(client, user, { full })`, `forgetTestsPull()`, `TESTS_MARKER_KEY = 'sawaalbox-sync-tests-v1'`.
  - **The `sawaalbox:test` event:** pages dispatch it on start, submit and abandon, and the run listens.
  - `site/tests/support/fake-supabase.js` exports `USER` and `fakeClient(rows, { maxRows, user, attempts })`. Its `client.attempts` is the `test_attempts` Map, keyed by id.

- [ ] **Step 1: Write the migration**

`supabase/migrations/20261011120000_test_attempts.sql`:

```sql
-- Mock tests: one row per attempt. The id is made on the device that started
-- it, so the same attempt is the same row from every device. Rows are never
-- deleted: there is no delete grant, and an abandoned attempt is a status.

create table public.test_attempts (
  id            uuid primary key,
  user_id       uuid not null default auth.uid() references auth.users on delete cascade,
  exam          text not null,
  kind          text not null check (kind in ('paper', 'custom')),
  spec          jsonb not null,
  question_keys text[] not null check (cardinality(question_keys) between 1 and 150),
  answers       jsonb not null,
  review_keys   text[] not null,
  current_index int not null,
  limit_ms      int not null,
  elapsed_ms    int not null check (elapsed_ms >= 0),
  status        text not null check (status in ('in_progress', 'submitted', 'abandoned')),
  started_at    timestamptz not null,
  updated_at    timestamptz not null,
  submitted_at  timestamptz,
  result        jsonb
);
create index test_attempts_user_id_idx on public.test_attempts (user_id);

alter table public.test_attempts enable row level security;

-- As for the accounts tables: nothing reachable until granted, signed-out
-- visitors get nothing, and signed-in users may read, add and change their own
-- rows, never delete them.
revoke all on public.test_attempts from anon, authenticated;
grant select, insert, update on public.test_attempts to authenticated;

create policy test_attempts_select_own on public.test_attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy test_attempts_insert_own on public.test_attempts
  for insert to authenticated
  with check (user_id = (select auth.uid()));

create policy test_attempts_update_own on public.test_attempts
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
```

- [ ] **Step 2: Extend the RLS test**

In `supabase/tests/rls_test.sql`, insert this block immediately **before** the line `select 'All RLS checks passed' as result;`. When the block starts, the session is `authenticated` as user B, and B already has its own rows from the owner-change section.

```sql
-- Mock test attempts (migration 20261011120000_test_attempts.sql).
reset role;
set local role anon;
do $$ begin
  perform 1 from public.test_attempts;
  raise exception 'FAIL: anon can read test_attempts';
exception when insufficient_privilege then null; end $$;
reset role;
set local role authenticated;

-- A writes an attempt.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000aa","role":"authenticated"}', true);
insert into public.test_attempts (id, user_id, exam, kind, spec, question_keys, answers, review_keys,
  current_index, limit_ms, elapsed_ms, status, started_at, updated_at)
values ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-0000-0000-0000000000aa', 'upsc', 'paper',
  '{"year":2019}', array['upsc-2019-1','upsc-2019-2'], '{"upsc-2019-1":"a"}', array[]::text[],
  0, 7200000, 1000, 'in_progress', now(), now());

do $$ declare n int; begin
  select count(*) into n from public.test_attempts;
  if n <> 1 then raise exception 'FAIL: A should see 1 attempt, saw %', n; end if;
  update public.test_attempts set elapsed_ms = 2000;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: A could not update its own attempt'; end if;
end $$;

-- Nobody deletes an attempt, not even its owner.
do $$ begin
  delete from public.test_attempts;
  raise exception 'FAIL: A deleted an attempt';
exception when insufficient_privilege then null; end $$;

-- B cannot see, change, take over or delete it.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000bb","role":"authenticated"}', true);
do $$ declare n int; begin
  select count(*) into n from public.test_attempts;
  if n <> 0 then raise exception 'FAIL: B can see % of A''s attempts', n; end if;
  update public.test_attempts set status = 'abandoned';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A''s attempt'; end if;
end $$;

do $$ begin
  delete from public.test_attempts;
  raise exception 'FAIL: B deleted an attempt';
exception when insufficient_privilege then null; end $$;

do $$ begin
  insert into public.test_attempts (id, user_id, exam, kind, spec, question_keys, answers, review_keys,
    current_index, limit_ms, elapsed_ms, status, started_at, updated_at)
  values ('00000000-0000-4000-8000-0000000000b7', '00000000-0000-0000-0000-0000000000aa', 'upsc', 'paper',
    '{"year":2019}', array['upsc-2019-1'], '{}', array[]::text[], 0, 7200000, 0, 'in_progress', now(), now());
  raise exception 'FAIL: B wrote an attempt as A';
exception when insufficient_privilege then null; end $$;

-- B's own attempt, which B then tries to hand to A.
insert into public.test_attempts (id, user_id, exam, kind, spec, question_keys, answers, review_keys,
  current_index, limit_ms, elapsed_ms, status, started_at, updated_at)
values ('00000000-0000-4000-8000-0000000000b8', '00000000-0000-0000-0000-0000000000bb', 'upsc', 'paper',
  '{"year":2020}', array['upsc-2020-1'], '{}', array[]::text[], 0, 7200000, 0, 'in_progress', now(), now());

do $$ begin
  update public.test_attempts set user_id = '00000000-0000-0000-0000-0000000000aa'
  where id = '00000000-0000-4000-8000-0000000000b8';
  raise exception 'FAIL: B changed its attempt''s owner to A';
exception when insufficient_privilege then null; end $$;

-- An upsert onto A's id is refused, as the sync's upsert would be.
do $$ begin
  insert into public.test_attempts (id, user_id, exam, kind, spec, question_keys, answers, review_keys,
    current_index, limit_ms, elapsed_ms, status, started_at, updated_at)
  values ('00000000-0000-4000-8000-0000000000a7', '00000000-0000-0000-0000-0000000000bb', 'upsc', 'paper',
    '{"year":2019}', array['upsc-2019-1'], '{}', array[]::text[], 0, 7200000, 0, 'in_progress', now(), now())
  on conflict (id) do update set status = excluded.status;
  raise exception 'FAIL: B upserted over A''s attempt';
exception when insufficient_privilege then null; end $$;
```

Do not run this against the hosted project. The owner applies the migration and runs the whole RLS test in the Supabase SQL editor. The controller hands both over at the end of the build.

Before handing the block over, check the upsert expectation. In Postgres, `INSERT ... ON CONFLICT DO UPDATE` checks the UPDATE policy's USING on the existing row, and a row that fails it raises `42501` ("new row violates row-level security policy" / insufficient_privilege). If the implementer has a local Postgres with Supabase's `auth` schema they may run the file there. Otherwise this stays a hand-over item.

- [ ] **Step 3: Move the fake client into a support module**

1. Create `site/tests/support/fake-supabase.js`:
   - Move `fakeClient` there verbatim, with its doc comment, from `site/tests/sync.test.js`.
   - It needs `import assert from 'node:assert/strict';`.
   - Export `export const USER = { id: 'user-1' };` and `export function fakeClient(...)`.
2. Extend it for `test_attempts`:
   - The signature becomes `fakeClient(rows = [], { maxRows = 1000, user = USER, attempts = [] } = {})`.
   - `tables.test_attempts = new Map(attempts.map((r) => [r.id, { ...r }]))`, exposed as `client.attempts`.
   - In `upsert`, key rows by table: `question_progress` by `r.question_key`, `test_attempts` by `r.id` (bookmarks stay as they are). For `test_attempts`, assert `call.options?.onConflict === 'id'` and that `r.user_id === user.id`.
   - In the delete branch, a delete on `test_attempts` returns `refuse('permission denied for table test_attempts', '42501')`, as the database would, since there is no delete grant.
   - Document both in the doc comment.
3. In `site/tests/sync.test.js`:
   - Delete the moved code and the local `USER`, and import `{ USER, fakeClient }` from `./support/fake-supabase.js`.
   - Run `npm test` and confirm sync.test.js still passes **before** touching `sync.js`.
   - The helpers that read `client.table`, `client.sets` and `client.bookmarks` keep working, because the returned client keeps those properties.

Run: `npm test`
Expected: PASS, with exactly the pre-existing count. This step changes no behaviour.

- [ ] **Step 4: Write the failing merge tests**

`site/tests/mock-merge.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, chooseAnswer, newAttempt, submitAttempt } from '../src/lib/tests/attempt.js';
import { attemptsEqual, fromRow, isDirty, mergeAttempts, pickAttempt, rebaseTests, settleAttempts, toRow } from '../src/lib/tests/merge.js';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const ID3 = '00000000-0000-4000-8000-000000000003';
const KEYS = ['upsc-2019-1', 'upsc-2019-2'];
const T = (m) => new Date(Date.UTC(2026, 9, 9, 10, m)).toISOString();
const RESULT = { scored: 2, right: 1, wrong: 0, blank: 1, score: 2, max: 4 };
const make = (id = ID1, minute = 0) =>
  newAttempt({ id, kind: 'paper', spec: { year: 2019 }, keys: KEYS, limitMs: 120 * MINUTE, now: T(minute) });
const synced = (a) => ({ ...a, syncedAt: a.updatedAt });
// The database's own way of writing a time: microseconds, +00:00.
const pgTime = (iso) => iso.replace('Z', '+00:00').replace(/\.(\d{3})/, '.$1000');
const row = (a, userId = 'user-1') => {
  const r = toRow(a, userId);
  return { ...r, started_at: pgTime(r.started_at), updated_at: pgTime(r.updated_at), submitted_at: r.submitted_at && pgTime(r.submitted_at) };
};

test('dirty: never synced, or changed since', () => {
  const a = make();
  assert.equal(isDirty(a), true);
  assert.equal(isDirty(synced(a)), false);
  assert.equal(isDirty(chooseAnswer(synced(a), KEYS[0], 'a', T(5))), true);
  assert.equal(isDirty({ ...a, syncedAt: pgTime(a.updatedAt) }), false, 'compared as times, not text');
});

test('a row is the attempt in the database column names, with its owner, and never syncedAt', () => {
  const a = chooseAnswer(make(), KEYS[0], 'b', T(1));
  assert.deepEqual(toRow(a, 'user-1'), {
    id: ID1,
    user_id: 'user-1',
    exam: 'upsc',
    kind: 'paper',
    spec: { year: 2019 },
    question_keys: KEYS,
    answers: { [KEYS[0]]: 'b' },
    review_keys: [],
    current_index: 0,
    limit_ms: 120 * MINUTE,
    elapsed_ms: 0,
    status: 'in_progress',
    started_at: T(0),
    updated_at: T(1),
    submitted_at: null,
    result: null,
  });
});

test('a row read back is the attempt, its times normalised, synced as of its updatedAt', () => {
  const a = submitAttempt(chooseAnswer(make(), KEYS[0], 'b', T(1)), RESULT, T(2));
  assert.deepEqual(fromRow(row(a)), { ...a, syncedAt: T(2) });
  assert.equal(fromRow({ ...row(a), question_keys: [] }), null);
});

test('pick: submitted beats unfinished; earlier submit wins; else later update; ties to the account', () => {
  const open = make();
  const later = chooseAnswer(open, KEYS[0], 'a', T(9));
  const sub5 = submitAttempt(open, RESULT, T(5));
  const sub6 = submitAttempt(open, RESULT, T(6));
  assert.equal(pickAttempt(sub5, later), 'mine');
  assert.equal(pickAttempt(later, sub5), 'theirs');
  assert.equal(pickAttempt(sub5, sub6), 'mine');
  assert.equal(pickAttempt(sub6, sub5), 'theirs');
  assert.equal(pickAttempt(sub5, sub5), 'theirs');
  assert.equal(pickAttempt(later, open), 'mine');
  assert.equal(pickAttempt(open, later), 'theirs');
  assert.equal(pickAttempt(open, open), 'theirs');
  const abandoned = { ...open, status: 'abandoned', updatedAt: T(3) };
  assert.equal(pickAttempt(abandoned, open), 'mine', 'abandoned is a normal update');
  assert.equal(pickAttempt(abandoned, later), 'theirs');
});

test('merge: local only is uploaded; account only arrives; the winner of each pair stays', () => {
  const mineOnly = make(ID1, 1);
  const theirsOnly = submitAttempt(make(ID2, 1), RESULT, T(4));
  const mineNewer = chooseAnswer(synced(make(ID3, 0)), KEYS[0], 'c', T(7));
  const theirsOlder = make(ID3, 0);
  const { attempts, toUpload } = mergeAttempts({ [ID1]: mineOnly, [ID3]: mineNewer }, [row(theirsOnly), row(theirsOlder)]);
  assert.deepEqual(toUpload.map((a) => a.id).sort(), [ID1, ID3]);
  assert.deepEqual(attempts[ID1], { ...mineOnly, syncedAt: mineOnly.updatedAt });
  assert.deepEqual(attempts[ID2], { ...theirsOnly, syncedAt: theirsOnly.updatedAt });
  assert.deepEqual(attempts[ID3], { ...mineNewer, syncedAt: mineNewer.updatedAt });
});

test('merge: the account copy wins a tie and nothing is uploaded', () => {
  const a = synced(make());
  const { attempts, toUpload } = mergeAttempts({ [ID1]: a }, [row(a)]);
  assert.deepEqual(toUpload, []);
  assert.deepEqual(attempts[ID1], a);
});

test('merge: a submit on another device beats this device still answering', () => {
  const here = chooseAnswer(synced(make()), KEYS[1], 'd', T(30));
  const there = submitAttempt(make(), RESULT, T(20));
  const { attempts, toUpload } = mergeAttempts({ [ID1]: here }, [row(there)]);
  assert.deepEqual(toUpload, []);
  assert.equal(attempts[ID1].status, 'submitted');
});

test('merge: rows that do not parse are ignored', () => {
  const { attempts } = mergeAttempts({}, [{ id: 'nope' }]);
  assert.deepEqual(attempts, {});
});

test('settle: what changed here during the run is kept, still dirty; the rest takes the merge', () => {
  const before = synced(make(ID1, 0));
  const snapshot = { [ID1]: before, [ID2]: synced(make(ID2, 0)) };
  const fromAccount = { ...before, elapsedMs: 5000, updatedAt: T(3), syncedAt: T(3) };
  const merged = { [ID1]: fromAccount, [ID2]: snapshot[ID2], [ID3]: synced(make(ID3, 2)) };
  const answeredMidRun = chooseAnswer(before, KEYS[0], 'a', T(4));
  const startedMidRun = make('00000000-0000-4000-8000-000000000009', 4);
  const current = { [ID1]: answeredMidRun, [ID2]: snapshot[ID2], [startedMidRun.id]: startedMidRun };
  const out = settleAttempts(snapshot, current, merged, null);
  assert.deepEqual(out[ID1], { ...answeredMidRun, syncedAt: T(3) });
  assert.equal(isDirty(out[ID1]), true);
  assert.deepEqual(out[ID2], snapshot[ID2]);
  assert.deepEqual(out[ID3], merged[ID3]);
  assert.deepEqual(out[startedMidRun.id], startedMidRun);
});

test('settle, targeted: only the run\'s ids take the merge; others stay as stored', () => {
  const a = make(ID1, 1);
  const b = synced(make(ID2, 0));
  const out = settleAttempts({ [ID1]: a, [ID2]: b }, { [ID1]: a, [ID2]: b }, { [ID1]: synced(a) }, [ID1]);
  assert.deepEqual(out, { [ID1]: synced(a), [ID2]: b });
});

test('rebase for a new account keeps only attempts that never reached an account', () => {
  const mine = make(ID1, 1);
  const theirs = synced(make(ID2, 1));
  const theirsEdited = chooseAnswer(synced(make(ID3, 1)), KEYS[0], 'a', T(5));
  assert.deepEqual(rebaseTests({ attempts: { [ID1]: mine, [ID2]: theirs, [ID3]: theirsEdited } }), { attempts: { [ID1]: mine } });
});

test('attemptsEqual compares the stored collections', () => {
  const a = { [ID1]: make() };
  assert.equal(attemptsEqual(a, { [ID1]: make() }), true);
  assert.equal(attemptsEqual(a, { [ID1]: synced(make()) }), false);
  assert.equal(attemptsEqual(a, {}), false);
});
```

- [ ] **Step 5: Run to verify they fail, then implement `merge.js`**

Run: `node --test tests/mock-merge.test.js`
Expected: FAIL, because the module is missing.

`site/src/lib/tests/merge.js`:

```js
import { parseAttempt } from './attempt.js';

// Merging this device's attempts with the account's (scripts/sync-tests.js).
// Pure. An attempt is one row, matched by its id, and the whole attempt wins or
// loses as one: a test is answered on one device at a time.

const at = (iso) => Date.parse(iso);

/** Changed since the account last confirmed it (or never sent). */
export const isDirty = (a) => a.syncedAt === null || at(a.syncedAt) !== at(a.updatedAt);

export function toRow(a, userId) {
  return {
    id: a.id,
    user_id: userId,
    exam: a.exam,
    kind: a.kind,
    spec: a.spec,
    question_keys: a.keys,
    answers: a.answers,
    review_keys: a.review,
    current_index: a.current,
    limit_ms: a.limitMs,
    elapsed_ms: a.elapsedMs,
    status: a.status,
    started_at: a.startedAt,
    updated_at: a.updatedAt,
    submitted_at: a.submittedAt,
    result: a.result,
  };
}

// The database writes times its own way (2026-10-09T10:00:00.123+00:00); the
// device writes toISOString. One form on the device keeps comparisons simple.
const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : v);

/** An account row as an attempt, checked like storage, and synced as of its own update. Null when it does not parse. */
export function fromRow(r) {
  const a = parseAttempt({
    id: r.id,
    exam: r.exam,
    kind: r.kind,
    spec: r.spec,
    keys: r.question_keys,
    answers: r.answers,
    review: r.review_keys,
    current: r.current_index,
    limitMs: r.limit_ms,
    elapsedMs: r.elapsed_ms,
    status: r.status,
    startedAt: iso(r.started_at),
    updatedAt: iso(r.updated_at),
    submittedAt: r.submitted_at == null ? null : iso(r.submitted_at),
    result: r.result,
    syncedAt: null,
  });
  return a && { ...a, syncedAt: a.updatedAt };
}

/**
 * Which copy of one attempt stands (spec, "Merge per attempt id"): a submitted
 * copy beats one that is not; of two submitted, the earlier submit; otherwise
 * the later update. Every tie goes to the account ('theirs'), so two devices
 * holding the same copy never send it back and forth.
 */
export function pickAttempt(mine, theirs) {
  const mineDone = mine.status === 'submitted';
  const theirsDone = theirs.status === 'submitted';
  if (mineDone && theirsDone) return at(mine.submittedAt) < at(theirs.submittedAt) ? 'mine' : 'theirs';
  if (mineDone !== theirsDone) return mineDone ? 'mine' : 'theirs';
  return at(mine.updatedAt) > at(theirs.updatedAt) ? 'mine' : 'theirs';
}

/**
 * @param local  { [id]: attempt } this device's attempts in the run's scope
 * @param rows   the account's rows for that scope
 * @returns attempts  { [id]: attempt } every attempt in scope, as it stands
 *                    after the run, uploads counted as synced (the run saves
 *                    nothing when an upload fails)
 *          toUpload  this device's copies the account must take
 * Attempts are never deleted, so one the account lacks is uploaded, whatever
 * its syncedAt says.
 */
export function mergeAttempts(local, rows) {
  const attempts = {};
  for (const r of rows) {
    const a = fromRow(r);
    if (a) attempts[a.id] = a;
  }
  const toUpload = [];
  for (const [id, mine] of Object.entries(local)) {
    const theirs = attempts[id];
    if (theirs && pickAttempt(mine, theirs) === 'theirs') continue;
    toUpload.push(mine);
    attempts[id] = { ...mine, syncedAt: mine.updatedAt };
  }
  return { attempts, toUpload };
}

/**
 * The attempts to save when a run ends. The run worked from `snapshot`, and the
 * student may have answered, moved on or started a test while it waited on the
 * network: `current` (storage read again) holds that. An attempt that changed
 * here during the run keeps this device's copy, with the run's syncedAt, so it
 * stays dirty and the next run sends it (or loses it to a submit elsewhere).
 * With `scopeIds` null the merge covered every attempt; with a list, only those.
 */
export function settleAttempts(snapshot, current, merged, scopeIds = null) {
  const out = scopeIds === null ? { ...merged } : { ...current };
  if (scopeIds !== null) for (const id of scopeIds) if (merged[id]) out[id] = merged[id];
  for (const [id, now] of Object.entries(current)) {
    const was = snapshot[id];
    if (was && at(was.updatedAt) === at(now.updatedAt) && was.status === now.status) continue;
    out[id] = { ...now, syncedAt: merged[id]?.syncedAt ?? now.syncedAt };
  }
  return out;
}

/**
 * A different account signs in on this browser (sync.js claimDevice): the
 * attempts the previous account holds go, and the ones that never reached any
 * account stay and join this one, as never-synced marks do.
 */
export function rebaseTests(tests) {
  return { ...tests, attempts: Object.fromEntries(Object.entries(tests.attempts).filter(([, a]) => a.syncedAt === null)) };
}

export const attemptsEqual = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const sorted = (attempts) => Object.keys(attempts).sort().map((id) => attempts[id]);
```

Run: `node --test tests/mock-merge.test.js`
Expected: PASS.

- [ ] **Step 6: Write the failing sync tests**

`site/tests/sync-tests.test.js`. Use the same browser-globals fixture as `sync.test.js`: a `localStorage` over a Map with `failWrites` and `blocked` switches, `document` and `window` as `EventTarget`s, `console.warn` captured, the sign-out dispatch in `afterEach`, and `takeWarnings`. Copy that fixture's `beforeEach` and `afterEach` verbatim. Then:

```js
import { USER, fakeClient } from './support/fake-supabase.js';
import { MINUTE, chooseAnswer, newAttempt, submitAttempt } from '../src/lib/tests/attempt.js';
import { TESTS_KEY, loadTests, putAttempt, saveTests, emptyTests } from '../src/lib/tests/store.js';
import { toRow } from '../src/lib/tests/merge.js';
import { OWNER_KEY } from '../src/lib/accounts/pull.js';
import { startSync } from '../src/scripts/sync.js';
import { TESTS_MARKER_KEY, syncTests } from '../src/scripts/sync-tests.js';

const ID1 = '00000000-0000-4000-8000-000000000001';
const ID2 = '00000000-0000-4000-8000-000000000002';
const KEYS = ['upsc-2019-1', 'upsc-2019-2'];
const T = (m) => new Date(Date.now() - (60 - m) * MINUTE).toISOString();
const RESULT = { scored: 2, right: 1, wrong: 0, blank: 1, score: 2, max: 4 };
const make = (id = ID1, minute = 0) =>
  newAttempt({ id, kind: 'paper', spec: { year: 2019 }, keys: KEYS, limitMs: 120 * MINUTE, now: T(minute) });
const seedTests = (...attempts) => assert.ok(saveTests(attempts.reduce(putAttempt, emptyTests())));
const stored = (id) => loadTests().attempts[id];
const attemptCalls = (client, kind) => client.calls.filter((c) => c.table === 'test_attempts' && c.kind === kind);
const writeTestsMarker = (ageMs, user = USER.id) =>
  store.set(TESTS_MARKER_KEY, JSON.stringify({ user, at: new Date(Date.now() - ageMs).toISOString() }));
const idle = () => new Promise((resolve) => setTimeout(resolve, 5));
```

Tests (each a `test(...)`, written in the style of `sync.test.js`):

1. **Upload.** `seedTests(make())`; `await syncTests(fakeClient(), USER)`. Expect:
   - one upsert of one row, with `user_id: USER.id` and `onConflict: 'id'`;
   - `client.attempts.get(ID1).status === 'in_progress'`;
   - `stored(ID1).syncedAt === stored(ID1).updatedAt`;
   - `store.has(TESTS_MARKER_KEY)`.
2. **Another device's attempt arrives.** Start with nothing stored. `fakeClient([], { attempts: [toRow(submitAttempt(make(ID2), RESULT, T(5)), USER.id)] })`. After `syncTests`:
   - `stored(ID2).status === 'submitted'`;
   - no upsert;
   - one `sawaalbox:synced` event.
3. **A submit elsewhere beats answering here.** Local is `chooseAnswer({...make(), syncedAt: T(0)}, KEYS[0], 'a', T(30))`; the account holds `submitAttempt(make(), RESULT, T(20))`. After sync:
   - `stored(ID1).status === 'submitted'`;
   - no upsert.
4. **This device's submit beats the account's unfinished copy.** Local is submitted at T(20); the account is in progress with a later `updatedAt` T(30). After sync:
   - the account row's status is `'submitted'`;
   - one upsert.
5. **Both submitted: the earlier submit stands, everywhere.** Local submitted at T(25); the account submitted at T(20). After sync:
   - local `submittedAt` is T(20);
   - no upsert.
   - Reverse the times: the local copy is uploaded.
6. **Offline, then online.**
   - `client.failOn = 'upsert'`; `startSync(client, USER)` and `await idle()`. Expect:
     - one warning, taken with `takeWarnings()`, containing `'will retry syncing tests'`;
     - `stored(ID1).syncedAt === null`;
     - no marker.
   - Then `client.failOn = null` and `window.dispatchEvent(new Event('online'))`; `await idle()`. Expect:
     - `client.attempts.has(ID1)`;
     - `stored(ID1).syncedAt !== null`.
   - Note: with `failOn = 'upsert'`, the progress step does not upload (nothing pending), so only the tests step warns.
7. **A new account on a shared browser.**
   - Set up: `store.set(OWNER_KEY, 'user-A')`; seed one attempt with `syncedAt` set (A's) and one with `syncedAt: null`. Sync as `USER` (user-1) via `startSync`, then `await idle()`.
   - Expect:
     - the synced one is gone from storage and was never uploaded;
     - the unsynced one is uploaded with `user_id: USER.id`;
     - the owner is now `USER.id`.
8. **An answer given while a run is in flight.**
   - Seed `{...make(), syncedAt: T(0)}`; `writeTestsMarker(60 * MINUTE)` so the run pulls everything.
   - `const release = slowNetwork(client)`, the same helper as in sync.test.js: `client.hold` holds the next select. Start `syncTests`.
   - Write `chooseAnswer(stored, KEYS[1], 'b', T(40))` straight to storage, then `release()` and await.
   - Expect:
     - `stored(ID1).answers` still has `KEYS[1]: 'b'`;
     - it is still dirty.
   - A second `syncTests` uploads it.
9. **Targeted runs.**
   - With `writeTestsMarker(1000)` and nothing dirty, `syncTests` makes no `test_attempts` request at all.
   - With one dirty attempt, the select is filtered with `in('id', [ID1])`: `call.filters` contains `['in', 'id', [ID1]]`.
   - `syncTests(client, USER, { full: true })` pulls without an `in` filter.
10. **Never a delete.** Across every test above, `attemptCalls(client, 'delete').length === 0`. The fake also refuses one. Add one explicit test that runs three syncs over a mix of attempts and asserts this.
11. **`sawaalbox:test` starts a run.**
    - `startSync(client, USER)`; `await idle()`; then `seedTests(make(ID2))` and `document.dispatchEvent(new CustomEvent('sawaalbox:test'))`, then `await idle()`.
    - Expect `client.attempts.has(ID2)`.
12. **Sign-out forgets the tests marker.**
    - After a successful `startSync` run, `store.has(TESTS_MARKER_KEY)`.
    - After `document.dispatchEvent(new Event('sawaalbox:signed-out'))`, it is gone.
13. **A refused save is a failure.** With `failWrites = true` before `syncTests`:
    - it rejects with `/tests could not be saved/`;
    - no `sawaalbox:synced` event;
    - no marker.

- [ ] **Step 7: Run to verify they fail**

Run: `node --test tests/sync-tests.test.js`
Expected: FAIL, because `sync-tests.js` is missing.

- [ ] **Step 8: Implement `sync-tests.js`**

`site/src/scripts/sync-tests.js`:

```js
import { loadTests, saveTests } from '../lib/tests/store.js';
import { attemptsEqual, isDirty, mergeAttempts, settleAttempts, toRow } from '../lib/tests/merge.js';
import { deviceOwner, pullMarker, pullPages } from '../lib/accounts/pull.js';

// The third step of a sync run (scripts/sync.js), after progress and lists:
// this device's mock test attempts and the account's test_attempts rows. Like
// the others it has its own "pulled everything recently" marker, so a step that
// keeps failing never makes another pull everything again.

const TABLE = 'test_attempts';
const COLUMNS =
  'id,exam,kind,spec,question_keys,answers,review_keys,current_index,limit_ms,elapsed_ms,status,started_at,updated_at,submitted_at,result';

// Ids go in the request URL of a targeted pull (36 characters each).
const MAX_TARGETED_IDS = 50;
// An attempt row is a few KB (150 keys, answers); this many per request keeps
// a first sign-in with a full device (200 attempts) to modest requests.
const UPLOAD_ROWS_PER_REQUEST = 50;

export const TESTS_MARKER_KEY = 'sawaalbox-sync-tests-v1';
const testsPull = pullMarker(TESTS_MARKER_KEY);
export const forgetTestsPull = () => testsPull.forget();

async function pullIds(client, ids) {
  const { data, error } = await client.from(TABLE).select(COLUMNS).in('id', ids);
  if (error) throw error;
  return data;
}

/**
 * One tests sync. A full pull of the account's attempts when this device has
 * not done one for this user in the last 10 minutes (or `full`); in between,
 * only the attempts changed here, and nothing at all when none has. The merge
 * (lib/tests/merge.js) decides each attempt; the winners from this device are
 * upserted, never deleted. Any request error throws and leaves storage as it
 * was, so the next run starts from the same place.
 */
export async function syncTests(client, user, { full = false } = {}) {
  const startedAt = Date.now();
  const snapshot = loadTests().attempts;
  const dirty = Object.values(snapshot)
    .filter(isDirty)
    .map((a) => a.id);

  let scopeIds = null; // null = everything
  if (!full && testsPull.recent(user.id, startedAt)) {
    if (!dirty.length) return;
    if (dirty.length <= MAX_TARGETED_IDS) scopeIds = dirty;
  }

  const rows = scopeIds ? await pullIds(client, scopeIds) : await pullPages(client, TABLE, COLUMNS, ['id']);
  const local = scopeIds ? Object.fromEntries(scopeIds.map((id) => [id, snapshot[id]])) : snapshot;
  const { attempts, toUpload } = mergeAttempts(local, rows);

  for (let i = 0; i < toUpload.length; i += UPLOAD_ROWS_PER_REQUEST) {
    const batch = toUpload.slice(i, i + UPLOAD_ROWS_PER_REQUEST).map((a) => toRow(a, user.id));
    const { error } = await client.from(TABLE).upsert(batch, { onConflict: 'id' });
    if (error) throw error;
  }

  // Read storage again: an answer given, or a test started, while the requests
  // above were in flight is kept (see settleAttempts).
  const current = loadTests();
  const settled = settleAttempts(snapshot, current.attempts, attempts, scopeIds);
  const changed = !attemptsEqual(current.attempts, settled);
  if (changed && !saveTests({ ...current, attempts: settled })) {
    throw new Error('tests could not be saved on this device');
  }
  deviceOwner.remember(user.id);
  if (!scopeIds) testsPull.remember(user.id, startedAt);
  if (changed) document.dispatchEvent(new CustomEvent('sawaalbox:synced'));
}
```

Test 13 expects a refused save to throw even when only the `syncedAt` changes. Since `changed` is true then, the code above already does so. Keep it that way.

- [ ] **Step 9: Wire the third step into the run**

In `site/src/scripts/sync.js`:

1. **Imports:**

   ```js
   import { loadTests, saveTests } from '../lib/tests/store.js';
   import { rebaseTests } from '../lib/tests/merge.js';
   import { forgetTestsPull, syncTests } from './sync-tests.js';
   ```

2. **In `claimDevice`,** inside the `owner !== null && owner !== user.id` branch, rebase the attempts too. Save only when the rebase dropped any, throw on a refused save, as the progress rebase does, and dispatch `sawaalbox:synced` once if either rebase saved. Then forget the tests marker beside the other two:

   ```js
   const tests = loadTests();
   const keptTests = rebaseTests(tests);
   const testsChanged = Object.keys(keptTests.attempts).length !== Object.keys(tests.attempts).length;
   if (testsChanged && !saveTests(keptTests)) throw new Error("another account's tests could not be cleared from this device");
   ```

   Restructure so a single `sawaalbox:synced` dispatch fires if either the progress state or the tests changed. Add `forgetTestsPull();` next to `forgetListsPull();`. Update the doc comment to say attempts are rebased the same way.

3. **In `syncOnce`,** after the lists step:

   ```js
   if (stopped) return;
   try {
     await syncTests(client, user, { full });
   } catch (e) {
     console.warn('SawaalBox: will retry syncing tests', e);
   }
   ```

   Update the comment above `syncOnce` to "Progress, then lists, then tests."

4. **In `forgetMarkers`:** add `forgetTestsPull();`.

5. **Listeners:**
   - Add `doc.addEventListener('sawaalbox:test', onChange);` beside `sawaalbox:list`, and remove it in `onSignedOut`.
   - Update the comment on `onChange`: a test started, submitted or abandoned is the same, "something changed".

6. **Docs:** in `startSync`'s doc comment, "progress and lists" becomes "progress, lists and tests".

- [ ] **Step 10: Run the whole suite and fix what the third step changes in `sync.test.js`**

Run: `npm test`
Expected: `sync-tests.test.js` and `mock-merge.test.js` pass. Some `sync.test.js` tests may now fail **only** because the run makes a third set of requests. Adjust those tests to the new truth; never weaken what they prove about progress and lists:
- `listCalls` must filter to `bookmark_sets` and `bookmarks`, not "anything but question_progress".
- Tests using `failOn: 'select'` or `'upsert'` (any table) now also get a `will retry syncing tests` warning, so take it with `takeWarnings()` and assert it.
- Assertions on the total number of `sawaalbox:synced` events or of calls must count the tests step: a full run with nothing stored makes one `test_attempts` select and fires no event.

Record every adjusted test, with a reason, in the report.

Run again: `npm test`
Expected: PASS, everything.

- [ ] **Step 11: Build and commit**

Run: `npm run build`
Expected: success. supabase-js is still lazy: `grep -l "createClient" dist/_astro/*.js` lists only the lazy chunk it listed before. Compare with a build of the base commit if unsure.

```bash
git add supabase/migrations/20261011120000_test_attempts.sql supabase/tests/rls_test.sql site/src/lib/tests/merge.js site/src/scripts/sync-tests.js site/src/scripts/sync.js site/tests/support/fake-supabase.js site/tests/sync.test.js site/tests/mock-merge.test.js site/tests/sync-tests.test.js
git commit -m "feat(tests): sync attempts with the account (test_attempts table, third sync step)"
```

### Task 4: The test screen (`/upsc/test/take`)

**Files:**
- Create: `site/src/lib/tests/clock.js`, `site/tests/mock-clock.test.js`, `site/src/pages/upsc/test/take.astro`, `site/src/scripts/take-page.js`

**Interfaces:**
- **Consumes:**
  - Task 1: the transitions, `attemptName`, `PAPER_MINUTES`, `MINUTE`, `remainingMs`; `loadTests`, `saveTests`, `putAttempt`, `getAttempt`, `inProgressPaper`, `TESTS_KEY`; `scoreAttempt`, `officialAnswer`, `resultLine`; `canStartTest`.
  - Task 2: `paperKeys`, `PAPERS` (build time).
  - `fullEntry`, `fullPath`, `fullPathsFor` and `serialOf` from `site/src/lib/accounts/summary.js`.
  - `newListId` from `site/src/lib/accounts/lists.js`. It is a uuid v4 maker, reused here for attempt ids.
- **Produces:**
  - `clock.js`: `TICK_CAP_MS = 5000`, `SAVE_EVERY_MS = 5000`, `formatClock(ms)`, `announcementFor(beforeMs, afterMs)`, `keyAction(key)`.
  - **The page's addresses:**
    - `?paper=<year>` shows the start screen, or resumes that paper's unfinished attempt.
    - `?attempt=<id>` takes that attempt.
    - On submit, the page replaces itself with `/upsc/test/result?attempt=<id>`, adding `&timeup` when the clock ran out.
    - After an abandon it goes to `/upsc/test`.
  - The page dispatches `sawaalbox:test` after a start, a submit and an abandon.

**Behaviour** (the spec's "2. Taking a test" is binding; this is how):

- **Views.** The `<main>` carries a `data-view` attribute:
  - `start`: a paper's start screen with **Start the test**.
  - `loading`: the top bar shows; questions are on their way.
  - `test`: the test itself.
  - `message`: not on this device, abandoned, or nothing chosen.
- **The start screen** shows:
  - the name ("UPSC Prelims 2019");
  - "*n* questions · 2 hours";
  - the paper's notes (from `PAPERS`);
  - three rules: the scoring, that the clock runs only while the page is in front of you, and that answers are saved on this device and stay hidden until submit;
  - **Start the test** (filled green, the only filled action in that view);
  - a link to all practice tests.

  Pressing Start runs `canStartTest('upsc')`, fetches the year's full file, builds the keys with `paperKeys`, creates the attempt, saves it, replaces the address with `?attempt=<id>`, dispatches `sawaalbox:test`, and loads.
- **Questions load** with the /revise loader pattern: a 15 s timeout per year file, **Try again**, and an automatic retry on `online`. The clock does not run until every needed year has loaded.
- **Saving.** Every change goes through `mutate(change)`:
  1. Read storage.
  2. If the stored copy is no longer in progress (submitted or abandoned on another device or tab), stop: go to results, or show the message.
  3. Otherwise apply the change to the stored copy and write it.
  4. If storage refuses, keep the attempt in memory and show *"Your browser isn't saving this test. You can finish it in this tab, but closing it loses your answers."*
- **Clock:**
  - `setInterval(tick, 1000)` while `document.visibilityState === 'visible'` and the view is `test`.
  - Each tick adds the time since the last tick, capped at `TICK_CAP_MS`, to an unsaved total.
  - The total is saved with `addElapsed` at least every `SAVE_EVERY_MS`, on hiding (`visibilitychange`) and on `pagehide`.
  - On `pageshow` from the back/forward cache, the page re-reads the stored attempt.
  - At zero it submits (`finish({ timeUp: true })`).
- **Screen readers.** One polite live region announces *"Question N of M"* on every move, and *"15 minutes left"*, *"5 minutes left"* and *"1 minute left"* as they are crossed.
- **Keyboard.** `keyAction` maps A–D and 1–4 to choosing, and ← / → to moving. It is ignored when:
  - focus is in a text input, textarea, select or contenteditable;
  - a modifier key is held;
  - a dialog is open;
  - the view is not `test`.

  ← / → call `preventDefault()`, so a focused radio does not change.
- **Grid:**
  - One `<details>`: closed by default on phones, and forced open on wide screens (`min-width: 60rem`, via `matchMedia`), where its summary is hidden and it sits as a sidebar.
  - Each cell is a button numbered 1–M, with visually hidden text ": answered", ": not answered" and ", marked for review".
  - **States by shape:**
    - answered: filled with ink, numeral in paper;
    - not answered: a hairline frame on paper;
    - marked for review: a solid square tab in the top-right corner (a `::after` 0.5rem square, ink on a blank cell, paper on a filled one);
    - current: `aria-current="step"` and a heavy outline offset 2px.
  - A visible legend above the cells names the three shapes, and the summary reads *"14 answered · 3 marked · 86 not answered"*.
  - On phones, choosing a cell closes the disclosure and moves focus to the question text (`tabindex="-1"`).
- **Submit:**
  - The bar's **Submit** is the page's one filled-green action.
  - It opens a modal `<dialog>` with the counts (answered, marked for review, not answered), **Submit now** and **Keep going** (autofocus).
  - **Submit now** is the same action, so it is filled green too. The bar's button sits behind the modal backdrop, so only one is visible at a time.
- **Abandon:** a text button, **Abandon this test**, below the question. It opens a modal `<dialog>`: *"Abandon this test? Its answers are kept, but it won't count in your results."*, with **Abandon** (outlined) and **Keep going** (autofocus).
- **No layout shift:**
  - `main[data-pending]` is hidden (with `@media (scripting: enabled)` and a 4 s reveal-animation fallback, as on /account) until the first view is drawn.
  - The first draw waits for Courier Prime (≤ 3 s, as /revise does).
  - The colophon stays hidden while the view is `loading`.
  - The note line (`role="status"`) always holds one line's height.
  - Question changes are user-initiated.

- [ ] **Step 1: Write the failing clock tests**

`site/tests/mock-clock.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { announcementFor, formatClock, keyAction } from '../src/lib/tests/clock.js';

const MIN = 60000;

test('the countdown reads h:mm:ss, rounded up to the second, never below zero', () => {
  assert.equal(formatClock(120 * MIN), '2:00:00');
  assert.equal(formatClock(3661000), '1:01:01');
  assert.equal(formatClock(59400), '0:01:00');
  assert.equal(formatClock(1), '0:00:01');
  assert.equal(formatClock(0), '0:00:00');
  assert.equal(formatClock(-5000), '0:00:00');
});

test('time is announced as 15, 5 and 1 minutes are crossed, and not otherwise', () => {
  assert.equal(announcementFor(15 * MIN + 500, 15 * MIN - 500), '15 minutes left');
  assert.equal(announcementFor(15 * MIN + 500, 15 * MIN), '15 minutes left');
  assert.equal(announcementFor(5 * MIN + 1, 5 * MIN - 999), '5 minutes left');
  assert.equal(announcementFor(MIN + 400, MIN - 600), '1 minute left');
  assert.equal(announcementFor(14 * MIN, 13 * MIN), null);
  assert.equal(announcementFor(15 * MIN, 14 * MIN), null, 'already at 15 when the clock started');
  assert.equal(announcementFor(16 * MIN, 30 * 1000), '1 minute left', 'the nearest mark when several are crossed');
});

test('keys: A–D and 1–4 choose, arrows move, anything else is not ours', () => {
  assert.deepEqual(keyAction('a'), { choose: 'a' });
  assert.deepEqual(keyAction('D'), { choose: 'd' });
  assert.deepEqual(keyAction('1'), { choose: 'a' });
  assert.deepEqual(keyAction('4'), { choose: 'd' });
  assert.deepEqual(keyAction('ArrowLeft'), { move: -1 });
  assert.deepEqual(keyAction('ArrowRight'), { move: 1 });
  for (const key of ['e', '5', '0', 'Enter', ' ', 'ArrowUp', 'Tab']) assert.equal(keyAction(key), null, key);
});
```

- [ ] **Step 2: Run to verify it fails, then implement `clock.js`**

Run: `node --test tests/mock-clock.test.js`
Expected: FAIL, because the module is missing.

`site/src/lib/tests/clock.js`:

```js
import { OPTIONS } from './attempt.js';

// The test screen's clock and keys, as plain functions (scripts/take-page.js
// does the DOM). Each tick adds at most TICK_CAP_MS: a laptop that sleeps with
// the page in front does not come back to an hour gone. Elapsed time is saved
// at least every SAVE_EVERY_MS while the clock runs (spec, "Saving").
export const TICK_CAP_MS = 5000;
export const SAVE_EVERY_MS = 5000;

const pad = (n) => String(n).padStart(2, '0');

/** h:mm:ss, rounded up, so it reads 0:00:00 only when time is actually up. */
export function formatClock(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 3600)}:${pad(Math.floor((total % 3600) / 60))}:${pad(total % 60)}`;
}

// Nearest first, so a jump past several marks says the one now true.
const MARKS_MIN = [1, 5, 15];

/** What to tell a screen reader as remaining time goes from `before` to `after`, or null. */
export function announcementFor(before, after) {
  for (const minutes of MARKS_MIN) {
    const mark = minutes * 60000;
    if (before > mark && after <= mark) return minutes === 1 ? '1 minute left' : `${minutes} minutes left`;
  }
  return null;
}

/** A key's meaning on the test screen: { choose: 'a'..'d' } | { move: -1 | 1 } | null. */
export function keyAction(key) {
  const k = String(key);
  const letter = OPTIONS.indexOf(k.toLowerCase());
  if (k.length === 1 && letter >= 0) return { choose: OPTIONS[letter] };
  const digit = ['1', '2', '3', '4'].indexOf(k);
  if (digit >= 0) return { choose: OPTIONS[digit] };
  if (k === 'ArrowLeft') return { move: -1 };
  if (k === 'ArrowRight') return { move: 1 };
  return null;
}
```

Run: `node --test tests/mock-clock.test.js`
Expected: PASS.

- [ ] **Step 3: Write the page**

`site/src/pages/upsc/test/take.astro`:

```astro
---
import Document from '../../../layouts/Document.astro';
import Masthead from '../../../components/Masthead.astro';
import Colophon from '../../../components/Colophon.astro';
import { PAPERS } from '../../../lib/papers.js';

// An app page, like /revise: what it shows is one attempt on this device, so it
// is not indexed and not in the sitemap. Everything below the head is drawn by
// take-page.js; the paper list rides along so a start screen needs no fetch.
const OPTIONS = ['a', 'b', 'c', 'd'];
---

<Document title="Practice test" description="A timed UPSC Prelims practice test." noindex={true}>
  <Masthead />

  <main class="sheet take" data-pending data-view="none" data-papers={JSON.stringify(PAPERS)}>
    <header class="tk-head">
      <h1 data-name tabindex="-1">Practice test</h1>
      <div class="tk-bar" data-bar>
        <p class="tk-position" data-position></p>
        <p class="tk-clock"><span class="tk-clock-label">Time left</span> <span class="serial" data-clock></span></p>
        <button type="button" class="tk-primary" data-submit disabled>Submit</button>
      </div>
    </header>

    <p class="tk-note" role="status" data-note></p>
    <noscript><p class="tk-empty">Taking a test needs JavaScript.</p></noscript>
    <p class="tk-retry" data-retry-row hidden><button type="button" class="tk-btn" data-retry>Try again</button></p>

    <section class="tk-start" data-start hidden aria-labelledby="tk-start-h">
      <h2 id="tk-start-h" class="visually-hidden">Before you start</h2>
      <p class="tk-facts" data-start-facts></p>
      <ul class="tk-notes" data-start-notes></ul>
      <ul class="tk-rules">
        <li>Each right answer earns 2 marks. Each wrong answer loses two-thirds of a mark. A question left blank scores nothing.</li>
        <li>The clock runs only while this page is open in front of you. Leave and come back, and it carries on from where it stopped.</li>
        <li>Your answers are saved on this device as you go. Answers and your score stay hidden until you submit.</li>
      </ul>
      <p><button type="button" class="tk-primary" data-start-button>Start the test</button></p>
      <p class="tk-back"><a href="/upsc/test">All practice tests</a></p>
    </section>

    <section class="tk-message" data-message hidden>
      <p data-message-text></p>
      <p class="tk-back"><a href="/upsc/test">Practice tests</a></p>
    </section>

    <div class="tk-body" data-test hidden>
      <section class="tk-question" aria-labelledby="tk-qtext">
        <p class="serial tk-serial" data-serial></p>
        <p class="qtext tk-qtext" id="tk-qtext" data-question tabindex="-1"></p>
        <fieldset class="tk-options" aria-labelledby="tk-qtext" data-options>
          {
            OPTIONS.map((k) => (
              <label class="tk-option">
                <input type="radio" name="tk-answer" value={k} />
                <span class="serial tk-key">({k})</span>
                <span class="tk-option-text" data-option={k} />
              </label>
            ))
          }
        </fieldset>
        <div class="tk-actions">
          <button type="button" class="tk-btn" data-clear>Clear answer</button>
          <button type="button" class="tk-btn" data-review aria-pressed="false">Mark for review</button>
          <span class="tk-move">
            <button type="button" class="tk-btn" data-prev>Previous</button>
            <button type="button" class="tk-btn" data-next>Next</button>
          </span>
        </div>
        <p class="tk-leave"><button type="button" class="tk-text-btn" data-abandon>Abandon this test</button></p>
      </section>

      <details class="tk-grid" data-grid-box>
        <summary>All questions <span class="tk-grid-summary" data-grid-summary></span></summary>
        <p class="tk-legend">
          <span class="tk-cell tk-cell-sample" data-answered aria-hidden="true"></span> Answered
          <span class="tk-cell tk-cell-sample" data-review aria-hidden="true"></span> Marked for review
          <span class="tk-cell tk-cell-sample" aria-hidden="true"></span> Not answered
        </p>
        <ol class="tk-cells" data-grid></ol>
      </details>
    </div>

    <p class="visually-hidden" aria-live="polite" data-announce></p>

    <dialog class="tk-dialog" data-submit-dialog aria-labelledby="tk-submit-h">
      <form method="dialog">
        <h2 id="tk-submit-h">Submit this test?</h2>
        <p data-submit-summary></p>
        <div class="tk-dialog-actions">
          <button value="submit" class="tk-primary">Submit now</button>
          <button value="keep" class="tk-btn" autofocus>Keep going</button>
        </div>
      </form>
    </dialog>

    <dialog class="tk-dialog" data-abandon-dialog aria-labelledby="tk-abandon-h">
      <form method="dialog">
        <h2 id="tk-abandon-h">Abandon this test?</h2>
        <p>Its answers are kept, but it won't count in your results.</p>
        <div class="tk-dialog-actions">
          <button value="abandon" class="tk-btn">Abandon</button>
          <button value="keep" class="tk-btn" autofocus>Keep going</button>
        </div>
      </form>
    </dialog>
  </main>

  <Colophon />
</Document>

<script>
  import '../../../scripts/take-page.js';
</script>
```

Styles: put them in the same file in a `<style is:global>` block, as revise.astro does. Prefix every class with `tk-` and scope generic ones such as `.take .visually-hidden`. The rules that matter:
- **Square corners and tokens only.**
  - `.tk-primary` is the filled action: `background: var(--field); color: var(--field-ink)`, Archivo 700, hover `var(--field-deep)`.
  - `.tk-btn` is outlined: `2px solid var(--rule-strong)` on `var(--paper)`, `color: var(--field-text)`.
  - `.tk-text-btn` is underlined text.
  - Use `min-height: 2.75rem` on coarse pointers, as /account does.
- **`.tk-head`:**
  - `position: sticky; top: 0; background: var(--ground); z-index: 1;` with a heavy bottom rule.
  - `.tk-bar` is a flex row that wraps.
  - `.tk-clock` uses tabular figures (`font-variant-numeric: tabular-nums`).
  - Give `.tk-bar` a fixed `min-height`, so it is one row at 390 px and up.
  - `.take:not([data-view='test']):not([data-view='loading']) .tk-bar { visibility: hidden; }`, so the head never changes height between views.
  - `.take[data-view='start'] .tk-bar, .take[data-view='message'] .tk-bar { display: none; }` is acceptable instead **only if** those views never turn into each other without user input. They do not, so either works. Keep `visibility` for simplicity.
- **`.tk-note`:** `min-height: 1.6em`, and `[data-error]` is drawn as a note, as `.rv-note` is.
- **`.tk-body`:**
  - `display: grid; gap: 1.5rem;`
  - at `min-width: 60rem`: `grid-template-columns: minmax(0, 1fr) 16rem;`, with `.tk-grid > summary { display: none; }` and `.tk-grid { position: sticky; top: <head height>; align-self: start; }`.
- **`.tk-option`:** a grid `auto 2rem 1fr`, padding 0.35rem, hairline frame. The checked option (`.tk-option:has(input:checked)`) gets a heavy frame and `var(--ground)` background. That is not colour alone: the frame weight changes, and the radio itself shows the state.
- **`.tk-cells`:** `display: grid; grid-template-columns: repeat(auto-fill, minmax(2.5rem, 1fr)); gap: 0.3rem; list-style: none; padding: 0;`
  - Each `.tk-cell` is `aspect-ratio: 1`, `position: relative`, Courier Prime figures, `border: 1px solid var(--rule-strong)`, `background: var(--paper)`.
  - `[data-answered]`: `background: var(--ink); color: var(--paper);`
  - `[data-review]::after`: `content: ''; position: absolute; top: 0; right: 0; width: 0.5rem; height: 0.5rem; background: var(--ink);`; on `[data-answered][data-review]::after`, `background: var(--paper)`.
  - `[aria-current='step']`: `outline: 2px solid var(--rule-strong); outline-offset: 2px;`
  - Keep `:focus-visible` distinct, with `var(--focus)` as elsewhere.
  - `.tk-cell-sample` is a 1rem inline version for the legend.
- **`.tk-dialog`:** square, `2px solid var(--rule-strong)`, `background: var(--paper)`, `color: var(--ink)`, and `::backdrop` a translucent ink.
- **The gate**, as on /account:

  ```css
  @keyframes tk-reveal { to { visibility: visible; } }
  @media (scripting: enabled) {
    .take[data-pending] { visibility: hidden; animation: tk-reveal 0s 4s forwards; }
    body:has(.take[data-pending], .take[data-view='loading']) .colophon { visibility: hidden; animation: tk-reveal 0s 6s forwards; }
  }
  ```

- [ ] **Step 4: Write the script**

`site/src/scripts/take-page.js`:

```js
import {
  MINUTE,
  PAPER_MINUTES,
  abandonAttempt,
  addElapsed,
  attemptName,
  chooseAnswer,
  clearAnswer,
  moveTo,
  newAttempt,
  remainingMs,
  submitAttempt,
  toggleReview,
} from '../lib/tests/attempt.js';
import { TESTS_KEY, getAttempt, inProgressPaper, loadTests, putAttempt, saveTests } from '../lib/tests/store.js';
import { officialAnswer, resultLine, scoreAttempt } from '../lib/tests/score.js';
import { paperKeys } from '../lib/tests/build.js';
import { canStartTest } from '../lib/tests/access.js';
import { SAVE_EVERY_MS, TICK_CAP_MS, announcementFor, formatClock, keyAction } from '../lib/tests/clock.js';
import { fullEntry, fullPath, fullPathsFor, serialOf } from '../lib/accounts/summary.js';
// A uuid v4 maker; attempts need the same kind of id lists do.
import { newListId as newId } from '../lib/accounts/lists.js';

// The test screen: one question at a time, a question grid, a countdown that
// runs only while the page is in front of the student, and every change saved
// on this device at once (spec, "2. Taking a test"). The rules are in
// lib/tests/; this file is the DOM. Text from storage and the year files goes
// in with textContent only.

const FILE_TIMEOUT_MS = 15000;
const FONT_WAIT_MS = 3000;
const NOT_SAVED = "Your browser isn't saving this test. You can finish it in this tab, but closing it loses your answers.";
const WIDE = window.matchMedia('(min-width: 60rem)');

const $ = (selector) => document.querySelector(selector);
const page = $('.take');
const PAPERS = JSON.parse(page.dataset.papers);
const nameEl = $('[data-name]');
const positionEl = $('[data-position]');
const clockEl = $('[data-clock]');
const submitBtn = $('[data-submit]');
const note = $('[data-note]');
const retryRow = $('[data-retry-row]');
const startEl = $('[data-start]');
const messageEl = $('[data-message]');
const testEl = $('[data-test]');
const serialEl = $('[data-serial]');
const questionEl = $('[data-question]');
const optionsEl = $('[data-options]');
const radios = [...optionsEl.querySelectorAll('input[type=radio]')];
const optionText = Object.fromEntries([...optionsEl.querySelectorAll('[data-option]')].map((n) => [n.dataset.option, n]));
const clearBtn = $('[data-clear]');
const reviewBtn = $('[data-review]');
const prevBtn = $('[data-prev]');
const nextBtn = $('[data-next]');
const gridBox = $('[data-grid-box]');
const grid = $('[data-grid]');
const gridSummary = $('[data-grid-summary]');
const announcer = $('[data-announce]');
const submitDialog = $('[data-submit-dialog]');
const abandonDialog = $('[data-abandon-dialog]');

let attempt = null; // the attempt on screen: as last saved, or held here when storage refuses
const files = new Map(); // year-file path -> its data, once loaded
let saveFailed = false;
let finished = false; // submitted or abandoned from this page: no more changes from here
let cells = [];
let timer = null;
let lastTick = 0;
let lastSave = 0;
let pendingMs = 0; // counted since the last save

const iso = () => new Date().toISOString();
const resultUrl = (id) => `/upsc/test/result?attempt=${encodeURIComponent(id)}`;

function say(message, { error = false } = {}) {
  note.textContent = message;
  note.toggleAttribute('data-error', error && Boolean(message));
}

// Cleared first, set a frame later, so the same words said twice are heard twice.
function announce(message) {
  announcer.textContent = '';
  requestAnimationFrame(() => {
    announcer.textContent = message;
  });
}

function show(view) {
  page.dataset.view = view;
  startEl.hidden = view !== 'start';
  messageEl.hidden = view !== 'message';
  testEl.hidden = view !== 'test';
  delete page.dataset.pending;
}

function message(text) {
  stopTimer();
  document.querySelector('[data-message-text]').textContent = text;
  show('message');
}

// --- The year files (the /revise loader pattern). ---

async function fetchYear(path) {
  // A controller and a timer rather than AbortSignal.timeout, which older Safari lacks.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
  try {
    const response = await fetch(path, { signal: controller.signal });
    if (!response.ok) throw new Error(String(response.status));
    const data = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not a question file');
    files.set(path, data);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function loadQuestions() {
  const missing = fullPathsFor(attempt.keys).filter((path) => !files.has(path));
  const loaded = await Promise.all(missing.map(fetchYear));
  return loaded.every(Boolean);
}

/** A question's checked full-file entry, or null when its year is not loaded or it is gone. */
function entryOf(key) {
  const data = files.get(fullPath(key));
  if (!data) return null;
  const entry = fullEntry(data, key);
  return entry.status === 'ok' ? entry.q : null;
}
const officialOf = (key) => officialAnswer(entryOf(key));

// --- Saving. Storage is the truth: every change is applied to the stored copy,
// so a sync or another tab that changed it is built on, not overwritten. ---

function mutate(change) {
  if (finished) return false;
  const now = iso();
  const tests = loadTests();
  const stored = getAttempt(tests, attempt.id);
  if (stored && stored.status !== 'in_progress') {
    closedElsewhere(stored);
    return false;
  }
  const base = stored && !saveFailed ? stored : attempt;
  const next = change(base, now);
  attempt = next;
  if (next !== stored) {
    const ok = saveTests(putAttempt(tests, next));
    if (ok === saveFailed) say(ok ? '' : NOT_SAVED, { error: !ok });
    saveFailed = !ok;
  }
  return true;
}

function closedElsewhere(stored) {
  finished = true;
  attempt = stored;
  stopTimer();
  if (stored.status === 'submitted') location.replace(resultUrl(stored.id));
  else message("This test was abandoned in another tab or on another device. Its answers are kept.");
}

// A sync, or another tab, may change the attempt under us.
function reread() {
  if (!attempt || finished || page.dataset.view !== 'test') return;
  const stored = getAttempt(loadTests(), attempt.id);
  if (!stored) return;
  if (stored.status !== 'in_progress') return closedElsewhere(stored);
  if (stored.updatedAt !== attempt.updatedAt) {
    attempt = stored;
    render();
  }
}
document.addEventListener('sawaalbox:synced', reread);
window.addEventListener('storage', (event) => {
  if (event.key === TESTS_KEY || event.key === null) reread();
});

// --- The clock. ---

const remaining = () => Math.max(0, remainingMs(attempt) - pendingMs);

function flushTime() {
  if (pendingMs > 0) {
    const ms = pendingMs;
    pendingMs = 0;
    mutate((a, now) => addElapsed(a, ms, now));
  }
  lastSave = performance.now();
}

function tick() {
  const t = performance.now();
  const before = remaining();
  pendingMs += Math.min(Math.max(0, t - lastTick), TICK_CAP_MS);
  lastTick = t;
  const after = remaining();
  clockEl.textContent = formatClock(after);
  const spoken = announcementFor(before, after);
  if (spoken) announce(spoken);
  if (after <= 0) return finish({ timeUp: true });
  if (t - lastSave >= SAVE_EVERY_MS) flushTime();
}

function startClock() {
  if (timer || finished || !attempt || page.dataset.view !== 'test' || document.visibilityState !== 'visible') return;
  lastTick = performance.now();
  lastSave = lastTick;
  timer = setInterval(tick, 1000);
}

function stopTimer() {
  clearInterval(timer);
  timer = null;
}

// Hidden or leaving: count the part-second since the last tick, then save.
function stopClock() {
  if (!timer) return;
  stopTimer();
  tick();
  flushTime();
}

document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? startClock() : stopClock()));
window.addEventListener('pagehide', stopClock);
window.addEventListener('pageshow', (event) => {
  if (!event.persisted || !attempt || finished) return;
  const stored = getAttempt(loadTests(), attempt.id);
  if (stored && stored.status !== 'in_progress') return closedElsewhere(stored);
  if (stored) attempt = stored;
  render();
  startClock();
});

// --- Drawing. ---

function drawBar() {
  positionEl.textContent = `Question ${attempt.current + 1} of ${attempt.keys.length}`;
  clockEl.textContent = formatClock(remaining());
}

function buildGrid() {
  cells = attempt.keys.map((_, i) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tk-cell';
    button.dataset.index = String(i);
    const number = document.createElement('span');
    number.textContent = String(i + 1);
    const state = document.createElement('span');
    state.className = 'visually-hidden';
    button.append(number, state);
    const item = document.createElement('li');
    item.append(button);
    return { item, button, state };
  });
  grid.replaceChildren(...cells.map((c) => c.item));
}

function paintGrid() {
  let answered = 0;
  let marked = 0;
  attempt.keys.forEach((key, i) => {
    const isAnswered = Object.hasOwn(attempt.answers, key);
    const isMarked = attempt.review.includes(key);
    answered += isAnswered ? 1 : 0;
    marked += isMarked ? 1 : 0;
    const { button, state } = cells[i];
    button.toggleAttribute('data-answered', isAnswered);
    button.toggleAttribute('data-review', isMarked);
    if (i === attempt.current) button.setAttribute('aria-current', 'step');
    else button.removeAttribute('aria-current');
    state.textContent = `: ${isAnswered ? 'answered' : 'not answered'}${isMarked ? ', marked for review' : ''}`;
  });
  gridSummary.textContent = `${answered} answered · ${marked} marked · ${attempt.keys.length - answered} not answered`;
}

function render() {
  const key = attempt.keys[attempt.current];
  const q = entryOf(key);
  serialEl.textContent = serialOf(key);
  questionEl.textContent = q ? q.question : "This question isn't in our copy any more. It won't be scored.";
  for (const radio of radios) {
    radio.checked = Object.hasOwn(attempt.answers, key) && attempt.answers[key] === radio.value;
    radio.disabled = !q;
    optionText[radio.value].textContent = q ? q[radio.value] : '';
  }
  reviewBtn.setAttribute('aria-pressed', String(attempt.review.includes(key)));
  // A move button that has focus and becomes disabled hands focus to the other.
  const last = attempt.keys.length - 1;
  if (document.activeElement === prevBtn && attempt.current === 0) nextBtn.focus();
  if (document.activeElement === nextBtn && attempt.current === last) prevBtn.focus();
  prevBtn.disabled = attempt.current === 0;
  nextBtn.disabled = attempt.current === last;
  drawBar();
  paintGrid();
}

// --- Acting. ---

const currentKey = () => attempt.keys[attempt.current];

function choose(option) {
  const key = currentKey();
  if (!entryOf(key)) return;
  if (mutate((a, now) => chooseAnswer(a, key, option, now))) render();
}

function go(index) {
  const from = attempt.current;
  if (!mutate((a, now) => moveTo(a, index, now))) return;
  render();
  if (attempt.current !== from) announce(`Question ${attempt.current + 1} of ${attempt.keys.length}`);
}

optionsEl.addEventListener('change', (event) => {
  if (event.target.name === 'tk-answer') choose(event.target.value);
});
clearBtn.addEventListener('click', () => {
  const key = currentKey();
  if (mutate((a, now) => clearAnswer(a, key, now))) render();
});
reviewBtn.addEventListener('click', () => {
  const key = currentKey();
  if (mutate((a, now) => toggleReview(a, key, now))) render();
});
prevBtn.addEventListener('click', () => go(attempt.current - 1));
nextBtn.addEventListener('click', () => go(attempt.current + 1));
grid.addEventListener('click', (event) => {
  const cell = event.target.closest('.tk-cell');
  if (!cell) return;
  go(Number(cell.dataset.index));
  // On a phone the grid covers the question: close it and land on the question.
  if (!WIDE.matches) {
    gridBox.open = false;
    questionEl.focus();
  }
});

const fitGrid = () => {
  gridBox.open = WIDE.matches;
};
WIDE.addEventListener('change', fitGrid);

document.addEventListener('keydown', (event) => {
  if (page.dataset.view !== 'test' || finished || event.defaultPrevented) return;
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  if (document.querySelector('dialog[open]')) return;
  if (event.target.closest?.('input:not([type=radio]), textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
  const action = keyAction(event.key);
  if (!action) return;
  event.preventDefault();
  if (action.choose) choose(action.choose);
  else go(attempt.current + action.move);
});

// --- Finishing. ---

function finish({ timeUp = false } = {}) {
  if (finished) return;
  stopTimer();
  flushTime();
  const submitted = mutate((a, now) => submitAttempt(a, scoreAttempt(a.keys, a.answers, officialOf), now));
  if (!submitted) return;
  finished = true;
  document.dispatchEvent(new CustomEvent('sawaalbox:test'));
  if (saveFailed) {
    // Nothing on this device to open the results from: say the score here.
    message(`Submitted. ${resultLine(attempt.result, Math.min(attempt.elapsedMs, attempt.limitMs))}.`);
    return;
  }
  location.replace(`${resultUrl(attempt.id)}${timeUp ? '&timeup' : ''}`);
}

submitBtn.addEventListener('click', () => {
  const answered = Object.keys(attempt.answers).length;
  $('[data-submit-summary]').textContent =
    `${answered} answered · ${attempt.review.length} marked for review · ${attempt.keys.length - answered} not answered`;
  submitDialog.showModal();
});
submitDialog.addEventListener('close', () => {
  const choice = submitDialog.returnValue;
  submitDialog.returnValue = '';
  if (choice === 'submit') finish();
});

$('[data-abandon]').addEventListener('click', () => abandonDialog.showModal());
abandonDialog.addEventListener('close', () => {
  const choice = abandonDialog.returnValue;
  abandonDialog.returnValue = '';
  if (choice !== 'abandon') return;
  stopTimer();
  flushTime();
  if (!mutate((a, now) => abandonAttempt(a, now))) return;
  finished = true;
  document.dispatchEvent(new CustomEvent('sawaalbox:test'));
  location.assign('/upsc/test');
});

// --- Starting. ---

async function begin() {
  nameEl.textContent = attemptName(attempt);
  drawBar();
  submitBtn.disabled = true;
  show('loading');
  say(`Loading ${attempt.keys.length} questions…`);
  if (!(await loadQuestions())) {
    say("The questions didn't load. Check your connection, then try again.", { error: true });
    retryRow.hidden = false;
    return;
  }
  retryRow.hidden = true;
  say(saveFailed ? NOT_SAVED : '', { error: saveFailed });
  buildGrid();
  fitGrid();
  render();
  show('test');
  submitBtn.disabled = false;
  announce(`Question ${attempt.current + 1} of ${attempt.keys.length}`);
  startClock();
}

function retry() {
  if (page.dataset.view === 'loading' && !retryRow.hidden) begin();
}
$('[data-retry]').addEventListener('click', retry);
window.addEventListener('online', retry);

function openAttempt(id) {
  const stored = getAttempt(loadTests(), id);
  if (!stored) {
    message("This test isn't on this device.");
    // Signed in, the account may hold it: a sync that brings it opens it.
    const arrive = () => {
      if (!getAttempt(loadTests(), id)) return;
      document.removeEventListener('sawaalbox:synced', arrive);
      openAttempt(id);
    };
    document.addEventListener('sawaalbox:synced', arrive);
    return;
  }
  if (stored.status === 'submitted') return location.replace(resultUrl(id));
  if (stored.status === 'abandoned') return message("You abandoned this test. Its answers are kept, but it doesn't count in your results.");
  attempt = stored;
  begin();
}

function offerPaper(year) {
  const existing = inProgressPaper(loadTests(), year);
  if (existing) {
    history.replaceState(null, '', `?attempt=${encodeURIComponent(existing.id)}`);
    attempt = existing;
    return begin();
  }
  const info = PAPERS.find((p) => p.year === year);
  nameEl.textContent = `UPSC Prelims ${year}`;
  $('[data-start-facts]').textContent = `${info.questions} questions · 2 hours`;
  $('[data-start-notes]').replaceChildren(
    ...info.notes.map((text) => {
      const item = document.createElement('li');
      item.textContent = text;
      return item;
    })
  );
  show('start');
  const startBtn = $('[data-start-button]');
  startBtn.addEventListener('click', async () => {
    startBtn.disabled = true;
    say('');
    const path = `/upsc/full/${year}.json`;
    if (!(await canStartTest('upsc'))) {
      say("Tests aren't open to this account.", { error: true });
      startBtn.disabled = false;
      return;
    }
    if (!files.has(path) && !(await fetchYear(path))) {
      say("The paper didn't load. Check your connection, then try again.", { error: true });
      startBtn.disabled = false;
      return;
    }
    const fresh = newAttempt({
      id: newId(),
      kind: 'paper',
      spec: { year },
      keys: paperKeys(year, files.get(path)),
      limitMs: PAPER_MINUTES * MINUTE,
      now: iso(),
    });
    attempt = fresh;
    saveFailed = !saveTests(putAttempt(loadTests(), fresh));
    history.replaceState(null, '', `?attempt=${encodeURIComponent(fresh.id)}`);
    document.dispatchEvent(new CustomEvent('sawaalbox:test'));
    begin();
  });
}

// The questions and the bar are set in Courier Prime in part; drawn before the
// face is ready they would move when it swaps in. Wait for it, briefly.
function fontsReady() {
  if (!document.fonts?.load) return Promise.resolve();
  const faces = Promise.all(['400 1em "Courier Prime"', '700 1em "Courier Prime"'].map((font) => document.fonts.load(font)));
  return Promise.race([faces, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))]).catch(() => {});
}

fontsReady().then(() => {
  const params = new URLSearchParams(location.search);
  const id = params.get('attempt');
  const year = Number(params.get('paper'));
  if (id) openAttempt(id);
  else if (PAPERS.some((p) => p.year === year)) offerPaper(year);
  else message('Choose a paper, or build a practice set, to start a test.');
});
```

- [ ] **Step 5: Build, then check it headless**

1. Run `npm test` and `npm run build`. Expected: PASS and success. Then make a WIP commit.
2. Serve `dist/` locally from the background with the static server earlier tasks used (scratchpad `capture/`). Write `scratchpad/capture/t4-take.mjs` (puppeteer-core with the local Chrome and a hard 120 s timeout) to check the following.

**A full paper:**
1. `/upsc/test/take?paper=2020`:
   - the start screen shows "98 questions · 2 hours" and the note "2 questions cancelled by UPSC are left out";
   - storage has no attempt yet.
2. Press Start:
   - the address becomes `?attempt=<uuid>`;
   - the bar shows "Question 1 of 98";
   - the clock reads `1:59:5x` within a few seconds and counts down.
3. Answer, mark and clear:
   - Answer with a click.
   - Press `c`: the third option is checked and storage has the answer.
   - Mark for review: the grid cell gets `data-review`, and its hidden text says "marked for review".
   - Clear: the answer leaves storage.
   - `→` moves to question 2, and the live region says "Question 2 of 98".
   - With focus on a radio, `→` moves the question and does not change the answer.
4. **Hidden tab.** Emulate a hidden page (`Emulation.setFocusEmulationEnabled` is not enough; use `page.evaluate` to dispatch `visibilitychange` after overriding `document.visibilityState` via `Object.defineProperty`), wait 6 s, then make it visible again. Elapsed time grew by under 2 s across the hidden stretch.
5. **Reload.** The same question and the remaining time within 2 s of before. Read `sawaalbox-tests-v1` before and after.
6. **Auto-submit at zero.** Set the stored attempt's `elapsedMs` to `limitMs - 3000` and reload. Within 5 s:
   - the page lands on `/upsc/test/result?attempt=<id>&timeup`;
   - the stored attempt is `submitted` with a `result` whose `max` is `2 × scored`.

**A second paper:**
7. **Submit dialog.**
   - The dialog shows the counts. **Keep going** closes it and the clock still runs.
   - **Submit now** lands on results, and the browser's Back does not return to a live test: the take page was replaced, and visiting the old take address redirects to results.
8. **Abandon.**
   - Start 2019, answer 2, then Abandon → **Abandon**.
   - The page lands on `/upsc/test`, and the stored attempt is `abandoned` with its 2 answers.
   - Reopening `?attempt=<id>` shows the abandoned message.
   - `?paper=2019` now shows a fresh start screen and does not resume it.
9. **Resume.** With an unfinished 2018 attempt stored, `?paper=2018` resumes it, and the address becomes its `?attempt=`.
10. **Not on this device.** `?attempt=<random uuid>` shows "This test isn't on this device."
11. **A slow year file.** Throttle the full file (request interception with a 20 s delay):
    - after 15 s the error note and **Try again** show, and the clock is not running;
    - releasing the throttle and pressing Try again loads the test.
12. **Screen reader.**
    - The radio group's accessible name is the question text (CDP `Accessibility.getPartialAXTree` on the fieldset).
    - Grid cells' names read e.g. "3: answered, marked for review".
    - Set `elapsedMs` so 15 min + 2 s remain: the live region says "15 minutes left" within 4 s.
13. **Layout shift.**
    - CLS (PerformanceObserver `layout-shift`, `hadRecentInput` excluded) is 0 for a load of a stored attempt and for the start screen, at 360, 390 and 1280 px wide, in light and dark (`prefers-color-scheme` emulation).
    - Moving to a much longer question is user input, so it is excluded, but report it.
14. **Screenshots** (`scratchpad/capture/t4-*.png`): the start screen, the test with the grid open on a phone (390) and as a sidebar (1280), the submit dialog, and dark mode.

Fix anything that fails, then run the detector on `site/src/pages/upsc/test/take.astro`. Expected: `[]`.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/tests/clock.js site/tests/mock-clock.test.js site/src/pages/upsc/test/take.astro site/src/scripts/take-page.js
git commit -m "feat(tests): the test screen: one question at a time, grid, clock that pauses, submit and abandon"
```

### Task 5: The results page (`/upsc/test/result`) and the /account line

**Files:**
- Create: `site/src/lib/tests/review.js`, `site/tests/mock-review.test.js`, `site/src/pages/upsc/test/result.astro`, `site/src/scripts/result-page.js`
- Modify: `site/src/pages/account.astro` (a Practice tests section between Revision and By subject), `site/src/scripts/progress-page.js` (fill its line)

**Interfaces:**
- **Consumes:**
  - Task 1: `attemptName`, `loadTests`, `getAttempt`, `latestLine`, `TESTS_KEY`, `resultLine`, `accuracy`, `formatDate`, `bySubject`, `officialAnswer`.
  - `questionHTML` from `site/src/lib/question-html.js`.
  - `fullEntry`, `fullPath`, `fullPathsFor` and `serialOf` from `summary.js`.
  - `marks.js`, loaded once by the page with its own `<script>`, exactly as `revise.astro` does.
- **Produces:**
  - `review.js`:
    - `REVIEW_FILTERS = [{ id: 'all', label: 'All' }, { id: 'wrong', label: 'Wrong' }, { id: 'blank', label: 'Not answered' }, { id: 'review', label: 'Marked for review' }]`
    - `verdictOf(attempt, key, official) → 'right' | 'wrong' | 'blank' | 'unscored'`
    - `verdictText(verdict, mine, official) → string`
    - `reviewKeys(attempt, officialOf, filter) → string[]`
  - The page `/upsc/test/result?attempt=<id>`. `&timeup` adds the time-up line.

**Behaviour** (the spec's "3. Results" is binding):

- **The head** is drawn at once, from storage alone, before any fetch:
  - the name (h1);
  - *"Submitted 9 Oct 2026"*;
  - *"Time ran out, so the test was submitted for you."* when `timeup` is in the address or `elapsedMs >= limitMs`;
  - the score line from the stored `result`, e.g. `resultLine(result, min(elapsedMs, limitMs))`;
  - accuracy: *"Accuracy 78% of answered questions"*, or *"No questions answered"*;
  - links to **Practice tests** and to **Sit this paper again** (`/upsc/test/take?paper=<year>`, papers only).
- **Not on this device:** *"This test isn't on this device."* The page redraws if a sync brings it.
- **Not submitted:**
  - unfinished: *"This test isn't finished yet."* with a **Resume** link to `/upsc/test/take?attempt=<id>`;
  - abandoned: *"You abandoned this test, so it has no result."*
- **By subject** is a table (Subject, Right, Wrong, Not answered), A–Z. It is drawn once the year files have loaded, using the /revise loader pattern (15 s, Try again, retry when back online).
- **Review:**
  - **Filter buttons** (`aria-pressed`), each with its count: *"All (100)"*, *"Wrong (17)"*, *"Not answered (21)"*, *"Marked for review (3)"*.
  - **Questions in test order,** 20 at a time with **Show 20 more** (as /revise). Each is `questionHTML(entry)`, parsed through a `<template>`, with:
    - its `.qanswer` `<details>` set open, so the official answer is revealed;
    - a verdict line (`<p class="rs-verdict">`, `textContent`) inserted before its `.qmarks` slot;
    - on the option the student chose, a visible tag `<span class="rs-pick">Your answer</span>` appended to that `<li>`. This is a label, not colour alone.
  - Disputed questions already carry questionHTML's "Answer disputed" flag.
  - marks.js fills each block's `.qmarks` slot with Mark done, Needs review and Save to list.
  - A question whose year did not load shows its serial and *"This question didn't load."* with Try again. One gone from the file shows *"This question isn't in our copy any more."*
- **No layout shift:**
  - `main[data-pending]` is gated, as /revise is, until the head is drawn.
  - By subject and the review sit below the head and arrive later. Hold back the colophon (`data-settling`) until they have drawn.
  - The table and the review are the last things before the colophon, so nothing visible moves.
- **/account:**
  - A section "Practice tests" with `<p data-tests-line>` and a link **Practice tests** to `/upsc/test`.
  - progress-page.js sets the line to `latestLine(loadTests())` in its first draw, and again on `sawaalbox:synced` and `storage` (key `TESTS_KEY` or null).
  - Because it is drawn inside the gated `.acct` in the first draw, it moves nothing.

- [ ] **Step 1: Write the failing review tests**

`site/tests/mock-review.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MINUTE, chooseAnswer, newAttempt, toggleReview } from '../src/lib/tests/attempt.js';
import { REVIEW_FILTERS, reviewKeys, verdictOf, verdictText } from '../src/lib/tests/review.js';

const KEYS = ['upsc-2019-1', 'upsc-2019-2', 'upsc-2019-3', 'upsc-2019-4', 'upsc-2019-5'];
const OFFICIAL = { 'upsc-2019-1': 'a', 'upsc-2019-2': 'b', 'upsc-2019-3': 'c', 'upsc-2019-4': null, 'upsc-2019-5': 'd' };
const T = '2026-10-09T10:00:00.000Z';
let a = newAttempt({ id: '00000000-0000-4000-8000-000000000001', kind: 'paper', spec: { year: 2019 }, keys: KEYS, limitMs: 120 * MINUTE, now: T });
a = chooseAnswer(a, KEYS[0], 'a', T); // right
a = chooseAnswer(a, KEYS[1], 'c', T); // wrong
a = chooseAnswer(a, KEYS[3], 'b', T); // unscored, answered
a = toggleReview(toggleReview(a, KEYS[1], T), KEYS[4], T);
const officialOf = (k) => OFFICIAL[k];

test('verdicts: right, wrong, blank, and not scored', () => {
  assert.deepEqual(KEYS.map((k) => verdictOf(a, k, officialOf(k))), ['right', 'wrong', 'blank', 'unscored', 'blank']);
});

test('verdict lines say what was chosen and what it scored', () => {
  assert.equal(verdictText('right', 'a', 'a'), 'Your answer: (a). Right, +2.');
  assert.equal(verdictText('wrong', 'c', 'b'), 'Your answer: (c). Wrong, −0.67. The official answer is (b).');
  assert.equal(verdictText('blank', null, 'c'), 'Not answered. The official answer is (c).');
  assert.equal(verdictText('unscored', 'b', null), 'Not scored: UPSC gives no answer for this question. You chose (b).');
  assert.equal(verdictText('unscored', null, null), 'Not scored: UPSC gives no answer for this question.');
});

test('filters pick questions in test order', () => {
  assert.deepEqual(reviewKeys(a, officialOf, 'all'), KEYS);
  assert.deepEqual(reviewKeys(a, officialOf, 'wrong'), [KEYS[1]]);
  assert.deepEqual(reviewKeys(a, officialOf, 'blank'), [KEYS[2], KEYS[4]]);
  assert.deepEqual(reviewKeys(a, officialOf, 'review'), [KEYS[1], KEYS[4]]);
  assert.deepEqual(REVIEW_FILTERS.map((f) => f.id), ['all', 'wrong', 'blank', 'review']);
});
```

- [ ] **Step 2: Run to verify it fails, then implement `review.js`**

Run: `node --test tests/mock-review.test.js`
Expected: FAIL, because the module is missing.

`site/src/lib/tests/review.js`:

```js
// The results page's review (spec, "Review"): what each question scored, and
// which questions each filter shows. Pure; scripts/result-page.js draws it.

export const REVIEW_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'wrong', label: 'Wrong' },
  { id: 'blank', label: 'Not answered' },
  { id: 'review', label: 'Marked for review' },
];

const chosen = (attempt, key) => (Object.hasOwn(attempt.answers, key) ? attempt.answers[key] : null);

/** 'right' | 'wrong' | 'blank' (scored, not answered) | 'unscored' (no official answer). */
export function verdictOf(attempt, key, official) {
  if (!official) return 'unscored';
  const mine = chosen(attempt, key);
  if (!mine) return 'blank';
  return mine === official ? 'right' : 'wrong';
}

export function verdictText(verdict, mine, official) {
  if (verdict === 'right') return `Your answer: (${mine}). Right, +2.`;
  if (verdict === 'wrong') return `Your answer: (${mine}). Wrong, −0.67. The official answer is (${official}).`;
  if (verdict === 'blank') return `Not answered. The official answer is (${official}).`;
  return `Not scored: UPSC gives no answer for this question.${mine ? ` You chose (${mine}).` : ''}`;
}

/**
 * The keys a filter shows, in test order. "Not answered" is every question
 * without an answer, scored or not; "Wrong" needs an official answer to be wrong
 * against; "Marked for review" is the student's own flag.
 */
export function reviewKeys(attempt, officialOf, filter) {
  if (filter === 'review') return attempt.keys.filter((k) => attempt.review.includes(k));
  if (filter === 'blank') return attempt.keys.filter((k) => !chosen(attempt, k));
  if (filter === 'wrong') return attempt.keys.filter((k) => verdictOf(attempt, k, officialOf(k)) === 'wrong');
  return [...attempt.keys];
}
```

Run: `node --test tests/mock-review.test.js`
Expected: PASS.

- [ ] **Step 3: Write the page and its script**

`site/src/pages/upsc/test/result.astro`:
- The same skeleton as `revise.astro`: Document with `noindex`, Masthead, `<main class="sheet result" data-pending>`, Colophon.
- Load marks.js with its own `<script>import '../../../scripts/marks.js';</script>`, then `result-page.js` in a second script.
- Global styles, every class prefixed `rs-`.

Markup inside `main`:

```astro
<div class="rs-head">
  <h1 data-title tabindex="-1">Results</h1>
  <p class="rs-when" data-when></p>
  <p class="rs-timeup" data-timeup hidden>Time ran out, so the test was submitted for you.</p>
  <p class="rs-score" data-score></p>
  <p class="rs-accuracy" data-accuracy></p>
  <p class="rs-links" data-links></p>
</div>
<p class="rs-note" role="status" data-note></p>
<noscript><p class="rs-empty">Seeing your results needs JavaScript.</p></noscript>

<section class="rs-section" data-subjects-section hidden aria-labelledby="rs-subjects-h">
  <h2 id="rs-subjects-h">By subject</h2>
  <table class="rs-table">
    <thead><tr><th scope="col">Subject</th><th scope="col">Right</th><th scope="col">Wrong</th><th scope="col">Not answered</th></tr></thead>
    <tbody data-subjects></tbody>
  </table>
</section>

<section class="rs-section" data-review-section hidden aria-labelledby="rs-review-h">
  <h2 id="rs-review-h">Review</h2>
  <div class="rs-filters" role="group" aria-label="Show" data-filters></div>
  <div id="rs-items" class="rs-items"></div>
  <div class="rs-more" data-more hidden><button type="button" class="rs-btn">Show 20 more</button></div>
</section>
```

**Styles:**
- `.rs-score`: Archivo 700, 1.2rem.
- `.rs-table`: full width, hairline rules, numbers right-aligned in Courier Prime with tabular figures.
- `.rs-filters button`: outlined; `[aria-pressed='true']` gets a heavy frame **and** an underline, not colour alone.
- `.rs-verdict`: Archivo 600, 0.9rem, a hairline-dashed top rule.
- `.rs-pick`: a small Archivo 700 tag, `0.72rem`, uppercase, `2px solid var(--rule-strong)`, inline after the option text.
- **Gates:**
  - `.result[data-pending]` is hidden (with a 4 s reveal fallback).
  - `body:has(.result[data-pending], .result[data-settling]) .colophon` is hidden (with a 6 s fallback).

`site/src/scripts/result-page.js` must:
1. **Read the attempt** with `getAttempt(loadTests(), id)` and draw the head with `textContent` only.
   - Clear `data-pending` after the first draw, and set `data-settling` while the year files are on their way.
   - For the not-on-device, unfinished and abandoned cases, draw the message into `[data-note]`, hide both sections and clear `data-settling`.
2. **Load the year files** with the loader from /revise. Copy the `load` function and its 15 s controller and timer, adapted.
   - Store each file in a `Map` of path to `{ status, data }`.
   - While loading, put `Loading <n> questions…` in the note.
   - On failure, show an error note with **Try again**, and retry on `online`.
3. **Once every file has settled:**
   - fill By subject with `bySubject(attempt.keys, attempt.answers, entryOf)`, one `<tr>` per row, cells via `textContent`;
   - unhide both sections, draw the filters, draw the first 20 of `reviewKeys(attempt, officialOf, current filter)`, then clear `data-settling`.
4. **Each review item:**
   - Build it in a `<template>` from `questionHTML(entry)` (the entry from `fullEntry(...).q`, never raw file data).
   - Set `block.querySelector('.qanswer')?.setAttribute('open', '')`.
   - Insert `<p class="rs-verdict">` with `verdictText(verdictOf(...), mine, official)` before `.qmarks`.
   - If an option was chosen, append the `rs-pick` tag to `block.querySelectorAll('.qopts li')[OPTIONS.indexOf(mine)]`.
5. **A filter change** sets `aria-pressed`, redraws the list from its first 20, and says *"Showing 17 wrong answers"* in the note. **Show 20 more** appends the next 20 and moves focus to the first new block's question link, as /revise does.
6. **Listeners:**
   - `sawaalbox:synced` and `storage` (`TESTS_KEY`) redraw the head if the attempt was missing and has now arrived. The rest of the page never changes under the reader.
   - Marks on the page are marks.js's business.

- [ ] **Step 4: Add the /account line**

In `site/src/pages/account.astro`, between the Revision section and the By subject section, add:

```astro
<section class="acct-section" aria-labelledby="acct-tests-h">
  <h2 id="acct-tests-h">Practice tests</h2>
  <p class="acct-tests-line" data-tests-line></p>
  <p class="acct-tests-link"><a href="/upsc/test">Practice tests</a></p>
</section>
```

The comment above `.acct` explains the section order: Revision, then Practice tests, then By subject, which grows last. Extend it to cover the new section.

In `site/src/scripts/progress-page.js`:
- import `{ TESTS_KEY, latestLine, loadTests }` from `'../lib/tests/store.js'`;
- in the function that does the first draw and every redraw, set `document.querySelector('[data-tests-line]').textContent = latestLine(loadTests());`;
- extend the existing `storage` listener so that `event.key === TESTS_KEY` also refreshes.

Use the `.acct-note` styles for the line and the existing link style for the link. Add no new tokens.

- [ ] **Step 5: Test, build, check headless**

1. Run `npm test` and `npm run build`. Expected: PASS and success. Make a WIP commit.
2. Write `scratchpad/capture/t5-result.mjs` (puppeteer-core, 120 s timeout). Against the local `dist/` server, seed `sawaalbox-tests-v1` with a submitted 2020 attempt whose answers include, by the real 2020 file, 3 right and 2 wrong, the rest blank (the paper has 98 keys: its 2 cancelled questions are left out). Then check:
   - The head shows *"Score 4.67 / 196 · 3 right · 2 wrong · 93 not answered · …"*. Compute the exact expected line in the script from the seeded data with `resultLine`, to avoid hand arithmetic.
   - Accuracy reads *"Accuracy 60% of answered questions"*.
   - By subject rows sum to right 3, wrong 2.
   - The **Wrong** filter shows exactly the 2 wrong questions. Each has the verdict line, the official answer open, and a "Your answer" tag on the chosen option.
   - **Not answered** shows 93, 20 at a time with Show 20 more.
   - **Mark done** works on a review block: storage has the mark and `aria-pressed` is true.
   - `&timeup` shows the time-up line.
   - An unknown id shows "This test isn't on this device." An in-progress id shows Resume.
   - `/account` shows the Practice tests line with the latest result.
   - **CLS** is 0 at 360, 390 and 1280, light and dark.
   - **Screenshots:** results at 390 and 1280, and /account at 390.
3. Run the detector on `result.astro` and `account.astro`. Expected: `[]`, or only the findings already on account.astro before this task. Run it on the base version to compare.

- [ ] **Step 6: Commit**

```bash
git add site/src/lib/tests/review.js site/tests/mock-review.test.js site/src/pages/upsc/test/result.astro site/src/scripts/result-page.js site/src/pages/account.astro site/src/scripts/progress-page.js
git commit -m "feat(tests): results page with score, subjects and review; latest result on /account"
```

### Task 6: The Practice tests page (`/upsc/test`) and the ways in

**Files:**
- Create: `site/src/pages/upsc/test/index.astro`, `site/src/scripts/tests-page.js`
- Modify: `site/src/components/Masthead.astro`, `site/src/pages/upsc/year/[year]/[...page].astro`, `site/src/pages/index.astro`, `site/src/pages/sitemap.xml.js`

**Interfaces:**
- **Consumes:**
  - Task 1: `attemptName`, `progressLine`, `remainingMs`, `abandonAttempt`; `loadTests`, `saveTests`, `putAttempt`, `getAttempt`, `unfinished`, `finished`, `TESTS_KEY`; `formatDate`, `formatScore`.
  - Task 2: `PAPERS`.
  - Task 4: `formatClock`.
  - The accounts code:
    - `authEnabled`, `SUPABASE_URL`, `sessionHint`, `storageKeyFor`, `storedUserId` and `firstSyncHere` from `site/src/lib/accounts/config.js`;
    - `deviceOwner` from `pull.js`.
- **Produces:**
  - **`/upsc/test`:** an indexable page in the sitemap. Its main wrapper `.tp` carries `data-sync-full` when sign-in is on, so a sync started here reads the whole account (the spec's "Full pull").
  - **Section ids** that Task 7 relies on: `#papers`, then `#results`. Task 7 inserts `#practice` between them.

**Behaviour:**

- **Page layout.** Use `Listing` with:
  - title *"UPSC Prelims Practice Tests"*;
  - description *"Sit any UPSC Prelims paper from 1995 to 2026 against the clock, or build a practice set by subject, topic and year. Scored with today's negative marking, and free during the beta."*;
  - heading *"Practice tests"*;
  - standfirst *"Every past paper, timed and scored the way UPSC scores it today: +2 for a right answer, minus two-thirds of a mark for a wrong one. Free during the beta."*;
  - crumbs `[{ name: 'Tests', href: '/upsc/test' }]`.

  Inside, one wrapper `<div class="tp" data-pending data-sync-full={authEnabled ? '' : undefined}>` holds, in order:
  1. **Carry on** (`#carry`, `hidden` until JS finds unfinished attempts): one row per attempt with its name, *"34 of 100 answered · 1:12:05 left"*, a **Resume** link to `/upsc/test/take?attempt=<id>`, and an **Abandon** button.
  2. **Sit a past paper** (`#papers`), server-rendered from `PAPERS`, newest first. Each item has:
     - a link *"UPSC Prelims 2026"* to `/upsc/test/take?paper=2026`;
     - a serial line *"99 questions · 2 hours"*;
     - the year's notes, if any, as a smaller line.

     These are plain links, so they work without JavaScript.
  3. **Past results** (`#results`, `hidden` until JS finds any): the newest 20 submitted attempts, then **Show all *n*** if there are more. Each row has the name, linked to `/upsc/test/result?attempt=<id>`, then the date and *"112.67 / 200"*.
- **Abandon from the list** opens a modal `<dialog>`: *"Abandon <name>? Its answers are kept, but it won't count in your results."*, with **Abandon** (outlined) and **Keep it** (autofocus). Confirming will:
  1. apply `abandonAttempt` to the stored copy and save it;
  2. dispatch `sawaalbox:test`;
  3. redraw;
  4. put *"Abandoned. Its answers are kept."* in the page's status line.
- **Drawing.** Everything drawn from storage uses `textContent`, never HTML strings.
  - The page draws once at start and again on `sawaalbox:synced` and on `storage` (key `TESTS_KEY` or null).
  - The first draw is held for the first sync on a device that has never held this account's data, as progress-page.js does: `firstSyncHere`, released on `sawaalbox:sync-done` or after 2.5 s. Copy that block and its comment.
- **Gate:**
  - `.tp[data-pending]` is hidden under `@media (scripting: enabled)`, with a 4 s reveal-animation fallback, until the first draw.
  - Without JavaScript the gate does not apply, so the papers list shows.
- **Design:**
  - On this page the one filled-green action is Task 7's **Start practice set**. Until Task 7 lands the page has none, which is allowed.
  - Resume is an outlined button-styled link; Abandon is an outlined button.
  - Square corners and tokens only, with `tp-` prefixed classes in a `<style is:global>` block.

**Ways in:**
- **Masthead:** `<a href={`${exam.path}/test`}>Tests</a>` after Search, matching the other exam links. The exam links carry no `aria-current` today; keep it that way.
- **Year page:** a `slot="meta"` line *"Sit this paper · 99 questions · 2 hours, timed and scored"*. The words *Sit this paper* are a link to `/upsc/test/take?paper=<year>`, and the count comes from `PAPERS`. It shows on every page of the year, since the listing is paginated.
- **Homepage:**
  - Move "Sit a full year's paper" from `COMING` to `LIVE`, after "Revision lists", with `href: '/upsc/test'` and body *"Every UPSC paper since 1995, timed, and scored with today's negative marking. Free during the beta."*
  - `COMING` keeps "See where you are weak".
- **Sitemap:** add `add('/upsc/test', '0.85');` after `/upsc/years`. The take and results pages are not added.

- [ ] **Step 1: Write the page**

`site/src/pages/upsc/test/index.astro`:

```astro
---
import Listing from '../../../layouts/Listing.astro';
import { PAPERS } from '../../../lib/papers.js';
import { authEnabled } from '../../../lib/accounts/config.js';

// The Practice tests page (spec, "1. Starting a test"). Indexable: the list of
// papers is server-rendered and works without JavaScript, each a plain link to
// the take page's start screen. Carry on and Past results are this device's own
// attempts, drawn by tests-page.js.
---

<Listing
  title="UPSC Prelims Practice Tests"
  description="Sit any UPSC Prelims paper from 1995 to 2026 against the clock, or build a practice set by subject, topic and year. Scored with today's negative marking, and free during the beta."
  heading="Practice tests"
  standfirst="Every past paper, timed and scored the way UPSC scores it today: +2 for a right answer, minus two-thirds of a mark for a wrong one. Free during the beta."
  crumbs={[{ name: 'Tests', href: '/upsc/test' }]}
>
  {/* data-sync-full: this page lists every attempt the account holds, so a sync
      started here reads all of it (startSync in scripts/sync.js). data-pending:
      nothing in here is on screen until tests-page.js has drawn, so Carry on
      appearing above the papers moves nothing anyone has seen. */}
  <div class="tp" data-pending data-sync-full={authEnabled ? '' : undefined}>
    <p class="tp-note" role="status" data-note></p>

    <section class="tp-section" id="carry" aria-labelledby="tp-carry-h" hidden>
      <h2 id="tp-carry-h">Carry on</h2>
      <ul class="tp-rows" data-carry></ul>
    </section>

    <section class="tp-section" id="papers" aria-labelledby="tp-papers-h">
      <h2 id="tp-papers-h">Sit a past paper</h2>
      <ol class="tp-papers">
        {
          PAPERS.map((p) => (
            <li class="tp-paper">
              <a class="tp-paper-name" href={`/upsc/test/take?paper=${p.year}`}>
                UPSC Prelims {p.year}
              </a>
              <span class="serial tp-paper-facts">{p.questions} questions · 2 hours</span>
              {p.notes.length > 0 && <span class="tp-paper-notes">{p.notes.join('. ')}.</span>}
            </li>
          ))
        }
      </ol>
    </section>

    <section class="tp-section" id="results" aria-labelledby="tp-results-h" hidden>
      <h2 id="tp-results-h">Past results</h2>
      <ul class="tp-rows" data-results></ul>
      <p class="tp-more" data-more hidden><button type="button" class="tp-btn" data-more-button></button></p>
    </section>

    <dialog class="tp-dialog" data-abandon-dialog aria-labelledby="tp-abandon-h">
      <form method="dialog">
        <h2 id="tp-abandon-h" data-abandon-title>Abandon this test?</h2>
        <p>Its answers are kept, but it won't count in your results.</p>
        <div class="tp-dialog-actions">
          <button value="abandon" class="tp-btn">Abandon</button>
          <button value="keep" class="tp-btn" autofocus>Keep it</button>
        </div>
      </form>
    </dialog>
  </div>
</Listing>

<script>
  import '../../../scripts/tests-page.js';
</script>
```

Add the styles in a `<style is:global>` block in the same file, `tp-` prefixed:
- `.tp-section` spacing like `.acct-section`, with an `h2` per section.
- **Papers:** a list with hairline rules between items, laid out as a 3-column grid on wide screens (name, facts, notes) and stacked on phones. `.tp-paper-name` is Archivo 700. `.tp-paper-notes` is `var(--ink-soft)`, 0.9rem.
- `.tp-rows li`: flex, wrapping. Name, then details in `var(--ink-soft)`, then actions pushed right.
- **Buttons and links:** `.tp-btn` and `.tp-link-btn` (Resume) are outlined (2px Heavy Rule, paper, `var(--field-text)`), with `min-height: 2.75rem` on coarse pointers.
- `.tp-note` holds one line's height (`min-height: 1.6em`).
- **Dialog:** square, heavy frame, paper, and a translucent ink backdrop.
- **The gate:**

  ```css
  @keyframes tp-reveal { to { visibility: visible; } }
  @media (scripting: enabled) {
    .tp[data-pending] { visibility: hidden; animation: tp-reveal 0s 4s forwards; }
  }
  ```

- [ ] **Step 2: Write the script**

`site/src/scripts/tests-page.js`:

```js
import { abandonAttempt, attemptName, progressLine, remainingMs } from '../lib/tests/attempt.js';
import { TESTS_KEY, finished, getAttempt, loadTests, putAttempt, saveTests, unfinished } from '../lib/tests/store.js';
import { formatDate, formatScore } from '../lib/tests/score.js';
import { formatClock } from '../lib/tests/clock.js';
import { SUPABASE_URL, firstSyncHere, sessionHint, storageKeyFor, storedUserId } from '../lib/accounts/config.js';
import { deviceOwner } from '../lib/accounts/pull.js';

// /upsc/test: this device's unfinished attempts (Carry on) and submitted ones
// (Past results). The papers list is the page's own markup; the practice-set
// form is practice-form.js. Everything here is drawn with textContent: names
// and ids come from storage, which is the user's.

const RESULTS_SHOWN = 20;
const FIRST_SYNC_HOLD_MS = 2500;

const $ = (selector) => document.querySelector(selector);
const wrap = $('.tp');
const note = $('[data-note]');
const carry = $('#carry');
const carryList = $('[data-carry]');
const results = $('#results');
const resultsList = $('[data-results]');
const more = $('[data-more]');
const moreButton = $('[data-more-button]');
const dialog = $('[data-abandon-dialog]');

let showAll = false;
let abandoning = null; // the id the open dialog is about

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const link = (className, href, text) => {
  const a = el('a', className, text);
  a.href = href;
  return a;
};

function carryRow(a) {
  const row = el('li', 'tp-row');
  const abandon = el('button', 'tp-btn', 'Abandon');
  abandon.type = 'button';
  abandon.dataset.abandon = a.id;
  const actions = el('span', 'tp-row-actions');
  actions.append(link('tp-link-btn', `/upsc/test/take?attempt=${encodeURIComponent(a.id)}`, 'Resume'), abandon);
  row.append(
    el('span', 'tp-row-name', attemptName(a)),
    el('span', 'tp-row-detail', `${progressLine(a)} · ${formatClock(remainingMs(a))} left`),
    actions
  );
  return row;
}

function resultRow(a) {
  const row = el('li', 'tp-row');
  row.append(
    link('tp-row-name', `/upsc/test/result?attempt=${encodeURIComponent(a.id)}`, attemptName(a)),
    el('span', 'tp-row-detail', formatDate(a.submittedAt)),
    el('span', 'serial tp-row-score', `${formatScore(a.result.score)} / ${a.result.max}`)
  );
  return row;
}

function draw() {
  const tests = loadTests();
  const open = unfinished(tests);
  carry.hidden = open.length === 0;
  carryList.replaceChildren(...open.map(carryRow));
  const done = finished(tests);
  results.hidden = done.length === 0;
  const shown = showAll ? done : done.slice(0, RESULTS_SHOWN);
  resultsList.replaceChildren(...shown.map(resultRow));
  more.hidden = shown.length === done.length;
  moreButton.textContent = `Show all ${done.length}`;
}

moreButton.addEventListener('click', () => {
  showAll = true;
  draw();
});

carryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-abandon]');
  if (!button) return;
  const a = getAttempt(loadTests(), button.dataset.abandon);
  if (!a) return;
  abandoning = a.id;
  $('[data-abandon-title]').textContent = `Abandon ${attemptName(a)}?`;
  dialog.showModal();
});

dialog.addEventListener('close', () => {
  const choice = dialog.returnValue;
  dialog.returnValue = '';
  const id = abandoning;
  abandoning = null;
  if (choice !== 'abandon' || !id) return;
  const tests = loadTests();
  const a = getAttempt(tests, id);
  if (!a || a.status !== 'in_progress') return draw();
  if (!saveTests(putAttempt(tests, abandonAttempt(a, new Date().toISOString())))) {
    note.textContent = 'Your browser would not save that. Check that it lets this site store data.';
    return;
  }
  document.dispatchEvent(new CustomEvent('sawaalbox:test'));
  draw();
  note.textContent = 'Abandoned. Its answers are kept.';
  // The row and its button are gone; land somewhere that still exists.
  (carry.hidden ? $('#tp-papers-h') : carryList.querySelector('a, button'))?.focus?.();
});

function reveal() {
  draw();
  delete wrap.dataset.pending;
}

// A signed-in visitor on a device that has never held their account's data is
// about to have attempts arrive from the first sync, which would push the
// papers down. Hold the first draw for that sync, as /account does
// (progress-page.js), for at most FIRST_SYNC_HOLD_MS.
let held = false;
try {
  const storageKey = storageKeyFor(SUPABASE_URL);
  held = sessionHint(localStorage, location.search, storageKey) && firstSyncHere(deviceOwner.read(), storedUserId(localStorage, storageKey));
} catch {
  /* blocked storage: nothing to wait for */
}
if (held) {
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    reveal();
  };
  document.addEventListener('sawaalbox:sync-done', release, { once: true });
  setTimeout(release, FIRST_SYNC_HOLD_MS);
} else {
  reveal();
}

document.addEventListener('sawaalbox:synced', () => {
  if (!wrap.dataset.pending) draw();
});
window.addEventListener('storage', (event) => {
  if (event.key === TESTS_KEY || event.key === null) draw();
});
```

The `#tp-papers-h` focus target needs `tabindex="-1"` on that `h2`; add it in the markup.

When sign-in is switched off, `SUPABASE_URL` is `''`, `storageKeyFor('')` throws (`new URL('')`), and the `catch` leaves `held` false. So nothing is held, as wanted. Keep the comment saying so.

- [ ] **Step 3: The ways in**

1. **Masthead.astro:** add `<a href={`${exam.path}/test`}>Tests</a>` after the Search link.
2. **Year page** (`site/src/pages/upsc/year/[year]/[...page].astro`):
   - Import `PAPERS` from `'../../../../lib/papers.js'` and find the year's entry.
   - Add inside `<Listing>`:

     ```astro
     <p slot="meta" class="sit-line">
       <a href={`/upsc/test/take?paper=${year}`}>Sit this paper</a>
       <span class="serial">{paper.questions} questions · 2 hours, timed and scored</span>
     </p>
     ```

   - Style it in the page's scoped `<style>`: Archivo 600, 0.9rem, `margin: 0.6rem 0 0`, a gap between the parts, wrapping on phones.
3. **index.astro:**
   - Remove the "Sit a full year's paper" entry from `COMING`.
   - Add to `LIVE`, after "Revision lists":

     ```js
     {
       title: "Sit a full year's paper",
       body: 'Every UPSC paper since 1995, timed, and scored with today’s negative marking. Free during the beta.',
       href: '/upsc/test',
     },
     ```

4. **sitemap.xml.js:** add `add('/upsc/test', '0.85');` after `add('/upsc/years', '0.9');`.

- [ ] **Step 4: Test, build, check**

1. Run `npm test`, `npm run build` and `node scripts/check-links.mjs` (from `site/`). Expected: all pass. Then confirm:
   - `dist/sitemap.xml` contains `/upsc/test<` and not `/upsc/test/take`.
   - `dist/upsc/test.html` (or `dist/upsc/test/index.html`, whichever the build writes) exists, with all 32 paper links.
   - The year pages carry the Sit this paper link.

   Make a WIP commit.
2. Write `scratchpad/capture/t6-page.mjs` (puppeteer-core, 120 s timeout). Check:
   - **With JavaScript disabled** (`page.setJavaScriptEnabled(false)`): `/upsc/test` shows the 32 paper links, Carry on and Past results are absent, and the `<noscript>` lines of the take and results pages appear when those addresses are opened.
   - **With seeded storage** (one unfinished 2019 attempt, three submitted, one abandoned):
     - Carry on shows one row, "*n* of 100 answered · h:mm:ss left".
     - Past results shows three rows, newest first.
     - The abandoned attempt is in neither list.
     - Abandon → **Keep it** changes nothing; Abandon → **Abandon** moves it out of Carry on, storage says `abandoned`, and focus lands on the papers heading.
     - Resume opens the take page at the stored question.
   - **Nav and links:**
     - The masthead shows Subjects · Years · Search · Tests on an exam page.
     - The homepage lists "Sit a full year's paper" among the available features, linked to `/upsc/test`.
     - The year page's Sit this paper opens the start screen.
   - **CLS** is 0 for `/upsc/test` with seeded storage, at 360, 390 and 1280, light and dark.
   - **Screenshots** of `/upsc/test` at 390 and 1280, the homepage contents section, and a year page's head.
3. Run the detector on `upsc/test/index.astro`, `Masthead.astro`, the year page and `index.astro`. Expected: `[]`, apart from the sanctioned homepage `.slot::after` finding.

- [ ] **Step 5: Commit**

```bash
git add site/src/pages/upsc/test/index.astro site/src/scripts/tests-page.js site/src/components/Masthead.astro "site/src/pages/upsc/year/[year]/[...page].astro" site/src/pages/index.astro site/src/pages/sitemap.xml.js
git commit -m "feat(tests): Practice tests page with papers, carry on and past results; Tests in the nav"
```

### Task 7: The practice-set form, and Practise links on subject and topic pages

**Files:**
- Create: `site/src/lib/tests/form.js`, `site/tests/mock-form.test.js`, `site/src/scripts/practice-form.js`
- Modify:
  - `site/src/pages/upsc/test/index.astro` (the `#practice` section between `#papers` and `#results`, plus its script);
  - `site/src/pages/upsc/subject/[slug]/[...page].astro` and `site/src/pages/upsc/topic/[subject]/[topic]/[...page].astro` (Practise links);
  - `PRODUCT.md` (one sentence).

**Interfaces:**
- **Consumes:**
  - Task 1: `COUNTS`, `MIN_MINUTES`, `MAX_MINUTES`, `MINUTE`, `newAttempt`; `loadTests`, `saveTests`, `putAttempt`; `canStartTest`.
  - Task 2: `parseCatalogue`, `setPool`, `drawSet`, `newSeed`, `defaultMinutes`; `/upsc/catalogue.json`.
  - `loadState` from `site/src/lib/accounts/progress-store.js` (the marks, for the switches) and `newListId` from `lists.js`.
  - `SUBJECTS`, `SUBTOPICS` and `YEARS` from `corpus.js` (build time).
- **Produces:**
  - `form.js`: `readSpec(values, seed) → spec`, `poolMessage(poolSize, count) → string`, `preselection(search) → { subject: slug|null, topic: slug|null }`.
  - Practise links: `/upsc/test?subject=<slug>#practice` and `/upsc/test?subject=<slug>&topic=<slug>#practice`.

**Behaviour** (the spec's "Build a practice set" is binding):

- **The form is server-rendered**, so it costs no layout shift. Its controls sit inside `<fieldset data-practice-fields disabled>` and are enabled by the script. Without JavaScript a `<noscript>` line says *"Building a practice set needs JavaScript."*
- **Subjects:** one checkbox per subject, A–Z, with its question count. Each subject has a `<details>` "Topics" holding one checkbox per topic, A–Z, with its count.
  - A topic's value is `JSON.stringify([subject, topic])`.
  - Every box carries `data-slug`, and topic boxes also carry `data-subject` (the subject slug).
  - Ticking a topic ticks its subject. Unticking a subject unticks its topics.
  - No subject ticked means every subject. The legend says so.
- **Years:** two selects, From and To, from the first year to the last; the defaults are the full range. A From after To is swapped when read.
- **Count and time:**
  - Number of questions: radios 10, 25, 50 or 100, default 25.
  - Time in minutes: a number input, 5–180, default `defaultMinutes(25)` = 30.
  - While the student has not typed in the time field, it follows `defaultMinutes(min(count, pool size))`. Once they type, it is theirs.
- **Switches:** *Skip questions I've marked Done*, and *Only my Needs review questions*.
- **The pool line** (`role="status"`, one line's height reserved) shows `poolMessage(pool, count)`:
  - *"312 questions match. The set will have 25."*
  - *"Only 12 questions match: the set will have all 12."*
  - *"Only 1 question matches: the set will have just that one."*
  - *"No questions match. Widen the filters."* In this case **Start practice set** is disabled.
- **The catalogue** is fetched the first time it is needed: on the first `focusin` or `pointerdown` in the form, at once when the address preselects a subject, or on submit. It uses the /revise loader pattern: a 15 s timeout, an error line with **Try again**, and a retry on `online`. Until it arrives the pool line reads *"Counting the questions…"* (only while fetching; before the first fetch the line is empty).
- **Start practice set** is the page's one filled-green action. On submit:
  1. Read the spec with a fresh seed (`newSeed()`).
  2. Check the pool.
  3. Check `await canStartTest('upsc')`.
  4. Draw the keys (`drawSet`) and create the attempt (`kind: 'custom'`, `limitMs = minutes × MINUTE`).
  5. Save it. A refused save shows *"Your browser would not save the test. Check that it lets this site store data."* and stops, because the take page reads the attempt from storage.
  6. Dispatch `sawaalbox:test`.
  7. Go to `/upsc/test/take?attempt=<id>`.
- **Preselection:** `?subject=<slug>` ticks that subject. `&topic=<slug>` also ticks that topic within it and opens its `<details>`. The `#practice` hash scrolls the form into view, and the gate uses `visibility`, so the scroll position holds.
- **Practise links:**
  - Each subject page gets `<p slot="meta" class="practise-line"><a href="/upsc/test?subject={slug}#practice">Practise this subject</a></p>`.
  - Each topic page gets the same with `&topic={topicSlug}`, worded **Practise this topic**, placed after its existing meta line. Two elements may share `slot="meta"`.

- [ ] **Step 1: Write the failing form tests**

`site/tests/mock-form.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolMessage, preselection, readSpec } from '../src/lib/tests/form.js';

const values = (o = {}) => ({
  subjects: [],
  topics: [],
  fromYear: '1995',
  toYear: '2026',
  count: '25',
  minutes: '30',
  skipDone: false,
  onlyReview: false,
  ...o,
});

test('a plain form reads as every subject, all years, 25 questions, 30 minutes', () => {
  assert.deepEqual(readSpec(values(), 7), {
    subjects: [],
    topics: [],
    fromYear: 1995,
    toYear: 2026,
    count: 25,
    minutes: 30,
    skipDone: false,
    onlyReview: false,
    seed: 7,
  });
});

test('a topic brings its subject; topics that are not [subject, topic] pairs are dropped', () => {
  const spec = readSpec(
    values({ subjects: ['Geography'], topics: [JSON.stringify(['Indian Polity', 'Parliament']), 'nonsense', JSON.stringify([1, 2])] }),
    1
  );
  assert.deepEqual(spec.subjects, ['Geography', 'Indian Polity']);
  assert.deepEqual(spec.topics, [['Indian Polity', 'Parliament']]);
});

test('years read in either order; count and minutes are kept to what a test allows', () => {
  const spec = readSpec(values({ fromYear: '2020', toYear: '2001', count: '30', minutes: '999' }), 1);
  assert.deepEqual([spec.fromYear, spec.toYear, spec.count, spec.minutes], [2001, 2020, 25, 180]);
  assert.equal(readSpec(values({ minutes: '2' }), 1).minutes, 5);
  assert.equal(readSpec(values({ count: '100', minutes: '' }), 1).minutes, 120, 'empty time takes the default');
  assert.equal(readSpec(values({ minutes: '12.6' }), 1).minutes, 13);
  assert.deepEqual([readSpec(values({ skipDone: true, onlyReview: true }), 1).skipDone, readSpec(values({ onlyReview: true }), 1).onlyReview], [true, true]);
});

test('the pool line says how many match and what the set will have', () => {
  assert.equal(poolMessage(312, 25), '312 questions match. The set will have 25.');
  assert.equal(poolMessage(25, 25), '25 questions match. The set will have 25.');
  assert.equal(poolMessage(12, 25), 'Only 12 questions match: the set will have all 12.');
  assert.equal(poolMessage(1, 10), 'Only 1 question matches: the set will have just that one.');
  assert.equal(poolMessage(0, 10), 'No questions match. Widen the filters.');
});

test('preselection reads slugs from the address, and nothing else', () => {
  assert.deepEqual(preselection('?subject=indian-polity&topic=parliament'), { subject: 'indian-polity', topic: 'parliament' });
  assert.deepEqual(preselection('?subject=geography'), { subject: 'geography', topic: null });
  assert.deepEqual(preselection('?topic=parliament'), { subject: null, topic: null });
  assert.deepEqual(preselection('?subject=<b>'), { subject: null, topic: null });
  assert.deepEqual(preselection(''), { subject: null, topic: null });
});
```

- [ ] **Step 2: Run to verify it fails, then implement `form.js`**

Run: `node --test tests/mock-form.test.js`
Expected: FAIL, because the module is missing.

`site/src/lib/tests/form.js`:

```js
import { COUNTS, MAX_MINUTES, MIN_MINUTES } from './attempt.js';
import { defaultMinutes } from './build.js';

// The practice-set form's rules, apart from its DOM (scripts/practice-form.js).

const isPair = (p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'string');

function pairOf(value) {
  try {
    const p = JSON.parse(value);
    return isPair(p) ? [p[0], p[1]] : null;
  } catch {
    return null;
  }
}

/**
 * The form's values, as read from it (strings and booleans), as a set's spec.
 * A ticked topic brings its subject, so a spec's topics always lie inside its
 * subjects (parseAttempt keeps only those). Out-of-range numbers are brought in
 * range rather than refused: the form's own limits should already have stopped them.
 */
export function readSpec(values, seed) {
  const topics = values.topics.map(pairOf).filter(Boolean);
  const subjects = [...new Set([...values.subjects, ...topics.map(([s]) => s)])];
  let fromYear = Number(values.fromYear);
  let toYear = Number(values.toYear);
  if (fromYear > toYear) [fromYear, toYear] = [toYear, fromYear];
  const count = COUNTS.includes(Number(values.count)) ? Number(values.count) : 25;
  const typed = Math.round(Number(values.minutes));
  const minutes = values.minutes !== '' && Number.isFinite(typed) && typed > 0
    ? Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, typed))
    : defaultMinutes(count);
  return {
    subjects,
    topics,
    fromYear,
    toYear,
    count,
    minutes,
    skipDone: Boolean(values.skipDone),
    onlyReview: Boolean(values.onlyReview),
    seed,
  };
}

/** The line under the form (spec: a small pool is used whole "and the page says so"). */
export function poolMessage(poolSize, count) {
  if (poolSize === 0) return 'No questions match. Widen the filters.';
  if (poolSize === 1 && count > 1) return 'Only 1 question matches: the set will have just that one.';
  if (poolSize < count) return `Only ${poolSize} questions match: the set will have all ${poolSize}.`;
  return `${poolSize} questions match. The set will have ${count}.`;
}

const SLUG = /^[a-z0-9-]+$/;

/** What a Practise link asks the form to tick: a subject slug, and a topic slug within it. */
export function preselection(search) {
  const params = new URLSearchParams(search);
  const subject = params.get('subject');
  if (!subject || !SLUG.test(subject)) return { subject: null, topic: null };
  const topic = params.get('topic');
  return { subject, topic: topic && SLUG.test(topic) ? topic : null };
}
```

Run: `node --test tests/mock-form.test.js`
Expected: PASS.

- [ ] **Step 3: Add the form to the page**

In `site/src/pages/upsc/test/index.astro`, add to the frontmatter:

```js
import { SUBJECTS, SUBTOPICS, YEARS } from '../../../lib/corpus.js';
import { COUNTS } from '../../../lib/tests/attempt.js';
import { defaultMinutes } from '../../../lib/tests/build.js';

const byName = (a, b) => a.localeCompare(b, 'en');
// Every subject A to Z, each with every topic in it, A to Z: the form offers
// all 116 topics, thin ones included, since a set may want exactly those.
const SUBJECT_TOPICS = [...SUBJECTS]
  .sort((a, b) => byName(a.name, b.name))
  .map((s) => ({
    ...s,
    topics: SUBTOPICS.filter((t) => t.subject === s.name).sort((a, b) => byName(a.subtopic, b.subtopic)),
  }));
const YEARS_UP = YEARS.map((y) => y.year).sort((a, b) => a - b);
```

Between `#papers` and `#results`, add:

```astro
<section class="tp-section" id="practice" aria-labelledby="tp-practice-h">
  <h2 id="tp-practice-h">Build a practice set</h2>
  <p class="tp-lede">Choose subjects, topics and years, and how many questions. Questions are drawn at random from those that match.</p>
  <form class="tp-form" data-practice novalidate>
    <fieldset class="tp-fields" data-practice-fields disabled>
      <fieldset class="tp-group">
        <legend>Subjects and topics <span class="tp-hint">(none ticked: every subject)</span></legend>
        <ul class="tp-subjects">
          {
            SUBJECT_TOPICS.map((s) => (
              <li class="tp-subject">
                <label class="tp-check">
                  <input type="checkbox" name="subject" value={s.name} data-slug={s.slug} />
                  <span>{s.name}</span> <span class="serial tp-count">{s.count}</span>
                </label>
                <details class="tp-topics">
                  <summary>
                    Topics<span class="visually-hidden"> in {s.name}</span>
                  </summary>
                  <ul>
                    {s.topics.map((t) => (
                      <li>
                        <label class="tp-check">
                          <input
                            type="checkbox"
                            name="topic"
                            value={JSON.stringify([s.name, t.subtopic])}
                            data-slug={t.slug}
                            data-subject={s.slug}
                          />
                          <span>{t.subtopic}</span> <span class="serial tp-count">{t.count}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            ))
          }
        </ul>
      </fieldset>
      <fieldset class="tp-group tp-years">
        <legend>Years</legend>
        <label>From <select name="fromYear">{YEARS_UP.map((y, i) => <option value={y} selected={i === 0}>{y}</option>)}</select></label>
        <label>To <select name="toYear">{YEARS_UP.map((y, i) => <option value={y} selected={i === YEARS_UP.length - 1}>{y}</option>)}</select></label>
      </fieldset>
      <fieldset class="tp-group tp-counts">
        <legend>Questions</legend>
        {COUNTS.map((n) => <label class="tp-check"><input type="radio" name="count" value={n} checked={n === 25} /> {n}</label>)}
      </fieldset>
      <label class="tp-group tp-minutes">
        Time in minutes
        <input type="number" name="minutes" min="5" max="180" step="1" inputmode="numeric" value={defaultMinutes(25)} />
      </label>
      <fieldset class="tp-group">
        <legend>Which questions</legend>
        <label class="tp-check"><input type="checkbox" name="skipDone" /> Skip questions I've marked Done</label>
        <label class="tp-check"><input type="checkbox" name="onlyReview" /> Only my Needs review questions</label>
      </fieldset>
      <p class="tp-pool" role="status" data-pool></p>
      <p class="tp-pool-retry" data-pool-retry hidden><button type="button" class="tp-btn">Try again</button></p>
      <button type="submit" class="tp-primary" data-practice-start>Start practice set</button>
    </fieldset>
  </form>
  <noscript><p class="tp-lede">Building a practice set needs JavaScript.</p></noscript>
</section>
```

Then add `<script>import '../../../scripts/practice-form.js';</script>` after the existing script.

**Styles** (`tp-` prefixed, tokens only):
- `.tp-primary` is the filled action: `background: var(--field); color: var(--field-ink)`, hover `var(--field-deep)`, square, Archivo 700, padding `0.7rem 1.25rem`.
- `.tp-fields` and `.tp-group` drop the default fieldset chrome except one hairline top rule per group. Legends are Archivo 700.
- `.tp-subjects`: a list, 2 columns at `min-width: 48rem`, 1 below.
- `.tp-topics summary`: Archivo 600, 0.85rem, `var(--field-text)`. Its list is indented, with one topic per line.
- `.tp-count`: `var(--ink-faint)` meets 4.5:1 on paper in both themes per DESIGN.md. Verify with the detector.
- `.tp-pool`: `min-height: 1.6em`.
- `input[type=number]` and `select`: square, 2px Heavy Rule, `background: var(--paper)`, `color: var(--ink)`.
- `.tp-fields:disabled` stays fully legible: no greying, since it is only a moment before the script runs. `cursor: default`.

- [ ] **Step 4: Write the script**

`site/src/scripts/practice-form.js`:

```js
import { MINUTE, newAttempt } from '../lib/tests/attempt.js';
import { loadTests, putAttempt, saveTests } from '../lib/tests/store.js';
import { parseCatalogue } from '../lib/tests/catalogue.js';
import { defaultMinutes, drawSet, newSeed, setPool } from '../lib/tests/build.js';
import { poolMessage, preselection, readSpec } from '../lib/tests/form.js';
import { canStartTest } from '../lib/tests/access.js';
import { loadState } from '../lib/accounts/progress-store.js';
// A uuid v4 maker; attempts need the same kind of id lists do.
import { newListId as newId } from '../lib/accounts/lists.js';

// The practice-set form on /upsc/test (spec, "Build a practice set"). The
// form is the page's markup; this enables it, counts what matches as the
// student chooses, and starts the set. The catalogue (/upsc/catalogue.json,
// 17 KB gzipped) is fetched only once the form is used.

const CATALOGUE_PATH = '/upsc/catalogue.json';
const FILE_TIMEOUT_MS = 15000;
const NOT_SAVED = 'Your browser would not save the test. Check that it lets this site store data.';

const form = document.querySelector('[data-practice]');
const fields = form.querySelector('[data-practice-fields]');
const poolEl = form.querySelector('[data-pool]');
const retryRow = form.querySelector('[data-pool-retry]');
const startBtn = form.querySelector('[data-practice-start]');
const minutesInput = form.elements.minutes;

let catalogue = null;
let loading = null; // the fetch in flight, if any
let failed = false;
let minutesTouched = false;
let starting = false;

const subjectBoxes = () => [...form.querySelectorAll('input[name=subject]')];
const topicBoxes = () => [...form.querySelectorAll('input[name=topic]')];

function values() {
  const data = new FormData(form);
  return {
    subjects: data.getAll('subject'),
    topics: data.getAll('topic'),
    fromYear: data.get('fromYear'),
    toYear: data.get('toYear'),
    count: data.get('count'),
    minutes: data.get('minutes'),
    skipDone: data.has('skipDone'),
    onlyReview: data.has('onlyReview'),
  };
}

function ensureCatalogue() {
  if (catalogue) return Promise.resolve(true);
  if (loading) return loading;
  failed = false;
  retryRow.hidden = true;
  poolEl.textContent = 'Counting the questions…';
  loading = (async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FILE_TIMEOUT_MS);
    try {
      const response = await fetch(CATALOGUE_PATH, { signal: controller.signal });
      if (!response.ok) throw new Error(String(response.status));
      catalogue = parseCatalogue(await response.json());
      if (!catalogue) throw new Error('not a catalogue');
      update();
      return true;
    } catch {
      failed = true;
      poolEl.textContent = "The question list didn't load. Check your connection, then try again.";
      retryRow.hidden = false;
      return false;
    } finally {
      clearTimeout(timer);
      loading = null;
    }
  })();
  return loading;
}

function update() {
  if (!catalogue) return;
  const spec = readSpec(values(), 0);
  const pool = setPool(spec, catalogue, loadState().entries);
  poolEl.textContent = poolMessage(pool.length, spec.count);
  startBtn.disabled = pool.length === 0;
  if (!minutesTouched) minutesInput.value = String(defaultMinutes(Math.min(spec.count, pool.length || spec.count)));
}

form.addEventListener('change', (event) => {
  const box = event.target;
  if (box.name === 'topic' && box.checked) {
    const subject = subjectBoxes().find((s) => s.dataset.slug === box.dataset.subject);
    if (subject) subject.checked = true;
  }
  if (box.name === 'subject' && !box.checked) {
    for (const t of topicBoxes()) if (t.dataset.subject === box.dataset.slug) t.checked = false;
  }
  update();
});
minutesInput.addEventListener('input', () => {
  minutesTouched = true;
});

// Fetched the first time the form is used, not with the page.
const wake = () => ensureCatalogue();
form.addEventListener('focusin', wake, { once: true });
form.addEventListener('pointerdown', wake, { once: true });
retryRow.querySelector('button').addEventListener('click', () => ensureCatalogue());
window.addEventListener('online', () => {
  if (failed) ensureCatalogue();
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (starting) return;
  starting = true;
  startBtn.disabled = true;
  try {
    if (!(await ensureCatalogue())) return;
    const spec = readSpec(values(), newSeed());
    const pool = setPool(spec, catalogue, loadState().entries);
    if (!pool.length) {
      poolEl.textContent = poolMessage(0, spec.count);
      return;
    }
    if (!(await canStartTest('upsc'))) {
      poolEl.textContent = "Tests aren't open to this account.";
      return;
    }
    const attempt = newAttempt({
      id: newId(),
      kind: 'custom',
      spec,
      keys: drawSet(pool, spec.count, spec.seed),
      limitMs: spec.minutes * MINUTE,
      now: new Date().toISOString(),
    });
    if (!saveTests(putAttempt(loadTests(), attempt))) {
      poolEl.textContent = NOT_SAVED;
      return;
    }
    document.dispatchEvent(new CustomEvent('sawaalbox:test'));
    location.assign(`/upsc/test/take?attempt=${encodeURIComponent(attempt.id)}`);
  } finally {
    starting = false;
    if (catalogue) update();
    else startBtn.disabled = false;
  }
});

// A Practise link: tick what it names, and count at once.
const pre = preselection(location.search);
if (pre.subject) {
  const subject = subjectBoxes().find((s) => s.dataset.slug === pre.subject);
  if (subject) {
    subject.checked = true;
    const topic = pre.topic && topicBoxes().find((t) => t.dataset.subject === pre.subject && t.dataset.slug === pre.topic);
    if (topic) {
      topic.checked = true;
      topic.closest('details').open = true;
    }
    ensureCatalogue();
  }
}

fields.disabled = false;
```

- [ ] **Step 5: Practise links and the product note**

1. In the subject page frontmatter, the subject's slug is `subject.slug`. Inside `<Listing>`, add:

   ```astro
   <p slot="meta" class="practise-line"><a href={`/upsc/test?subject=${subject.slug}#practice`}>Practise this subject</a></p>
   ```

2. In the topic page, after the existing `slot="meta"` paragraph, add:

   ```astro
   <p slot="meta" class="practise-line"><a href={`/upsc/test?subject=${topic.subjectSlug}&topic=${topic.slug}#practice`}>Practise this topic</a></p>
   ```

   Read the frontmatter for the exact names of the subject slug and topic slug variables, since `SUBTOPICS` entries carry `subjectSlug` and `slug`. Style `.practise-line` in each page's scoped style: Archivo 600, 0.9rem, `margin: 0.6rem 0 0`.
3. In `PRODUCT.md`, in the Monetization paragraph, add after the "Undecided" sentence: *"Mock tests (every past paper, and practice sets by subject, topic and year) are live and free during the beta, behind one access check (`canStartTest`) that payments will fill in."*

- [ ] **Step 6: Test, build, check headless**

1. Run `npm test`, `npm run build` and `node scripts/check-links.mjs`. Expected: all pass. Make a WIP commit.
2. Write `scratchpad/capture/t7-form.mjs` (puppeteer-core, 150 s timeout). Check:
   - **Before the form is used:** `/upsc/test` makes no request for `catalogue.json`.
   - **First use:** focusing the first subject box requests it once. The pool line then reads "*N* questions match. The set will have 25.", where *N* is the corpus total minus the 12 unscorable questions (9 cancelled and 3 without an answer), computed in the script from `dist/upsc/catalogue.json`.
   - **Narrowing:**
     - Ticking "Indian Polity" narrows the count.
     - Ticking a topic under Geography also ticks Geography.
     - Unticking Geography unticks the topic.
     - The time follows the count (10 → 12 minutes), until a value is typed into it.
   - **A practice set from a topic page, with the Needs review switch** (the spec's test):
     1. Seed marks with 3 Needs review questions in Indian Polity › Parliament (keys from the catalogue), then open that topic page.
     2. Its **Practise this topic** link lands on `/upsc/test?subject=indian-polity&topic=parliament#practice` (use the real slugs), with both boxes ticked and the topic's details open.
     3. Turning on *Only my Needs review questions* reads "Only 3 questions match: the set will have all 3."
     4. **Start practice set** lands on the take page with "Question 1 of 3" and a clock of `0:0x:xx` for `defaultMinutes(3)` = 5 minutes.
     5. Storage has a `custom` attempt whose keys are exactly the 3 marked.
   - **Empty pool:** turning on both switches with nothing marked gives "No questions match. Widen the filters." and a disabled Start.
   - **Same seed, same draw:** `drawSet` with the stored seed and the rebuilt pool gives the stored keys. Check by evaluating the module logic against the stored attempt in node, using the same catalogue file.
   - **A slow catalogue** (intercept with a 20 s delay): after 15 s the error line and **Try again** show; after release, Try again counts.
   - **Without JavaScript:** the form shows disabled, with its `<noscript>` line.
   - **CLS** is 0 at 360, 390 and 1280, light and dark, including after the pool line fills.
   - **Screenshots:** the form at 390 and 1280, light and dark.
3. Run the detector on `upsc/test/index.astro`, the subject page and the topic page. Expected: `[]`.

- [ ] **Step 7: Commit**

```bash
git add site/src/lib/tests/form.js site/tests/mock-form.test.js site/src/scripts/practice-form.js site/src/pages/upsc/test/index.astro "site/src/pages/upsc/subject/[slug]/[...page].astro" "site/src/pages/upsc/topic/[subject]/[topic]/[...page].astro" PRODUCT.md
git commit -m "feat(tests): practice-set form with live counts; Practise links on subject and topic pages"
```

---

## After the last task

- **Whole-branch checks** from `site/`:
  - `npm test`, `npm run build` and `node scripts/check-links.mjs`;
  - the detector over every `.astro` file this branch touched;
  - a sizes check: `/upsc/test` HTML weight, the take page's JS chunk sizes, and that question pages load no new script. Compare `dist/upsc/question/*.html` script tags with the base build.
- **Owner hand-over:**
  - Copy the migration to the clipboard: `Get-Content -Raw -Encoding UTF8 supabase/migrations/20261011120000_test_attempts.sql | Set-Clipboard`. The owner runs it in the Supabase SQL editor.
  - Then copy `supabase/tests/rls_test.sql` the same way and have the owner run it. Expected result: `All RLS checks passed`.
  - Until the table exists, signed-in syncs log "will retry syncing tests" and attempts stay on the device, so nothing is lost.
- **Publishing** needs the owner's OK: `git push origin mock-tests:master`, a fast-forward.
