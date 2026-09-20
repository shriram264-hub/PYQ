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
