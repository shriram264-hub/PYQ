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

## Deploying (Render)

This repo includes a `render.yaml` Blueprint that deploys both services on Render's free tier:

1. Push this repo to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New > Blueprint** and select the repo. Render reads `render.yaml` and creates both services automatically:
   - `upsc-pyq-search-api` — the FastAPI backend (free web service)
   - `upsc-pyq-search` — the static frontend build (free static site)
3. Click **Apply** to deploy.

If either service name is already taken on Render, it gets a random suffix appended to its `onrender.com` URL. If that happens, update the two cross-referencing env vars to match the real URLs:
- `upsc-pyq-search-api`'s `ALLOWED_ORIGINS` should include the frontend's actual URL
- `upsc-pyq-search`'s `VITE_API_BASE` should be the backend's actual URL (redeploy the frontend after changing this, since it's baked in at build time)

**Known limitation:** the backend's free tier gives 512MB RAM, which may be tight for `sentence-transformers` + `torch`. Watch the service's memory metrics after the first deploy — if it's crashing/OOMing, the fix is upgrading just that service's compute plan (Render's dashboard), not the workspace plan.

**Also note:** the free backend service sleeps after 15 minutes of no traffic and takes about a minute to wake up on the next request.
