---
version: 1
slug: "site-src-pages-index-astro"
primary_target: "site/src/pages/index.astro"
related_targets: []
---

## Scope

The SawaalBox homepage at `/`. Visitor mode: **Persuade**. This page introduces the product across exams; the UPSC booklet cover that used to sit at `/` moves to `/upsc` unchanged and keeps its own brief (`frontend`). Inherits the established Question Paper world — no new palette, type or material.

Audience: aspirants arriving from search or a shared link, most on a phone over mobile data, many returning daily to search. Job: understand what this is and get to questions fast. Primary action: open an exam's booklet. Search lives inside each exam (`/upsc/search`), not on this page (owner's decision, 2026-10-02): an aspirant wants their own exam's questions, and a neutral-looking box that only searched one exam would mislead. The old `/search` address forwards to `/upsc/search` with its query. Once accounts ship, a "Create free account" action joins as secondary, never primary.

Content rules: no testimonials, user counts, logos or endorsements — none exist. No exam other than UPSC is named. Features are split into live now and coming in the beta, and every coming item is visibly marked so. Proof comes from the product itself.

Exam neutrality (owner's decision, 2026-10-02): the page belongs to every exam, so its title, headline and feature list speak for none. UPSC appears only where it is a fact about the first exam: its booklet on the rack, once in the meta description as the first exam open, the specimen's own label, and the source credit. UPSC keyword traffic is `/upsc`'s job, not this page's. The footer is driven by the exam registry (`site/src/lib/exams.js`): one link and one source credit per exam.

## Direction contract

**THESIS:** Each exam is its own booklet and the homepage is the rack they sit in: UPSC's open and live, the next one sealed. It refuses the edtech marketing page — no indigo hero, no row of rounded feature cards, no smiling student, no invented social proof.

**OWN-WORLD:** The established Question Paper world, unchanged: exam-stationery ground, committed institutional green owning masthead and colophon, offset ink, exam red only for stamps and seals, Archivo / Literata / Courier Prime. New parts drawn from the same object: booklet covers standing on a rack with printed series codes and serial-numeral counts, a sealed cover banded by a paper seal, and a booklet contents page with numbered entries and dotted leaders.

**STORY:** In seconds the visitor sees every past question of an exam, searchable by idea. They believe it because a real question is shown whose own wording never uses the words they searched — one a text search of the paper would miss. Its topic label stays visible, so why it was found is never hidden. They search, or open the UPSC booklet, and understand more exams are coming without being promised any.

**FIRST VIEWPORT:** Green masthead with wordmark and an exam-neutral line. Directly beneath, the rack: the UPSC cover dominant at roughly three-fifths width, carrying series code, title, 3,959 / 1995–2026 / 13 subjects in serial numerals and a filled Open the booklet control to `/upsc` — the primary action; beside it one sealed cover marked more exams in preparation, visibly sealed and not a link.

**FORM:** Booklet Rack — candidate 3 of my ordered structural list, dealt by the roll (whose lead was candidate 4, Registration Counter) and chosen by the user. Seed key a159a7b3. Code-led. Persuade mode requires demonstrating the mechanism, so the page carries a proof section drawn from candidate 1 (Live Specimen): the real 2021 Dholavira question returned for "Indus Valley civilisation". Copy claims only what is true: the question's wording never names the civilisation. It does not claim the search understood the site, because the question's topic label is part of what is indexed. Signature interaction: the open cover lifts slightly at its spine on hover and focus, showing the first page's edge; the sealed cover never moves. Honest risk: one sealed cover reads as a promise; adding a second before a second exam exists would make the rack look mostly shut.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- Whether signed-in students skip this page for a dashboard, once accounts exist.
- The pricing section Razorpay requires lives on the marketing side, but waits for a price.
- Whether a cross-exam search is ever wanted once a second exam opens; per-exam search is the default.
