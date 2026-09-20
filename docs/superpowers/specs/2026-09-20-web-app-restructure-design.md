# UPSC PYQ Search — Restructure into a Local Web App

Date: 2026-09-20
Status: Approved for planning

## Context

The project currently lives as a flat set of scripts in the repo root:

- `extract_questions.py` — parses `question_bank.pdf` into `questions.csv` / `questions.json`
- `build_index.py` — turns `questions.json` into `embeddings.npy` via `sentence-transformers`
- `search.py` — interactive CLI search
- `app.py` — a raw `http.server` process that serves `index.html` and two JSON
  endpoints (`/api/search`, `/api/meta`), doing the same scoring as `search.py`
  but over HTTP
- `index.html` — a single static page with inline CSS/JS calling those endpoints

It works, but backend logic (scoring), API serving, and static file serving are
all mixed into one file, and there's no separation between "data pipeline",
"backend", and "frontend" concerns.

## Goal

Restructure into a proper local web app: a FastAPI backend and a Vite/React
frontend, run as two dev processes. **No deployment/hosting work in this
pass** — this is a structural and stack upgrade only, still run via
`localhost`. The visual design and all current behavior (search, filters,
answer reveal, highlighting) carry over unchanged — this is a faithful port,
not a redesign.

## Non-goals

- No hosting/deployment setup (Render, Vercel, etc.)
- No auth, no database, no user accounts
- No new features beyond what `index.html` already does
- No visual redesign — same layout, same CSS variables, same dark mode

## Target structure

```
UPSC_project/
  backend/
    app/
      main.py          # FastAPI app, CORS, route wiring
      search.py         # search()/meta() logic, ported from app.py
      data.py            # loads questions.json + embeddings.npy once at startup
    requirements.txt
  frontend/
    src/
      App.jsx
      components/
        SearchBar.jsx
        Filters.jsx
        ResultCard.jsx
        YearsSummary.jsx
      api.js             # fetch wrappers for /api/search, /api/meta
      styles.css          # ported from index.html's <style> block
      main.jsx
    index.html
    package.json
    vite.config.js        # dev proxy: /api -> http://localhost:8000
  data/
    question_bank.pdf
    questions.csv
    questions.json
    embeddings.npy
    problems.txt
    scripts/
      extract_questions.py   # same logic, updated I/O paths
      build_index.py          # same logic, updated I/O paths
      search_cli.py            # renamed from search.py (name clash with backend/app/search.py)
  README.md               # how to run both halves
```

## Data flow

1. `data/scripts/extract_questions.py` — unchanged parsing logic, writes to
   `data/questions.csv` / `data/questions.json` (paths updated to the new
   location; still invoked as `python extract_questions.py path/to/pdf` from
   inside `data/scripts/`, or with an updated relative path — plan should
   decide and document the exact invocation).
2. `data/scripts/build_index.py` — unchanged logic, reads `data/questions.json`,
   writes `data/embeddings.npy`.
3. `backend/app/data.py` — loads `../data/questions.json` and
   `../data/embeddings.npy` once at import time, with the same
   `len(vectors) == len(questions)` assertion the current `app.py` has.
4. `backend/app/search.py` — the same scoring logic as today's `app.py`
   (`keyword_score`, embedding similarity via `VECTORS @ qvec`, keyword-weight
   blend, year/subject/difficulty filtering) as plain importable functions
   instead of inline HTTP-handler code.
5. `backend/app/main.py` — FastAPI app exposing:
   - `GET /api/search` — same query params as today (`q`, `top`, `min_year`,
     `max_year`, `subject`, `difficulty`), same response shape (`query`,
     `total_filtered`, `results`, `years_in_results`)
   - `GET /api/meta` — same response shape (`count`, `min_year`, `max_year`,
     `subjects`)
   - CORS configured for the Vite dev origin (`http://localhost:5173`)
6. React frontend — `App.jsx` owns search/filter state and orchestrates
   `api.js` calls; `SearchBar`, `Filters`, `ResultCard`, `YearsSummary` are a
   direct decomposition of today's `run()`, `card()`, and the filters bar in
   `index.html`. Same highlight-matched-words behavior, same
   show/hide-answer toggle per card, same "show all answers" checkbox.

## Error handling

- Backend: FastAPI's default JSON error response for unhandled exceptions is
  sufficient — same effective behavior as today's manual try/except-then-500.
- Frontend: keep the existing "Something went wrong: `<message>`" fallback
  shown in the results area on a failed fetch.
- Startup: if `questions.json`/`embeddings.npy` are missing or mismatched in
  length, the backend should fail fast with a clear message (same assertion
  behavior as today's `app.py`), not fail silently on first request.

## Testing / verification

No automated test suite exists today and none is required by this restructure
(pure port, no new logic). Verification is manual, run via the browser pane:
start both dev servers, then check:
- A text search returns ranked results with score display (e.g. "Harappan
  civilisation")
- Filter-only browsing (empty query + year/subject/difficulty filters) works
- Answer reveal toggle (per-card and the global "show all answers" checkbox)
  behaves the same as today
- Empty-results state renders correctly
- Dark mode still applies via `prefers-color-scheme`

## Open questions for the plan step

- Exact Python dependency pinning for `backend/requirements.txt`
  (`fastapi`, `uvicorn`, `sentence-transformers`, `numpy`)
- Whether `data/scripts/` scripts get a small path-handling tweak (they
  currently assume CWD == script directory) or stay run-from-their-own-folder
  as today
- README content: how to install and run backend + frontend together
