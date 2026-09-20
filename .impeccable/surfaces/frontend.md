---
version: 1
slug: "frontend"
primary_target: "frontend"
related_targets: []
---

## Scope

SawaalBox marketing + corpus front door (landing page), and the page system it establishes for ~4,000 generated pages (subjects, years, subtopics, individual questions). Visitor mode: **Persuade** for the landing page; the search and question pages it hands off to are **Operate** and **Read** and inherit this world without inheriting its energy.

Audience: Indian UPSC Prelims aspirants, self-studying, usually on a mid-range phone on mobile data, often late at night. Job: find how the exam has actually asked about a topic they just studied. Action: type a concept and get ranked real questions, or browse into a subject/year. Proof on hand: 3,959 genuine questions, 1995–2026, with official answers and cancelled/disputed flags. No users, testimonials, traffic or endorsements exist — none may be implied.

Constraints: backend is a 512MB free-tier instance that sleeps when idle, so the landing page must be fully static and never block on the API; pagination is broken today and is committed scope; progress is browser-local only.

## Direction contract

**THESIS:** The site is the examination booklet itself — a working document you can search — not a marketing page about a question bank. It refuses the category arrangement outright: no indigo hero, no rounded feature trio, no smiling-student illustration, no "Start Learning Free".

**OWN-WORLD:** Pale exam-stationery ground (#E6EAE3) with paper plates (#F4F6F1), offset ink (#14181A), and deep institutional green (#0F3D2E) committed at page scale — owning the masthead block, series boxes and footer as fields, never sprinkled as accent. Exam red (#C8102E) only where real papers use it: serial stamps, answer keys. Components are document parts: ruled instruction boxes, registration-grid boxes, heavy Series letter codes, serially numbered question blocks, hairline rules. Archivo (and Archivo Black) for structure and labels; Literata for question bodies at reading measure; Courier Prime for serial and registration numerals only.

**STORY:** The visitor understands in seconds that this is the complete record of what UPSC has actually asked — 3,959 questions, 1995–2026, free, no sign-up. They believe it because the page behaves like the document they already know and its figures reconcile against each other. They type a concept into the instruction block and get ranked real questions.

**FIRST VIEWPORT:** A booklet cover at full width. Top: ruled masthead in committed green carrying SawaalBox and a bilingual authority line. Optical centre: the INSTRUCTIONS box with its rules intact and its body replaced by the live search field at large scale — the primary action. Beside it: a registration-grid box of true corpus figures (3,959 / 32 years / 13 subjects) that reconcile to the total. Below the fold rule: serially numbered subject rows as the question index, each a real link carrying its count.

**FORM:** The Question Paper (UPSC Prelims booklet). Candidate 1 of my ordered grounded list, taken as IMPECCABLE'S PICK over the roll's assignment (candidate 5, Platform Board). Seed key e8b4e067. Code-led. Carried disciplines from declined challengers: total colour commitment at page scale (Village Coffeehouse); relevance as visible proximity rather than a flat percentage badge (Accretion Threshold). Signature interaction: the answer reveal behaves like breaking the seal on a booklet — a sheet lift, not a fade. Honest risk, accepted by the user: this is the literal reading of the brief and borrows the artifact's authority rather than building its own; every competitor can reach for the same object, so execution fidelity is the entire moat.

**FINISH:** unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

## Unresolved

- sawaalbox.com is not registered yet; the site ships on the existing Render URL until it is.
- Monetization model (subscription vs paid features) undecided; nothing in this build may assume a paywall.
- Whether individual question pages carry Hindi alongside English (real papers are bilingual, but the extracted corpus is English-only — the bilingual line in the masthead must not imply bilingual question content that does not exist).
