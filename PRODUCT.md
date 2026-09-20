# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Existing: FastAPI backend (Python) serving a semantic search API, deployed on Render's free tier. Frontend is currently React + Vite (single page); **confirmed decision to migrate the frontend to Astro** so that subject, year, topic and individual-question pages are generated as real static HTML at build time for search engines, with the interactive search kept as a client-side island.

## Users

Indian UPSC Civil Services Prelims aspirants, studying or revising on their own. The typical moment: they have just finished reading about a topic and want to see how UPSC has actually asked about it across past years — or they want to work through a subject or a specific year systematically.

Secondary: aspirants of other Indian competitive exams, once the corpus expands beyond UPSC (confirmed as a later intention, not current scope).

## Product Purpose

Make every UPSC Prelims question ever asked findable by *concept*, not just keyword, and show the answer. Success is an aspirant finding the questions relevant to what they just studied in seconds, and trusting that nothing relevant was missed.

## Positioning

Semantic search over a complete, dated corpus of past questions. Competing material is mostly static PDF compilations or keyword-matching question banks: searching "El Nino and monsoon" there finds only questions containing those literal words. Here it finds questions about the concept, including ones phrased entirely differently, ranked by relevance and filterable by year, subject and difficulty.

## Operating Context

- Self-directed revision, often topic-by-topic, over long study cycles spanning months.
- Heavy mobile use is expected for this audience, frequently on mobile data rather than broadband.
- Free and requires no sign-up; anything that gates the core corpus works against how it is used.
- Questions carry real exam metadata aspirants care about: year, question number, subject, subtopic, difficulty, and whether UPSC later cancelled or disputed the answer.

## Capabilities and Constraints

**Confirmed corpus:** 3,959 questions spanning 1995–2026, across 13 subjects (after canonicalising duplicate extraction labels — `Polity`→`Indian Polity`, `Economy`→`Indian Economy`, `Environment`→`Environment & Ecology`, `Science and Technology`/`Science`→`Science & Technology`) and 208 subject+subtopic pairs. 87 of those subtopics hold fewer than 5 questions.

**Search:** all question vectors are precomputed in `data/embeddings.npy`; the server embeds only the user's query at request time, via ONNX Runtime (`fastembed`, `BAAI/bge-small-en-v1.5`), blended with a small exact-keyword boost.

**Hard technical constraints:**
- The backend runs on Render's free tier with a 512MB memory ceiling. PyTorch cannot be reintroduced to the server — it exceeds the ceiling and previously prevented the service from starting at all.
- That free instance sleeps after 15 minutes of inactivity; the first request after a sleep is slow, and the first text search afterwards re-downloads the 65MB model because the filesystem is ephemeral.

**Accounts:** none exist. Progress tracking in this build is browser-local only (localStorage) — per-device, lost if the user clears their browser. Real cross-device tracking is deliberately deferred until accounts exist.

**Pagination:** the current interface caps results rather than paginating, so questions beyond the cap are unreachable. Fixing this is committed scope.

**Undecided:** the `sawaalbox.com` domain is not yet registered. Monetization is intended to be subscription or paid features rather than advertising (advertising is ruled out), but the specific model, price and gating are undecided.

## Brand Commitments

Name: **SawaalBox** — *sawaal* (सवाल) is the everyday Hindi/Urdu word for "question", paired with a plain English noun. Chosen to be warm and immediately meaningful to an Indian audience while staying exam-neutral, so other exams can join the corpus later without a rename.

Deliberately avoid any "…Adda" construction: Adda247 operates a large family of Indian exam-prep brands under that pattern (BankersAdda, SSCAdda), so it risks brand confusion.

The name intentionally does not contain "UPSC" or "PYQ"; keyword relevance is expected to come from page titles and content, not the domain.

## Evidence on Hand

Real, in-repo: `data/questions.json` — 3,959 genuine past questions with options, official answers, and status flags for questions UPSC cancelled or disputed. `data/question_bank.pdf` is the source compilation (UnlockIAS). `data/embeddings.npy` holds the precomputed vectors.

There are **no** users yet, no testimonials, no traffic figures, no press, no institutional endorsement, and no accuracy audit by a subject expert. None of these may be implied or fabricated in any interface copy.

## Product Principles

1. **The corpus is the product.** Completeness and correct metadata matter more than features layered on top; a missing or mislabelled question is worse than a missing feature.
2. **Never imply certainty the data doesn't support.** Cancelled and disputed answers are surfaced as such, not quietly presented as fact.
3. **Free and ungated at the core.** Search and read access to past questions stays open; anything monetized later must be additional, not a toll on the corpus.
4. **Built for revision, not for browsing pleasure.** The aspirant arrives with a topic in mind and limited time; getting them to relevant questions fast beats anything decorative.
5. **Nothing that requires an account may become load-bearing** while accounts do not exist.

## Accessibility & Inclusion

No formal standard has been committed. Two product-specific needs are established by the audience: the interface must work well on mid-range Android phones over mobile data, and question text must stay legible at length, since users read dense multi-statement questions rather than skimming.
