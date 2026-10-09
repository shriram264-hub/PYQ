# Mock tests: design

Date: 2026-10-11
Status: Approved in conversation (start, take, results and sync, each section approved by the owner). This spec is for the owner's review.

## Where this fits

Part 2 of the first paid bundle splits into four projects, built in this order (owner, 2026-10-11):

1. **Mock tests** (this spec).
2. **Analytics**: accuracy by subject and topic. Built on the attempts stored here.
3. **Payments**: Razorpay, per-exam passes, upgrade prompt.
4. **Learn more**: per-question explanations from open material.

Mock tests and analytics launch **free during the beta**; the Terms already say features may later need a paid pass. Reading and searching past questions stays free for good (PRODUCT.md, principle 3).

## Decisions (owner, 2026-10-11)

| Question | Decision |
|---|---|
| Kinds of test | Full past papers **and** custom practice sets |
| Test screen | One question at a time, with a question grid |
| Scoring | Today's UPSC rules for every test: +2 right, −⅔ wrong, 0 blank. Cancelled questions are not scored |
| Access | Anyone can take tests. Attempts are kept on the device and sync to the account when signed in |
| Leaving mid-test | Answers are saved as given. The test resumes where it was left. The clock counts only time spent on the test |
| Where tests run | In the browser, from the per-year question files the site already builds |

## 1. Starting a test

**Routes:**
- `/upsc/test` is the **Practice tests** page. It is indexable and in the sitemap, and its content is server-rendered: the list of past papers, with an introduction.
- `/upsc/test/take?attempt=<id>` is the test screen.
- `/upsc/test/result?attempt=<id>` is the results page.
- Both of these are `noindex` and not in the sitemap. Like /revise, they need JavaScript and carry a `<noscript>` line.

**Links in:**
- "Tests" joins the UPSC nav, after Search: *Subjects · Years · Search · Tests*.
- Each year page gets **Sit this paper**. Each subject and topic page gets **Practise this topic**, which opens the practice-set form with that subject or topic preselected.
- The homepage moves "Sit a full year's paper" from Coming to Available, worded as free during the beta.

**Sit a past paper.**
- Every year from 1995 to 2026 is listed, newest first, with its question count and the 2-hour limit.
- A paper's questions are all of that year's questions except those UPSC cancelled, in question-number order.
- If the corpus lacks numbers between 1 and the year's highest question number, the paper says so plainly. Example: *"98 of 100 questions: 2 aren't in our copy"*. Cancelled questions are noted separately: *"1 question cancelled by UPSC is left out"*.
- The time limit is 120 minutes for every full paper, which is UPSC's GS Paper I duration.

**Build a practice set.**
- **Choices:**
  - one or more subjects, and optionally topics within them;
  - a year range (default all years);
  - number of questions: 10, 25, 50 or 100;
  - time: default `ceil(1.2 × n)` minutes, editable from 5 to 180.
- **Switches:**
  - *Skip questions I've marked Done*
  - *Only my Needs review questions*. When on, subject and topic filters still apply.
- **Picking questions:**
  - The pool is the questions matching the filters, minus cancelled ones and minus those excluded by the switches.
  - Questions are picked uniformly at random without repeats. The draw is reproducible from a seed stored with the attempt.
  - If the pool is smaller than requested, all of it is used and the page says so. An empty pool shows *"No questions match. Widen the filters."*
- **Catalogue:**
  - The form and the picking use a small catalogue file, `/upsc/catalogue.json`, mapping each question key to `[subject, topic, year, status]`. Target size is about 25 KB gzip; record the measured size.
  - Full question content for the chosen keys comes from the existing `/upsc/full/{year}.json` files, fetched only for the years needed. Use the /revise loader pattern: a 15 s timeout, retry when the device comes back online, and a "Try again" button.

**Carry on.** Unfinished attempts are listed with progress, e.g. *"2019 paper: 34 of 100 answered"*, each with **Resume** and **Abandon**.

**Past results.** Submitted attempts are listed, newest first: name, date, score, and a link to the results page.

**Disputed questions** stay in the test and are scored against the official answer. They are flagged in the review.

**Future upgrade check.**
- Starting any test goes through one function, `canStartTest(exam)` in `site/src/lib/tests/access.js`. It returns true during the beta.
- Part 3 replaces its body with the entitlement check. No other code may gate tests.

## 2. Taking a test

- **Screen.** One question at a time:
  - **Top bar:** the paper or set name, *"Question 14 of 100"*, and the countdown (h:mm:ss).
  - **Question:** the question text, then options (a) to (d) as a native radio group.
  - **Actions:** **Clear answer**, **Mark for review**, **Previous** and **Next**.
  - **Question grid:** a disclosure on phones, a sidebar on wide screens. Each number shows *answered*, *marked for review* or *not answered* by shape and visible label, never colour alone. A number can be both answered and marked for review. Tapping one jumps to that question.
- **Saving:**
  - Every change is written to device storage immediately: answer, clear, mark, and moving between questions (the current index).
  - Elapsed time is saved at least every 5 s while running, and on `pagehide` / `visibilitychange`.
- **Clock:**
  - The clock counts only while the test page is visible.
  - While `document.visibilityState === 'hidden'`, or after the page is closed, time does not accrue.
  - On return the test resumes at the saved question with the saved remaining time.
- **Finishing:**
  - **Submit** opens a confirmation summary: answered, marked for review, not answered. It offers *Submit now* and *Keep going*.
  - When remaining time reaches zero, the attempt submits itself and goes to results.
  - Answers and correctness are never shown before submission.
- **Keyboard:**
  - A–D or 1–4 choose an option.
  - ← / → move between questions.
  - The keys work only while focus isn't in a text field.
- **Screen readers:**
  - Question changes are announced: *"Question 14 of 100"*.
  - Remaining time is announced at 15, 5 and 1 minutes left, not every tick.
  - The radio group has the question as its accessible name.
- **Abandon:**
  - An unfinished attempt can be abandoned from the test screen or the Practice tests page, after a confirmation.
  - An abandoned attempt keeps its data, leaves the "carry on" list, and never counts in results or analytics.
  - Attempts are never deleted.

## 3. Results, history and sync

**Results page:**
- **Score:**
  - Score = 2 × right − ⅔ × wrong, out of 2 × the number of scored questions, shown to two decimals.
  - Also shown: right, wrong and not-answered counts, accuracy (right ÷ answered), and time used.
  - Example: *"Score 112.67 / 200 · 64 right · 18 wrong · 18 not answered · 1 h 48 m"*.
- **By subject:** right, wrong and blank per subject, A–Z.
- **Review:**
  - Every question appears in test order, shown as on question pages: text, options, official answer revealed, and the student's answer marked right, wrong or not answered.
  - Disputed answers are flagged.
  - Filters: *All · Wrong · Not answered · Marked for review*.
  - Each question carries the existing Mark done / Needs review / Save to list controls, from marks.js and save-to-list.js, as one module instance.
- **History:** past results on `/upsc/test`, and a "Practice tests" link with the latest score on /account.

**Attempt record**, on the device under `sawaalbox-tests-v1` and in the account:

```
{ id: uuid,                      // client-generated, stable
  exam: 'upsc',
  kind: 'paper' | 'custom',
  spec: { year } | { subjects, topics, fromYear, toYear, count, minutes, skipDone, onlyReview, seed },
  keys: string[],                // question keys in test order (≤ 150)
  answers: { [key]: 'a'|'b'|'c'|'d' },
  review: string[],              // keys marked for review
  current: number,               // index of the question on screen
  limitMs: number, elapsedMs: number,
  status: 'in_progress' | 'submitted' | 'abandoned',
  startedAt, updatedAt, submittedAt: ISO | null,
  result: null | { scored, right, wrong, blank, score, max } }   // computed at submit, stored for history
```

`parseTests` validates storage like `parseState`: bad shapes are dropped and nothing throws. The device keeps the 200 most recent attempts; older submitted ones remain in the account.

**Account table** `public.test_attempts`, applied by the owner as a migration with an extended RLS test:
- **Columns:**
  - `id uuid primary key` (client id)
  - `user_id uuid not null default auth.uid() references auth.users on delete cascade`
  - `exam text not null`
  - `kind text not null check (kind in ('paper','custom'))`
  - `spec jsonb not null`
  - `question_keys text[] not null check (cardinality(question_keys) between 1 and 150)`
  - `answers jsonb not null`
  - `review_keys text[] not null`
  - `current_index int not null`
  - `limit_ms int not null`
  - `elapsed_ms int not null check (elapsed_ms >= 0)`
  - `status text not null check (status in ('in_progress','submitted','abandoned'))`
  - `started_at timestamptz not null`
  - `updated_at timestamptz not null`
  - `submitted_at timestamptz`
  - `result jsonb`
- **Row-level security:** owner-only for select, insert and update. There is **no delete grant**. `anon` is revoked.

**Sync** happens inside the existing single-flight run, after progress and lists, with the same full and targeted pull pattern and its own pull marker:
- **Merge per attempt id:**
  - If either copy is submitted, the submitted copy wins. If both are, the earlier `submittedAt` wins and ties go to the account.
  - Otherwise the later `updatedAt` wins and ties go to the account.
  - Abandoned is a normal update.
- **Uploads:** attempts this device changed since its last sync, as upserts. There are no deletes.
- **Settle:** changes made during a run, such as answers given while the request was in flight, are kept for the next run, as for lists.
- **New account on this browser:** the owner rebase (`rebaseForNewAccount`) drops synced attempts from the previous account and keeps never-synced ones, as for marks.
- **Full pull:** `/upsc/test` forces a full pull when signed in, as /account does.

## Global constraints

- **Design.** `DESIGN.md`: tokens only, square corners, no Unicode glyph icons, contrast ≥ 4.5:1 in both themes, and one filled-green action per page. On the test screen that action is **Submit**.
- **No layout shift.** Nothing injected or loaded after first paint may shift the layout: test chrome, grid, question changes, results.
- **Page weight.** Question pages load nothing new. The test screen loads the catalogue only for custom sets, plus only the needed year files.
- **No supabase-js upfront.** supabase-js is never in the initial bundle and loads only as it does today.
- **Text rendering.** Everything from storage, the catalogue or the year files is rendered via `textContent` or the shared escaper. The review uses the shared `questionHTML`.
- **Progressive enhancement.** `/upsc/test` lists papers without JavaScript. The test and results pages carry `<noscript>`.
- **Checks.** `npm test`, the build and `check-links` pass, and the detector reports `[]`.
- **No real accounts on the hosted project** in tests.

## Testing

**Unit tests (pure):**
- scoring, including the ⅔ penalty, rounding and scored count;
- paper building: cancelled questions excluded, missing-numbers note, order;
- practice-set building: filters, switches, small pool, empty pool, seed reproducibility;
- the time-limit default;
- `parseTests`;
- attempt merge: submitted beats in-progress, earlier submit wins, `updatedAt` ties, abandoned;
- settle with mid-run changes;
- rebase.

**Sync tests** use the existing fake Supabase client, extended for `test_attempts`. They cover:
- upload;
- pull from another device;
- submitted versus in-progress on two devices;
- offline then online;
- a new account on a shared browser.

**RLS test** (`supabase/tests`): a second user cannot read or update the owner's attempts, nobody can delete, and `anon` is refused.

**Headless browser checks** on the production build:
- **A full paper:**
  - answer, mark and clear;
  - leave and return with the clock paused, both by hiding the tab and by reloading;
  - resume at the same question and time;
  - auto-submit at zero;
  - results and review filters.
- **A practice set:** from a topic page, using the Needs review switch.
- **Abandon.**
- **Keyboard only.**
- **Screen-reader names and announcements.**
- **CLS** at 360, 390 and 1280 px, in light and dark themes.
- **Screenshots.**

## Non-goals

- Analytics beyond the per-subject table on the results page; that is project 2.
- Payments or gating, beyond the `canStartTest` hook.
- Explanations; that is project 4.
- Leaderboards, sharing results, timed sections, CSAT Paper II, and question-level time tracking.
- Server-side scoring or protecting answers. Answers are already public on question pages.
