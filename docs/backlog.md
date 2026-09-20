# Backlog

## Backlog 1 — Standardized question ingestion pipeline

Add a way to bring in new questions from arbitrary source formats (PDF, Word, Excel, scanned/image PDFs, copy-pasted text) on a recurring basis, without writing a new regex parser per source.

Agreed approach (not yet built):
1. Drop the new source file into the project.
2. Ask Claude (in a Claude Code session — no separate API key needed) to read it and extract questions into a staging CSV matching `questions.csv`'s columns.
3. Review/correct the staging CSV by hand (e.g. in Excel).
4. Run a new deterministic merge script (`data/scripts/merge_batch.py`, no LLM) that validates the staging CSV, assigns continuing `id`s, dedupes against the existing question bank, appends to `data/questions.json`/`data/questions.csv`, and computes + appends embeddings for just the new rows to `data/embeddings.npy`.
5. Restart the backend to pick up the new data (it loads the question bank once at startup; `--reload` only watches `backend/`, not `data/`).

Still to design: exact staging CSV schema/columns, the merge script's dedup logic (by `(year, q_no)` and/or fuzzy match on question text), and whether embeddings are appended incrementally or the whole set is rebuilt each time.

## Backlog 2 — SEO / discoverability

The site is currently a single-page app: one URL, no meta tags, and no content Google can crawl per-topic (results only exist after a user submits a search, so there's nothing for a query like "Harappan civilisation UPSC questions" to match against). This is a real gap for organic growth/traffic, which the monetization roadmap depends on.

Needs its own design pass, likely covering:
- Actual indexable content pages (e.g. one static page per subject/year — "UPSC 2023 Ancient History Questions") with real crawlable question text, not just the interactive search tool
- Basic meta tags (title, description, OpenGraph) per page
- A sitemap
- Decide whether this needs server-side rendering / static pre-rendering, or can be done as a separate set of static pages alongside the existing React search app

## Backlog 3 — Move backend region from Oregon to Singapore

Render defaults to the `oregon` region when none is set in `render.yaml`. Most users of this site are India-based, so Oregon (US West) adds real latency; Render's closest available region to India is `singapore`.

Not yet done: add `region: singapore` to `upsc-pyq-search-api` in `render.yaml`. Render doesn't support changing a service's region after creation, so the backend service already deployed in Oregon would need to be deleted and recreated (a fresh Blueprint deploy) to actually move. Static sites aren't affected (they run on Render's global CDN regardless of region).
