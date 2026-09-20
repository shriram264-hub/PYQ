# UPSC PYQ Search — Web App Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the flat-file UPSC PYQ search prototype into a local web app with a FastAPI backend and a Vite/React frontend, with no behavior or visual changes.

**Architecture:** Two dev processes — FastAPI backend on port 8000 serving `/api/search` and `/api/meta`, and a Vite/React frontend on port 5173 that proxies `/api/*` to the backend. Data files and the extraction/indexing scripts move into `data/`.

**Tech Stack:** Python 3, FastAPI, uvicorn, sentence-transformers, numpy, pytest (backend); Vite, React 18 (frontend).

**Spec:** [docs/superpowers/specs/2026-09-20-web-app-restructure-design.md](../specs/2026-09-20-web-app-restructure-design.md)

## Global Constraints

- Local dev only — no deployment/hosting setup in this pass.
- Faithful port — same search behavior, same visual design, same CSS variables/dark mode, no new features, no redesign.
- No auth, no database.
- Backend on port 8000, frontend (Vite) on port 5173.
- Every task ends with a working, verifiable state — commit after each task.

---

### Task 1: Move data files and scripts into `data/`

**Files:**
- Move: `question_bank.pdf` → `data/question_bank.pdf`
- Move: `questions.csv` → `data/questions.csv`
- Move: `questions.json` → `data/questions.json`
- Move: `embeddings.npy` → `data/embeddings.npy`
- Move: `problems.txt` → `data/problems.txt`
- Move + modify: `extract_questions.py` → `data/scripts/extract_questions.py`
- Move + modify: `build_index.py` → `data/scripts/build_index.py`
- Move + modify: `search.py` → `data/scripts/search_cli.py`

**Interfaces:**
- Produces: `data/questions.json`, `data/embeddings.npy` at fixed paths relative to the repo root — `backend/app/data.py` (Task 2) reads them from there.

- [ ] **Step 1: Move the data files**

```bash
mkdir -p data/scripts
git mv question_bank.pdf data/question_bank.pdf
git mv questions.csv data/questions.csv
git mv questions.json data/questions.json
git mv embeddings.npy data/embeddings.npy
git mv problems.txt data/problems.txt
```

- [ ] **Step 2: Move and update `extract_questions.py`**

```bash
git mv extract_questions.py data/scripts/extract_questions.py
```

In `data/scripts/extract_questions.py`, change the `main()` function's output directory line so it writes into `data/` (the script's parent folder) instead of its own folder (`data/scripts/`):

Find this line:
```python
    out = Path(__file__).parent
```

Replace with:
```python
    out = Path(__file__).resolve().parent.parent
```

- [ ] **Step 3: Move and update `build_index.py`**

```bash
git mv build_index.py data/scripts/build_index.py
```

Replace the whole file content with this version (adds a `HERE` path so it reads/writes `data/` instead of the CWD):

```python
"""
Step 2: turn every question into an embedding (a list of numbers that
captures its meaning) so we can search by concept, not just exact words.

Usage:
    pip install sentence-transformers
    python build_index.py

Reads:   ../questions.json   (made by extract_questions.py)
Writes:  ../embeddings.npy   (one row of 384 numbers per question)

The first run downloads a free model (~130 MB). After that it works offline.
"""

import json
import time
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_NAME = "BAAI/bge-small-en-v1.5"  # small, fast, good for English search
HERE = Path(__file__).resolve().parent.parent


def question_to_text(q):
    """What the model reads for each question: topic + question + options."""
    options = " | ".join(q[k] for k in "abcd" if q[k])
    return f"{q['subject']} - {q['subtopic']}. {q['question']} Options: {options}"


def main():
    with open(HERE / "questions.json", encoding="utf-8") as f:
        questions = json.load(f)
    print(f"Loaded {len(questions)} questions")

    print(f"Loading model {MODEL_NAME} (downloads on first run) ...")
    model = SentenceTransformer(MODEL_NAME)

    texts = [question_to_text(q) for q in questions]
    start = time.time()
    vectors = model.encode(
        texts,
        batch_size=64,
        show_progress_bar=True,
        normalize_embeddings=True,  # lets us compare with a simple dot product
    )
    np.save(HERE / "embeddings.npy", vectors.astype(np.float32))

    print(f"\nDone in {time.time() - start:.0f}s")
    print(f"Saved embeddings.npy with shape {vectors.shape}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Move and rename `search.py` to `search_cli.py`**

```bash
git mv search.py data/scripts/search_cli.py
```

Replace the whole file content with this version (adds `HERE` the same way):

```python
"""
Step 3: search the questions by concept.

Usage:
    python search_cli.py

Then type a topic, e.g.  Harappan civilisation
Optional filters you can add to any search:
    year>=2015            only questions from 2015 onwards
    year<=2010            only questions up to 2010
    subject:geography     only one subject (matches part of the name)
    top:20                show 20 results instead of 10
Example:
    ramsar wetlands year>=2015 top:15
Type  q  to quit.
"""

import json
import re
import textwrap
from pathlib import Path

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_NAME = "BAAI/bge-small-en-v1.5"
# bge models work best when a search query starts with this instruction
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
HERE = Path(__file__).resolve().parent.parent


def parse_query(raw):
    """Split the typed text into the search words and any filters."""
    filters = {"min_year": None, "max_year": None, "subject": None, "top": 10}
    if m := re.search(r"year>=(\d{4})", raw):
        filters["min_year"] = int(m[1])
    if m := re.search(r"year<=(\d{4})", raw):
        filters["max_year"] = int(m[1])
    if m := re.search(r"subject:(\S+)", raw):
        filters["subject"] = m[1].lower()
    if m := re.search(r"top:(\d+)", raw):
        filters["top"] = int(m[1])
    text = re.sub(r"year[<>]=\d{4}|subject:\S+|top:\d+", "", raw).strip()
    return text, filters


def search(text, filters, questions, vectors, model):
    query_vec = model.encode(QUERY_PREFIX + text, normalize_embeddings=True)
    scores = vectors @ query_vec  # similarity of every question to the query

    keep = np.ones(len(questions), dtype=bool)
    for i, q in enumerate(questions):
        if filters["min_year"] and q["year"] < filters["min_year"]:
            keep[i] = False
        if filters["max_year"] and q["year"] > filters["max_year"]:
            keep[i] = False
        if filters["subject"] and filters["subject"] not in q["subject"].lower():
            keep[i] = False
    scores = np.where(keep, scores, -1)

    best = np.argsort(-scores)[: filters["top"]]
    return [(questions[i], float(scores[i])) for i in best if scores[i] > -1]


def show(results):
    if not results:
        print("  No matches with those filters.\n")
        return
    for rank, (q, score) in enumerate(results, 1):
        print(f"\n{rank}. [UPSC {q['year']} Q{q['q_no']}] "
              f"{q['subject']} › {q['subtopic']}  (match {score:.2f})")
        first_line = q["question"].split("\n")[0]
        print(textwrap.fill(first_line, 100, initial_indent="   ",
                            subsequent_indent="   "))
        if q["status"] == "cancelled":
            print("   Answer: cancelled by UPSC")
        elif q["answer"]:
            flag = "  (disputed)" if q["status"] == "disputed" else ""
            print(f"   Answer: ({q['answer']}) {q[q['answer']]}{flag}")
    print()


def main():
    with open(HERE / "questions.json", encoding="utf-8") as f:
        questions = json.load(f)
    vectors = np.load(HERE / "embeddings.npy")
    assert len(vectors) == len(questions), "Run build_index.py again"

    print("Loading model ...")
    model = SentenceTransformer(MODEL_NAME)
    print(f"Ready. {len(questions)} questions loaded. Type a topic, or q to quit.\n")

    while True:
        raw = input("Search> ").strip()
        if raw.lower() in {"q", "quit", "exit"}:
            break
        text, filters = parse_query(raw)
        if text:
            show(search(text, filters, questions, vectors, model))


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Verify the data still loads correctly**

```bash
cd data
python -c "import json, numpy as np; q = json.load(open('questions.json', encoding='utf-8')); v = np.load('embeddings.npy'); assert len(q) == len(v); print(f'OK: {len(q)} questions, {v.shape} embeddings')"
cd ..
```

Expected: `OK: <N> questions, (<N>, 384) embeddings` with no error.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor: move data files and scripts into data/"
```

---

### Task 2: Backend data loader

**Files:**
- Create: `backend/app/__init__.py`
- Create: `backend/app/data.py`
- Create: `backend/requirements.txt`

**Interfaces:**
- Consumes: `data/questions.json`, `data/embeddings.npy` (Task 1)
- Produces: `backend.app.data.QUESTIONS` (list of dicts), `backend.app.data.DATA_DIR` (Path) — used by `backend/app/search.py` (Task 3)

- [ ] **Step 1: Create the backend package folders**

```bash
mkdir -p backend/app
```

- [ ] **Step 2: Create `backend/app/__init__.py`**

```python
```

(empty file — makes `app` an importable package)

- [ ] **Step 3: Create `backend/app/data.py`**

```python
"""Loads the question bank and embeddings once at import time."""
import json
from pathlib import Path

import numpy as np

DATA_DIR = Path(__file__).resolve().parent.parent.parent / "data"

with open(DATA_DIR / "questions.json", encoding="utf-8") as f:
    QUESTIONS = json.load(f)

VECTORS = np.load(DATA_DIR / "embeddings.npy")

assert len(VECTORS) == len(QUESTIONS), (
    f"embeddings.npy has {len(VECTORS)} rows but questions.json has "
    f"{len(QUESTIONS)} entries. Run data/scripts/build_index.py again."
)
```

- [ ] **Step 4: Create `backend/requirements.txt`**

```
fastapi
uvicorn[standard]
sentence-transformers
numpy
pytest
```

- [ ] **Step 5: Install dependencies and verify the loader works**

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/python -c "from app.data import QUESTIONS, VECTORS; print(f'Loaded {len(QUESTIONS)} questions, vectors shape {VECTORS.shape}')"
cd ..
```

Expected: `Loaded <N> questions, vectors shape (<N>, 384)` with no assertion error. (On macOS/Linux use `.venv/bin/pip` and `.venv/bin/python` instead.)

- [ ] **Step 6: Commit**

```bash
git add backend/
git commit -m "feat(backend): add data loader"
```

---

### Task 3: Backend search logic

**Files:**
- Create: `backend/app/search.py`
- Create: `backend/tests/test_search.py`

**Interfaces:**
- Consumes: `app.data.QUESTIONS` (list of dict), `app.data.VECTORS` (np.ndarray) from Task 2
- Produces: `app.search.search(q="", top=25, min_year=0, max_year=9999, subject="", difficulty="") -> dict` and `app.search.meta() -> dict` — used by `backend/app/main.py` (Task 4)

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_search.py`:

```python
from app.data import QUESTIONS
from app.search import keyword_score, meta, search


def test_meta_reports_correct_count_and_year_range():
    result = meta()
    assert result["count"] == len(QUESTIONS)
    assert result["min_year"] <= result["max_year"]


def test_search_empty_query_respects_year_filter():
    sample_year = QUESTIONS[0]["year"]
    result = search(q="", min_year=sample_year, max_year=sample_year, top=200)
    assert result["total_filtered"] > 0
    assert all(r["year"] == sample_year for r in result["results"])


def test_search_respects_subject_filter():
    sample_subject = QUESTIONS[0]["subject"]
    result = search(q="", subject=sample_subject, top=5)
    assert all(r["subject"] == sample_subject for r in result["results"])


def test_search_top_caps_result_count():
    result = search(q="", top=3)
    assert len(result["results"]) <= 3


def test_keyword_score_counts_matching_words():
    scores = keyword_score("harappan civilisation")
    assert scores.shape[0] == len(QUESTIONS)
    assert scores.max() <= 1.0
    assert scores.min() >= 0.0
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd backend
.venv/Scripts/python -m pytest tests/ -v
cd ..
```

Expected: FAIL with `ModuleNotFoundError: No module named 'app.search'`

- [ ] **Step 3: Create `backend/app/search.py`**

```python
"""Search + metadata logic for the UPSC PYQ API, ported from the original app.py."""
import re
from collections import Counter

import numpy as np
from sentence_transformers import SentenceTransformer

from app.data import QUESTIONS, VECTORS

MODEL_NAME = "BAAI/bge-small-en-v1.5"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
KEYWORD_WEIGHT = 0.15  # small boost when the exact search words appear

STOPWORDS = set(
    "the a an of and or in on to for with by at from is are was were "
    "which what how india indian".split()
)

# Lower-cased full text of each question, for the keyword boost
FULLTEXT = [
    " ".join([q["question"], q["a"], q["b"], q["c"], q["d"], q["subtopic"]]).lower()
    for q in QUESTIONS
]
YEARS = np.array([q["year"] for q in QUESTIONS])
SUBJECTS = np.array([q["subject"] for q in QUESTIONS])
DIFFICULTY = np.array([q["difficulty"] for q in QUESTIONS])

_model = None


def get_model():
    """Load the embedding model lazily so tests that don't need it stay fast."""
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model


def keyword_score(query):
    """Fraction of meaningful query words found in each question (0 to 1)."""
    words = [
        w for w in re.findall(r"[a-z0-9]+", query.lower())
        if w not in STOPWORDS and len(w) > 2
    ]
    if not words:
        return np.zeros(len(QUESTIONS))
    hits = np.array([sum(w in text for w in words) for text in FULLTEXT])
    return hits / len(words)


def search(q="", top=25, min_year=0, max_year=9999, subject="", difficulty=""):
    top = min(top, 200)
    keep = (YEARS >= min_year) & (YEARS <= max_year)
    if subject:
        keep &= SUBJECTS == subject
    if difficulty:
        keep &= DIFFICULTY == difficulty

    if q:
        qvec = get_model().encode(QUERY_PREFIX + q, normalize_embeddings=True)
        scores = VECTORS @ qvec + KEYWORD_WEIGHT * keyword_score(q)
    else:  # no text: just browse the filtered questions, newest first
        scores = YEARS / 10000.0

    scores = np.where(keep, scores, -np.inf)
    order = np.argsort(-scores)[:top]
    results = []
    for i in order:
        if not np.isfinite(scores[i]):
            break
        results.append({**QUESTIONS[i], "score": round(float(scores[i]), 3)})

    return {
        "query": q,
        "total_filtered": int(keep.sum()),
        "results": results,
        "years_in_results": dict(sorted(Counter(r["year"] for r in results).items())),
    }


def meta():
    return {
        "count": len(QUESTIONS),
        "min_year": int(YEARS.min()),
        "max_year": int(YEARS.max()),
        "subjects": [s for s, _ in Counter(SUBJECTS.tolist()).most_common()],
    }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd backend
.venv/Scripts/python -m pytest tests/ -v
cd ..
```

Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/
git commit -m "feat(backend): add search logic with tests"
```

---

### Task 4: Backend FastAPI app

**Files:**
- Create: `backend/app/main.py`

**Interfaces:**
- Consumes: `app.search.search(...)`, `app.search.meta()` from Task 3
- Produces: `GET /api/search` and `GET /api/meta` HTTP endpoints on `http://localhost:8000` — consumed by the frontend `api.js` (Task 6)

- [ ] **Step 1: Create `backend/app/main.py`**

```python
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import search as search_module

app = FastAPI(title="UPSC PYQ Search API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/search")
def api_search(
    q: str = "",
    top: int = 25,
    min_year: int = 0,
    max_year: int = 9999,
    subject: str = "",
    difficulty: str = "",
):
    return search_module.search(
        q=q,
        top=top,
        min_year=min_year,
        max_year=max_year,
        subject=subject,
        difficulty=difficulty,
    )


@app.get("/api/meta")
def api_meta():
    return search_module.meta()
```

- [ ] **Step 2: Start the server**

```bash
cd backend
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

Leave this running in its own terminal for the next step.

- [ ] **Step 3: Verify both endpoints with curl (in a second terminal)**

```bash
curl "http://localhost:8000/api/meta"
curl "http://localhost:8000/api/search?q=harappan&top=3"
```

Expected: `/api/meta` returns JSON with `count`, `min_year`, `max_year`, `subjects`. `/api/search` returns JSON with `query`, `total_filtered`, `results` (an array of up to 3 items), `years_in_results`.

- [ ] **Step 4: Commit**

```bash
git add backend/
git commit -m "feat(backend): add FastAPI app with search and meta endpoints"
```

---

### Task 5: Frontend scaffold

**Files:**
- Create: `frontend/` (via Vite scaffold)
- Modify: `frontend/vite.config.js`

**Interfaces:**
- Produces: a Vite dev server on `http://localhost:5173` that proxies `/api/*` to `http://localhost:8000` — required by Task 6 onward.

- [ ] **Step 1: Scaffold the Vite + React app**

Run from the repo root:

```bash
npm create vite@latest frontend -- --template react
cd frontend
npm install
cd ..
```

- [ ] **Step 2: Add the dev proxy to `frontend/vite.config.js`**

Replace the file's contents with:

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
```

- [ ] **Step 3: Verify the dev server starts**

```bash
cd frontend
npm run dev
```

Expected: terminal prints a `Local: http://localhost:5173/` URL with no errors. Stop it with Ctrl+C once confirmed.

- [ ] **Step 4: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): scaffold Vite + React app with API proxy"
```

---

### Task 6: Frontend API client

**Files:**
- Create: `frontend/src/api.js`

**Interfaces:**
- Consumes: `GET /api/search`, `GET /api/meta` (Task 4), proxied via Vite (Task 5)
- Produces: `fetchMeta(): Promise<{count, min_year, max_year, subjects}>`, `fetchSearch(params): Promise<{query, total_filtered, results, years_in_results}>` — used by `App.jsx` (Task 10)

- [ ] **Step 1: Create `frontend/src/api.js`**

```js
async function getJSON(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export function fetchMeta() {
  return getJSON('/api/meta');
}

export function fetchSearch(params) {
  const query = new URLSearchParams(params);
  return getJSON(`/api/search?${query}`);
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/api.js
git commit -m "feat(frontend): add API client"
```

---

### Task 7: Frontend styles

**Files:**
- Create: `frontend/src/styles.css`

**Interfaces:**
- Produces: the class names (`.wrap`, `.searchbar`, `.filters`, `.card`, `.pill`, `.opts`, `.years`, `.examples`, `.empty`, `.reveal`, `.match`, `.note`, `.toggle`) that the components in Tasks 8–10 render into.

- [ ] **Step 1: Create `frontend/src/styles.css`**

```css
:root {
  --bg: #f7f6f2; --panel: #ffffff; --ink: #1d1d1b; --muted: #6b6a64;
  --line: #e4e2da; --accent: #2f5d50; --accent-soft: #e3eee9;
  --correct: #1f7a4d; --correct-bg: #e5f4ec; --warn: #9a5b00; --warn-bg: #fdf1dc;
  --bad: #a1322b; --bad-bg: #fbe7e5; --mark: #fff0a8;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #151614; --panel: #1e1f1c; --ink: #ecebe6; --muted: #9c9b94;
    --line: #33342f; --accent: #8cc5b1; --accent-soft: #24332d;
    --correct: #7fd3a6; --correct-bg: #1c3127; --warn: #f0bd6a; --warn-bg: #3a2e18;
    --bad: #f0958d; --bad-bg: #3a201e; --mark: #5a4d10;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink);
       font: 15px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
.wrap { max-width: 880px; margin: 0 auto; padding: 28px 16px 60px; }
h1 { font-size: 22px; margin: 0 0 2px; letter-spacing: -0.01em; }
.sub { color: var(--muted); margin: 0 0 20px; font-size: 14px; }

.searchbar { display: flex; gap: 8px; }
.searchbar input { flex: 1; min-width: 0; font: inherit; font-size: 16px; padding: 12px 14px;
    border: 1px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--ink); }
.searchbar input:focus { outline: 2px solid var(--accent); outline-offset: -1px; }
button { font: inherit; cursor: pointer; border-radius: 10px; border: 1px solid var(--line);
         background: var(--panel); color: var(--ink); padding: 10px 14px; }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--panel); font-weight: 600; }

.filters { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; margin: 14px 0 6px;
           font-size: 13px; color: var(--muted); }
.filters label { display: flex; align-items: center; gap: 6px; }
.filters select, .filters input[type=number] { font: inherit; font-size: 13px; padding: 5px 6px;
    border: 1px solid var(--line); border-radius: 7px; background: var(--panel); color: var(--ink); }
.filters input[type=number] { width: 72px; }

.examples { font-size: 13px; color: var(--muted); margin: 8px 0 18px; }
.examples a { color: var(--accent); cursor: pointer; margin-right: 10px; text-decoration: none;
              border-bottom: 1px dotted var(--accent); }

.summary { font-size: 13px; color: var(--muted); margin: 18px 0 8px; }
.years { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 14px; }
.years span { font-size: 12px; background: var(--accent-soft); color: var(--accent);
              padding: 2px 8px; border-radius: 999px; }

.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px;
        padding: 16px 18px; margin-bottom: 12px; }
.meta { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; font-size: 12.5px;
        color: var(--muted); margin-bottom: 8px; }
.meta b { color: var(--ink); }
.pill { padding: 1px 8px; border-radius: 999px; border: 1px solid var(--line); }
.pill.easy { color: var(--correct); } .pill.moderate { color: var(--warn); } .pill.difficult { color: var(--bad); }
.pill.cancelled { background: var(--bad-bg); color: var(--bad); border-color: transparent; }
.pill.disputed { background: var(--warn-bg); color: var(--warn); border-color: transparent; }
.match { margin-left: auto; }
.q { white-space: pre-wrap; margin: 0 0 10px; }
.opts { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; }
.opts li { padding: 3px 10px; border-radius: 8px; border: 1px solid transparent; }
.reveal .opts li.right { background: var(--correct-bg); color: var(--correct); font-weight: 600; }
.note { font-size: 13px; margin-top: 8px; color: var(--muted); display: none; }
.reveal .note { display: block; }
.card .toggle { font-size: 12.5px; padding: 4px 10px; margin-top: 10px; }
mark { background: var(--mark); color: inherit; border-radius: 3px; padding: 0 1px; }
.empty { text-align: center; color: var(--muted); padding: 40px 0; }
@media (max-width: 560px) { .match { margin-left: 0; } }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/styles.css
git commit -m "feat(frontend): port CSS from the original index.html"
```

---

### Task 8: Highlight helper + ResultCard component

**Files:**
- Create: `frontend/src/highlight.jsx`
- Create: `frontend/src/components/ResultCard.jsx`

**Interfaces:**
- Produces: `highlightSegments(text: string, query: string) -> (string | ReactElement)[]`, `<ResultCard q={question} query={string} showAllAnswers={boolean} />` — used by `App.jsx` (Task 10)

- [ ] **Step 1: Create `frontend/src/highlight.jsx`**

```jsx
export function highlightSegments(text, query) {
  const words = [...new Set((query.toLowerCase().match(/[a-z0-9]{3,}/g) || []))];
  if (words.length === 0) return text;
  const pattern = new RegExp(`\\b(${words.join('|')}\\w*)`, 'gi');
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? <mark key={i}>{part}</mark> : part
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/ResultCard.jsx`**

```jsx
import { useState } from 'react';
import { highlightSegments } from '../highlight.jsx';

export default function ResultCard({ q, query, showAllAnswers }) {
  const [revealed, setRevealed] = useState(false);
  const reveal = showAllAnswers || revealed;

  const status = q.status === 'cancelled'
    ? <span className="pill cancelled">Cancelled by UPSC</span>
    : q.status === 'disputed'
      ? <span className="pill disputed">Answer disputed</span>
      : null;

  return (
    <div className={`card${reveal ? ' reveal' : ''}`}>
      <div className="meta">
        <b>UPSC {q.year} · Q{q.q_no}</b>
        <span>{q.subject} › {q.subtopic}</span>
        <span className={`pill ${q.difficulty}`}>{q.difficulty}</span>
        {status}
        {query && <span className="match">match {Math.round(q.score * 100)}%</span>}
      </div>
      <p className="q">{highlightSegments(q.question, query)}</p>
      <ul className="opts">
        {['a', 'b', 'c', 'd'].map(k => (
          <li key={k} className={q.answer === k ? 'right' : ''}>
            ({k}) {highlightSegments(q[k], query)}
          </li>
        ))}
      </ul>
      {q.answer_note && <div className="note">Note: {q.answer_note}</div>}
      <button className="toggle" type="button" onClick={() => setRevealed(r => !r)}>
        Show / hide answer
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/highlight.jsx frontend/src/components/ResultCard.jsx
git commit -m "feat(frontend): add highlight helper and ResultCard component"
```

---

### Task 9: SearchBar, Filters, YearsSummary components

**Files:**
- Create: `frontend/src/components/SearchBar.jsx`
- Create: `frontend/src/components/Filters.jsx`
- Create: `frontend/src/components/YearsSummary.jsx`

**Interfaces:**
- Produces:
  - `<SearchBar query={string} onQueryChange={fn} onSubmit={fn} onExampleClick={fn} />`
  - `<Filters meta={{subjects, min_year, max_year}} filters={{subject, minYear, maxYear, difficulty, top, showAnswers}} onChange={fn(patch)} />`
  - `<YearsSummary query={string} results={array} totalFiltered={number} yearsInResults={object} />`
  - all consumed by `App.jsx` (Task 10)

- [ ] **Step 1: Create `frontend/src/components/SearchBar.jsx`**

```jsx
const EXAMPLES = [
  'Harappan civilisation', 'Fundamental Rights', 'El Nino and monsoon',
  'Buddhist councils', 'inflation targeting RBI', 'tiger reserves',
];

export default function SearchBar({ query, onQueryChange, onSubmit, onExampleClick }) {
  return (
    <>
      <form className="searchbar" onSubmit={e => { e.preventDefault(); onSubmit(); }}>
        <input
          type="search"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          placeholder="e.g. Harappan civilisation, Ramsar wetlands, money bill…"
          autoFocus
        />
        <button className="primary" type="submit">Search</button>
      </form>
      <div className="examples">Try:
        {EXAMPLES.map(ex => (
          <a key={ex} onClick={() => onExampleClick(ex)}>{ex}</a>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 2: Create `frontend/src/components/Filters.jsx`**

```jsx
export default function Filters({ meta, filters, onChange }) {
  return (
    <div className="filters">
      <label>Subject
        <select value={filters.subject} onChange={e => onChange({ subject: e.target.value })}>
          <option value="">All</option>
          {meta.subjects.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      <label>Years
        <input type="number" value={filters.minYear} min={meta.min_year} max={meta.max_year}
          onChange={e => onChange({ minYear: e.target.value })} /> –
        <input type="number" value={filters.maxYear} min={meta.min_year} max={meta.max_year}
          onChange={e => onChange({ maxYear: e.target.value })} />
      </label>
      <label>Difficulty
        <select value={filters.difficulty} onChange={e => onChange({ difficulty: e.target.value })}>
          <option value="">All</option>
          <option>easy</option>
          <option>moderate</option>
          <option>difficult</option>
        </select>
      </label>
      <label>Show
        <select value={filters.top} onChange={e => onChange({ top: e.target.value })}>
          <option>10</option>
          <option>25</option>
          <option>50</option>
          <option>100</option>
        </select>
      </label>
      <label>
        <input type="checkbox" checked={filters.showAnswers}
          onChange={e => onChange({ showAnswers: e.target.checked })} />
        Show all answers
      </label>
    </div>
  );
}
```

- [ ] **Step 3: Create `frontend/src/components/YearsSummary.jsx`**

```jsx
export default function YearsSummary({ query, results, totalFiltered, yearsInResults }) {
  return (
    <>
      <div className="summary">
        {query ? `Top ${results.length} matches for "${query}"` : `Showing ${results.length}`}
        {' '}from {totalFiltered.toLocaleString()} questions in range. Years in these results:
      </div>
      <div className="years">
        {Object.entries(yearsInResults).map(([y, n]) => <span key={y}>{y} × {n}</span>)}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/SearchBar.jsx frontend/src/components/Filters.jsx frontend/src/components/YearsSummary.jsx
git commit -m "feat(frontend): add SearchBar, Filters, YearsSummary components"
```

---

### Task 10: App wiring

**Files:**
- Modify: `frontend/src/App.jsx` (overwrite scaffold default)
- Modify: `frontend/src/main.jsx` (overwrite scaffold default)
- Modify: `frontend/index.html` (overwrite scaffold default)
- Delete: `frontend/src/App.css`, `frontend/src/index.css`, `frontend/src/assets/react.svg`, `frontend/public/vite.svg` (unused scaffold defaults)

**Interfaces:**
- Consumes: `fetchMeta`/`fetchSearch` (Task 6), `SearchBar`/`Filters`/`YearsSummary`/`ResultCard` (Tasks 8–9)
- Produces: the rendered app at `http://localhost:5173`

- [ ] **Step 1: Remove unused scaffold files**

```bash
cd frontend
rm -f src/App.css src/index.css src/assets/react.svg public/vite.svg
cd ..
```

- [ ] **Step 2: Replace `frontend/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>UPSC PYQ Search</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 3: Replace `frontend/src/main.jsx`**

```jsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 4: Replace `frontend/src/App.jsx`**

```jsx
import { useEffect, useState, useCallback } from 'react';
import SearchBar from './components/SearchBar';
import Filters from './components/Filters';
import YearsSummary from './components/YearsSummary';
import ResultCard from './components/ResultCard';
import { fetchMeta, fetchSearch } from './api';

const initialFilters = {
  subject: '', minYear: '', maxYear: '', difficulty: '', top: '25', showAnswers: false,
};

export default function App() {
  const [meta, setMeta] = useState(null);
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [lastQuery, setLastQuery] = useState('');

  useEffect(() => {
    fetchMeta()
      .then(m => {
        setMeta(m);
        setFilters(f => ({ ...f, minYear: m.min_year, maxYear: m.max_year }));
      })
      .catch(e => setError(e.message));
  }, []);

  const runSearch = useCallback(async (q, f) => {
    setError(null);
    setLastQuery(q);
    try {
      const r = await fetchSearch({
        q,
        subject: f.subject,
        min_year: f.minYear,
        max_year: f.maxYear,
        difficulty: f.difficulty,
        top: f.top,
      });
      setResult(r);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  const handleFilterChange = (patch) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (meta) runSearch(query, next);
  };

  const handleExampleClick = (text) => {
    setQuery(text);
    runSearch(text, filters);
  };

  if (!meta && !error) return <div className="wrap"><p className="empty">Loading…</p></div>;
  if (error && !meta) return <div className="wrap"><p className="empty">Something went wrong: {error}. Is the backend running?</p></div>;

  return (
    <div className="wrap">
      <h1>UPSC Prelims PYQ Search</h1>
      <p className="sub">
        {meta.count.toLocaleString()} UPSC Prelims questions, {meta.min_year}–{meta.max_year}.
        Search by concept, not just exact words.
      </p>

      <SearchBar
        query={query}
        onQueryChange={setQuery}
        onSubmit={() => runSearch(query, filters)}
        onExampleClick={handleExampleClick}
      />

      <Filters meta={meta} filters={filters} onChange={handleFilterChange} />

      <div id="out">
        {error && <p className="empty">Something went wrong: {error}. Is the backend running?</p>}
        {!error && !result && <p className="empty">Type a topic to search, or pick filters and search with an empty box to browse.</p>}
        {!error && result && result.results.length === 0 && <p className="empty">No questions match these filters.</p>}
        {!error && result && result.results.length > 0 && (
          <>
            <YearsSummary
              query={lastQuery}
              results={result.results}
              totalFiltered={result.total_filtered}
              yearsInResults={result.years_in_results}
            />
            {result.results.map(q => (
              <ResultCard key={`${q.year}-${q.q_no}`} q={q} query={lastQuery} showAllAnswers={filters.showAnswers} />
            ))}
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Start both servers and verify manually**

In one terminal:

```bash
cd backend
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

In a second terminal:

```bash
cd frontend
npm run dev
```

Open `http://localhost:5173` in a browser and check:
- The page loads with the question count and year range in the subtitle
- Typing "Harappan civilisation" and pressing Search shows ranked results with match percentages and highlighted words
- Changing a filter (e.g. Subject) re-runs the search automatically
- Clicking an example link runs that search
- "Show / hide answer" reveals the correct option highlighted green on a card
- "Show all answers" checkbox reveals answers on every card at once
- A filter combination with zero matches shows "No questions match these filters."

- [ ] **Step 6: Commit**

```bash
git add frontend/
git commit -m "feat(frontend): wire App to backend, remove scaffold defaults"
```

---

### Task 11: README and cleanup

**Files:**
- Create: `README.md`
- Delete: `app.py`, `index.html` (superseded by `backend/` and `frontend/`)

**Interfaces:**
- None (final integration task)

- [ ] **Step 1: Remove the superseded root files**

```bash
git rm app.py index.html
```

- [ ] **Step 2: Create `README.md`**

```markdown
# UPSC Prelims PYQ Search

Semantic search over UPSC Prelims previous-year questions.

## Structure

- `data/` — the source PDF, extracted question bank (`questions.csv`/`questions.json`), embeddings, and the extraction/indexing scripts
- `backend/` — FastAPI app serving the search API
- `frontend/` — Vite + React search UI

## Running locally

### 1. Backend (first time)

```bash
cd backend
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt
.venv/Scripts/uvicorn app.main:app --reload --port 8000
```

(On macOS/Linux, use `.venv/bin/pip` and `.venv/bin/uvicorn` instead.)

### 2. Frontend (first time, in a second terminal)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## Rebuilding the question bank from a new PDF

```bash
cd data/scripts
python extract_questions.py ../question_bank.pdf
python build_index.py
```
```

- [ ] **Step 3: Verify the full app still runs end to end**

Repeat the manual checklist from Task 10 Step 5 with both servers running from a clean start, following the README's own instructions exactly (as a check that the README is accurate).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: add README, remove superseded root app.py and index.html"
```
