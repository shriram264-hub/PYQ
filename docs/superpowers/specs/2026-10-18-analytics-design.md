# Analytics: design

Date: 2026-10-18
Status: Described and agreed in conversation with the owner on 2026-10-18 ("nothing missing, write the spec and build this"). This document is for the owner's review before planning.

## Where this fits

This is part 2, project B, of the first paid bundle. The agreed order is:
1. A: mock tests (live since 2026-10-17).
2. **B: analytics (this document).**
3. D: payments.
4. C: "Learn more".

Like tests, analytics launches **free during the beta** and later sits behind the same per-exam pass. Reading and searching past questions stays free for good (PRODUCT.md, principle 3).

## Intent

A student who has taken some practice tests, or worked through questions while browsing, should be able to see how they are doing and what to study next. The owner's words: "their performance so far, areas to improve, and similar aspects".

Every number should lead somewhere useful: practise a weak subject or topic, or revise the questions answered wrongly. A number with nothing to do about it is decoration.

**Every exam, not just UPSC.** The owner will add other exams (SSC and others, not yet chosen). Analytics must work for any exam the site serves without being rewritten. Today UPSC is the only exam, but nothing in analytics may assume UPSC. The rules it depends on come from one per-exam settings source:
- marks for a right and a wrong answer;
- how many options a question has;
- the exam's subjects and topics, from its data.

Making everything *already built* exam-neutral (search, booklet pages, tests, sync, legal pages) is a **separate project** the owner wants. Analytics must not wait for it, and must not make it harder.

## What the student sees

### 1. The "Your analytics" page: `/upsc/analytics`

One per exam, at `/{exam}/analytics`. It shows this device's data, which when signed in includes the account's data from every device through sync. Like /account, it is not indexed and not in the sitemap. Top to bottom:

1. **Four headline numbers**
   - **Latest paper:** the score of the most recently submitted full past paper, out of its maximum, and the change from the paper submitted before it. If there is no full paper yet, this cell says so and links to the papers list.
   - **Accuracy:** right ÷ answered, over every scored answer in every submitted test.
   - **Left blank:** blank ÷ scored questions, over every submitted test.
   - **Lost to wrong answers:** the marks the negative marking took, i.e. wrong answers × the exam's penalty, over every submitted test.
2. **Full papers over time.** Each submitted full past paper, oldest to newest, as score out of maximum.
   - Plot it as a percentage of the maximum, labelled with the real score: UPSC papers before 2011 had 150 questions, so their maximum is 300, not 200.
   - Practice sets are not on this chart; their sizes differ.
   - With fewer than two papers, show the single point or a short note instead of a line.
3. **By subject, weakest first.** One row per subject the student has any data in, with:
   - **accuracy** (right ÷ answered);
   - **answered** (how many scored answers);
   - **net marks** (by the exam's marking);
   - **coverage**, e.g. "120 of 422";
   - a **Practise** link to the practice-set form with that subject preselected.

   "Weakest first" means lowest accuracy first, among subjects with at least 5 answered. Subjects with fewer answers come after them, with their accuracy shown but marked as few answers. Subjects with coverage but no answers come last.
4. **Topics to work on.** The three lowest-accuracy topics among topics with **at least 5 answered**, each with "*n* of *m* right" and **Practise this topic**. If no topic has 5 answered yet, say so briefly instead.
5. **Questions you got wrong.** A count and one action, **Revise them**. This opens the existing Revise page in a new "wrong answers" mode (see "Revise wrong answers" below).

**Empty states:**
- With no submitted tests, the page explains in one or two lines that analytics fills in as they take tests. It links to the Tests page, and still shows coverage if they have Done marks.
- With nothing at all, it shows only that explanation and the link.

### 2. A line on subject and topic pages

Each subject page and each topic page (all their paginated pages) gets one line about this student, near the existing **Practise** link:
- *"Your accuracy here: 48% (25 answered) · Covered 60 of 422"* when they have answers in it.
- *"Covered 12 of 422"* when they have only coverage.
- **Nothing** when they have no data for it.

For a student with fewer than 5 answers in that subject or topic, the line shows the numbers but must not read as a verdict. For example, "2 of 3 right so far" rather than "67% accuracy".

**When the line's space is held.** A page only knows whether this student has data for this subject once it has read the catalogue, so a line drawn later would shift the page. *(My call.)*
- **Room is held** for one line whenever this device holds any test attempt or any mark at first paint.
  - If the student has nothing for this subject or topic, that room stays empty.
  - It is never filled with placeholder text.
- **No room is held** for a visitor with no attempts and no marks on this device, so most search visitors see the page exactly as today.
- A sync that brings data in later, as for a signed-in student on a new device, may fill a line already held. Where no line was held, nothing is drawn until the next visit.

### 3. Links in

The owner found tests hard to find at first, so analytics must be easy to reach. **Your analytics** is linked from:
- the Practice tests page (`/upsc/test`);
- every results page;
- the Practice tests panel on the UPSC front page;
- the Practice tests section on /account (My progress).

It does not get its own top-navigation item.

### Revise wrong answers

The Revise page (`/revise`, today `?list=<id>` or `?review`) gains a mode for the questions the student got wrong. A question is in it when **its latest submitted answer was wrong**. If they later answered it right in another test, it leaves. The newest wrong answers come first. It behaves like the existing modes: questions in full, the Mark done, Needs review and Save to list controls, and 20 at a time.

## Definitions

These are the rules the numbers follow. Where a rule was my call rather than the owner's, it says so.

- **Submitted tests only.** Unfinished and abandoned attempts never count, as for test history today.
- **Scored answers.**
  - A question with no official answer (cancelled, or disputed without one) is never counted in accuracy, blank, wrong or net marks, as in test scoring today.
  - Disputed questions with an official answer are scored against it, as in tests.
- **Accuracy counts every answer** in every submitted test. A question answered in two tests counts twice. *(My call: it reflects performance over time, and matches how test results already count.)*
- **"Got wrong" uses the latest answer per question**, so the revise pile shrinks as the student improves. *(My call.)*
- **Coverage** is the number of distinct questions in that subject or topic that the student has either answered in a submitted test, or marked **Done** or **Needs review** while browsing, out of all the questions in that subject or topic.
  - Done counts: the owner's decision.
  - Needs review counts: my call, since the student has read the question.
  - The denominator is every question the site lists in that subject or topic, cancelled ones included, because those pages list them too. *(My call.)*
- **Subject and topic of a question** are those the site's data files it under, the same as on its question page.
- **Thresholds:** "at least 5 answered" for ranking weakest subjects and topics, and for showing a bare percentage. *(My call, to stop one guess reading as a verdict. Keep it one named setting.)*
- **The device's 200 tests.** The device keeps its 200 most recently changed attempts (`MAX_ATTEMPTS` in `site/src/lib/tests/store.js`). Older ones remain only in the account. Analytics covers the attempts on the device. *(My call: it keeps "nothing new on a server" and needs no change to storage or sync.)*
  - The cap is reached only after 200 attempts.
  - Once it is, the page says that it covers the latest 200 tests.
  - "Latest paper" and the chart then work from those.
- **Leaving the wrong-answers pile.** A question is in the pile when its **last actual answer**, across submitted tests, was wrong, **and** it has not been marked **Done** since that test was submitted. *(My call.)*
  - Leaving it blank in a later test does not clear it: skipping isn't improving.
  - Marking it Done does clear it, as Done clears the Needs review pile today. A student who revises the pile and marks each question Done sees the pile shrink.
  - Answering it wrong again in a later test puts it back.
  - The count on the analytics page and the list on Revise use the same rule, read from the same moment.

## Constraints

- **Everything is computed in the browser** from this device's stored attempts and marks, which sync already brings from the account when signed in. There is no new server, no new database table and no server-side computation on student data.
- **Signed out, it works on this device. Signed in, it covers every device**, by the existing sync of attempts and marks. The analytics page should ask for a full pull when signed in, as /account and /upsc/test do. *(The planned per-step full-pull follow-up may refine this; don't block on it.)*
- **Exam-neutral.**
  - All UPSC-specific numbers come from one per-exam settings source: marks per right and wrong answer, options per question, and anything else analytics needs.
  - That source must be one tests' scoring can also use, so a second exam needs its settings written once.
  - Moving tests' existing scoring onto it is **allowed and preferred** if it is a small change, but not required.
  - Paths are `/{exam}/…`. Nothing in the analytics code names UPSC except the settings entry and the route files.
- **Paid later, free now.** Viewing analytics goes through one access check, next to `canStartTest` in `site/src/lib/tests/access.js`. It returns true during the beta. Payments will replace its body with the per-exam pass check, and nothing else may gate analytics.
- **Page weight.**
  - Question pages load nothing new.
  - Subject and topic pages load nothing new for a visitor with no tests and no marks on this device.
  - For a student with data, those pages may fetch at most the question catalogue (`/upsc/catalogue.json`, about 17 KB gzipped, cached by the browser), or something no bigger. They may not fetch every year's question file.
  - To know right from wrong without the year files, the catalogue may carry each question's official answer. This is allowed, and is my call: answers are already public on every question page, and it adds a few KB.
- **No layout shift.** Nothing drawn after first paint may move what the reader can already see, on the analytics page or on subject and topic pages, at 360, 390 and 1280 px, in light and dark. On subject and topic pages this matters most, because most visitors there have no data.
- **Design.** Follow DESIGN.md:
  - tokens only and square corners;
  - no Unicode glyph icons;
  - contrast of at least 4.5:1 in both themes;
  - exactly one filled-green action per page.

  The chart and bars use tokens. Colour is never the only signal: numbers are always written out.
- **Text rendering.** Everything from storage or fetched files is rendered via `textContent` or the shared escaper.
- **Progressive enhancement.** The analytics page carries a `<noscript>` line. Subject and topic pages are unchanged without JavaScript.
- **Accessibility.** The chart has a text equivalent (a list or table of the same scores). Headline numbers and rows read sensibly to a screen reader.
- **Privacy.** Analytics stores nothing new and sends nothing anywhere: it reads what tests and marks already store. The privacy policy needs no change. The builder confirms this holds, and flags it to the owner if it doesn't.
- **Checks.** `npm test`, the build and check-links pass, and the design detector reports `[]` on changed pages.

## Testing

- **Unit tests** cover every pure rule:
  - the four headline numbers;
  - per-subject and per-topic accuracy, net marks and coverage;
  - weakest-first ordering with the threshold;
  - topics to work on;
  - the latest-answer-per-question wrong pile;
  - unscored questions excluded;
  - abandoned and unfinished tests excluded;
  - the per-exam settings drive the marks: a test exam with different marking gives different net marks.
- **Headless browser checks** on the production build:
  - the analytics page with seeded tests and marks, and its empty states;
  - subject and topic lines for a student with data, few answers, coverage only, and no data, the last showing nothing and fetching nothing;
  - the Revise wrong-answers mode;
  - the links in;
  - CLS at 360, 390 and 1280, light and dark;
  - screenshots.

## Non-goals

- Time per question: tests don't record it.
- Comparison with other students, percentiles or rank. These would need a server computing over everyone's data.
- Predicting cut-offs or "your chance of clearing".
- CSAT (Paper II).
- Exporting or sharing analytics.
- Charts beyond the one score line and simple bars.
- Making the already-built features exam-neutral. That is the owner's separate project, done next or alongside.

## Anti-goals

- **A false verdict from tiny samples**, e.g. "0% in Ancient History" after one wrong answer.
- **Making subject and topic pages heavier or jumpier** for the many visitors who have no data.
- **Anything that needs student data on a server** beyond what sync already holds.
- **Hard-wiring UPSC** in a way the second exam would have to undo.

## Left to the builder

- **Exact layout and wording** within DESIGN.md. Follow the agreed mockup's order: headline numbers, papers over time, subjects, topics, wrong answers.
- **The shape and file location** of the per-exam settings source, and whether tests' scoring moves onto it now.
- **How subject and topic pages get the data they need**, within the page-weight and layout-shift limits. Options include reading the catalogue, or a per-page key list.
- **How the catalogue grows to include official answers** (if used), keeping it parsed and validated as today.
- **The chart's drawing:** SVG is fine, with no chart library.
- **The name of the access-check function.**
