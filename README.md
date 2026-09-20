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

## Live site

- Frontend: https://upsc-pyq-search-s778.onrender.com
- Backend API: https://upsc-pyq-search-api.onrender.com

## Deploying (Render)

This repo includes a `render.yaml` Blueprint that deploys both services on Render's free tier:

1. Push this repo to GitHub.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New > Blueprint** and select the repo. Render reads `render.yaml` and creates both services automatically:
   - `upsc-pyq-search-api` — the FastAPI backend (free web service)
   - `upsc-pyq-search` — the static frontend build (free static site)
3. Click **Apply** to deploy.

Service names are global across Render, so a taken name gets a random suffix appended to its `onrender.com` URL — which is what happened here (`upsc-pyq-search` → `upsc-pyq-search-s778`). If you redeploy under different names, update the two cross-referencing env vars in `render.yaml` to match the real URLs:
- `upsc-pyq-search-api`'s `ALLOWED_ORIGINS` must include the frontend's actual URL, or every browser request fails CORS
- `upsc-pyq-search`'s `VITE_API_BASE` must be the backend's actual URL (redeploy the frontend after changing it — it's baked in at build time)

### Why the backend uses ONNX, not PyTorch

The free tier gives 512MB RAM. Importing `sentence-transformers` (and therefore `torch`) costs 600-700MB, which made the service take ~55s to start at best and hang indefinitely on a cold wake. The server only ever needs to embed one short search query — every question vector is precomputed in `data/embeddings.npy` — so `backend/` uses `fastembed`, which runs the same `BAAI/bge-small-en-v1.5` weights under ONNX Runtime: ~230MB steady state, ~1s startup, ~0.26s warm search.

Keep this in mind when changing `backend/requirements.txt`: **adding anything that pulls in `torch` will break the deployment.** The offline pipeline in `data/scripts/` still uses `sentence-transformers` (see its own `requirements.txt`), which is fine since it runs on your machine, not the server. A test pins the invariant that both produce compatible vectors.

**Note on the free tier:** the backend sleeps after 15 minutes of no traffic. The next request wakes it in ~1s, but the first *text search* after a wake also re-downloads the 65MB model (Render's filesystem is ephemeral), adding a few seconds.
