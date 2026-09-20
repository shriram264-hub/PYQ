# Product roadmap — paid tier and multi-exam

Planning only. Nothing here is built, and nothing here is committed to.

Binding constraint from `PRODUCT.md` (Principle 3): **the corpus stays free and
ungated.** Search, browse and official answers are never behind a paywall. Paid
features must add something alongside the corpus, never toll access to it. This
rules out the obvious lever (capping free searches) on purpose — it would make
us a worse version of the free tools we're competing with.

---

## Part 1 — Paid tier

### Free forever

Full-corpus concept search, browse by subject / year / topic, official answers,
cancelled and disputed flags, browser-local "seen" progress.

### Paid candidates, ranked by value to an aspirant

**1. Answer explanations — the flagship, and the riskiest**

Why the right option is right and, more importantly, why each distractor is
wrong. This is the single biggest gap in the corpus today and the most common
reason aspirants pay for question banks at all.

Honest risks, which shape how this must be built:
- 3,959 explanations is a real content cost. Generating them with an LLM is
  cheap to do badly and expensive to do well.
- A wrong explanation in exam prep is worse than no explanation: it teaches the
  error and destroys trust permanently.
- Mitigations: start with the highest-frequency topics rather than all 3,959;
  label AI-assisted explanations honestly; give users a one-tap "this looks
  wrong" report and act on it; never present an unreviewed explanation as
  authoritative.

**2. Accounts and cross-device sync** — the foundation everything else needs.
Bookmarks, progress and notes that survive clearing a browser and follow the
user from phone to laptop. Low glamour, high necessity.

**3. Bookmarks and custom question sets** — save questions, group them into
named revision lists ("Polity — weak areas"), reorder, and revise from them.

**4. Practice mode / timed tests** — generate a paper from filters (100
questions, Polity, 2015–2026, 120 minutes), answer OMR-style, score at the end.
This fits the existing design world exactly: it *is* a question paper.

**5. Attempt history and weak-area analytics** — which subtopics they actually
get wrong, and the trend over time. Only possible once attempts happen in-app,
so it depends on (4).

**6. Spaced repetition** — resurface missed questions at widening intervals.
Strong retention value over a months-long preparation cycle.

**7. Personal notes per question** — annotate in their own words.

**8. Export to PDF** — a custom set formatted for print. This audience still
studies on paper, and offline access matters on mobile data.

**9. Frequency and trend analysis** — "this subtopic appeared 14 times in 32
years, last in 2024." Shallow cuts belong in the free pages (they make good
indexable content); deeper per-topic analysis can sit in paid.

### Suggested split

- **Free:** corpus, search, browse, answers, local progress
- **Paid:** explanations, sync, bookmarks/sets, practice tests, analytics,
  spaced repetition, notes, export

### Build order (each step unlocks the next)

1. Accounts (auth + database) — nothing else is possible without it
2. Bookmarks and sets — cheapest real value once accounts exist
3. Practice mode — highest engagement, reuses the corpus with no new content
4. Analytics — falls out of practice mode almost for free
5. Explanations — highest value but highest cost and risk; start narrow
6. Spaced repetition, notes, export

### Open questions

- **Price.** This audience is price-sensitive (often studying full-time without
  income). I have not researched current Indian exam-prep pricing and will not
  guess at numbers here.
- **Infrastructure cost.** Accounts and a database mean the free-tier hosting
  that currently costs nothing stops being sufficient. Model this before
  committing to a price.
- Whether a free account tier (sync but no explanations) sits between anonymous
  and paid.

---

## Part 2 — Multi-exam

### The decision that cannot wait

URL structure must be settled **before** stage 2 generates ~4,100 pages.
Retrofitting an exam segment later means 4,100 redirects and lost ranking.

**Recommended: path-based, exam first.**

```
sawaalbox.com/                      exam chooser (hub)
sawaalbox.com/upsc                  UPSC booklet cover (today's landing page)
sawaalbox.com/upsc/subject/geography
sawaalbox.com/upsc/year/2024
sawaalbox.com/upsc/question/<slug>
sawaalbox.com/ssc/...               later, same shape
```

Why this over the alternatives:
- One domain accumulates search authority, rather than splitting it across
  subdomains that each have to earn ranking from zero.
- Clean crawlable hierarchy; breadcrumbs and sitemaps fall out naturally.
- Adding an exam is additive — no existing URL changes, ever.

Rejected: `upsc.sawaalbox.com` (splits authority, more DNS and deploy
complexity); `?exam=upsc` query facets (weak for indexing).

**Cost of adopting it now: effectively zero** — one path segment while only one
exam exists.

### How the design world absorbs other exams

The Question Paper direction accommodates this without invention: a different
exam is simply a different paper. Each exam gets its own booklet cover with its
own masthead and series code, inside the same document system. The hub page
becomes a rack of booklets.

### Data model changes needed

- `questions.json` gains an `exam` field (today it is implicit).
- `corpus.js` partitions by exam before deriving subjects, years and subtopics.
- Subject canonicalisation becomes **per exam** — UPSC's subject taxonomy is not
  SSC's, so the alias map cannot stay global.
- The existing extraction pipeline (`data/scripts/`) must tag its output with
  the exam it came from. This connects to Backlog 1 (ingestion): whatever
  staging format that work lands on should carry `exam` from day one.

### Naming already accounts for this

"SawaalBox" was deliberately chosen exam-neutral (no "UPSC", no "PYQ"), so
adding exams needs no rebrand. Page titles carry the exam keyword instead,
which is where search relevance actually comes from.
