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
