"""
Step 4: a local search website for the UPSC questions.

Usage (in the same folder as questions.json, embeddings.npy, index.html):
    python app.py
Then open  http://localhost:8000  in your browser.
Press Ctrl+C in the terminal to stop it.

Uses only Python's built-in web server - no extra installs beyond
sentence-transformers, which you already installed for build_index.py.
"""

import json
import re
from collections import Counter
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import numpy as np
from sentence_transformers import SentenceTransformer

PORT = 8000
MODEL_NAME = "BAAI/bge-small-en-v1.5"
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "
KEYWORD_WEIGHT = 0.15  # small boost when the exact search words appear
HERE = Path(__file__).parent

print("Loading questions and embeddings ...")
QUESTIONS = json.loads((HERE / "questions.json").read_text(encoding="utf-8"))
VECTORS = np.load(HERE / "embeddings.npy")
assert len(VECTORS) == len(QUESTIONS), "Run build_index.py again"

# Lower-cased full text of each question, for the keyword boost
FULLTEXT = [
    " ".join([q["question"], q["a"], q["b"], q["c"], q["d"], q["subtopic"]]).lower()
    for q in QUESTIONS
]
YEARS = np.array([q["year"] for q in QUESTIONS])
SUBJECTS = np.array([q["subject"] for q in QUESTIONS])
DIFFICULTY = np.array([q["difficulty"] for q in QUESTIONS])

print(f"Loading model {MODEL_NAME} ...")
MODEL = SentenceTransformer(MODEL_NAME)

STOPWORDS = set("the a an of and or in on to for with by at from is are was were "
                "which what how india indian".split())


def keyword_score(query):
    """Fraction of meaningful query words found in each question (0 to 1)."""
    words = [w for w in re.findall(r"[a-z0-9]+", query.lower())
             if w not in STOPWORDS and len(w) > 2]
    if not words:
        return np.zeros(len(QUESTIONS))
    hits = np.array([sum(w in text for w in words) for text in FULLTEXT])
    return hits / len(words)


def search(params):
    query = params.get("q", "").strip()
    top = min(int(params.get("top", 25)), 200)
    min_year = int(params.get("min_year") or 0)
    max_year = int(params.get("max_year") or 9999)
    subject = params.get("subject", "")
    difficulty = params.get("difficulty", "")

    keep = (YEARS >= min_year) & (YEARS <= max_year)
    if subject:
        keep &= SUBJECTS == subject
    if difficulty:
        keep &= DIFFICULTY == difficulty

    if query:
        qvec = MODEL.encode(QUERY_PREFIX + query, normalize_embeddings=True)
        scores = VECTORS @ qvec + KEYWORD_WEIGHT * keyword_score(query)
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
        "query": query,
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


class Handler(BaseHTTPRequestHandler):
    def send(self, body, content_type, status=200):
        data = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        url = urlparse(self.path)
        params = {k: v[0] for k, v in parse_qs(url.query).items()}
        try:
            if url.path == "/":
                self.send((HERE / "index.html").read_text(encoding="utf-8"),
                          "text/html; charset=utf-8")
            elif url.path == "/api/search":
                self.send(json.dumps(search(params), ensure_ascii=False),
                          "application/json; charset=utf-8")
            elif url.path == "/api/meta":
                self.send(json.dumps(meta()), "application/json; charset=utf-8")
            else:
                self.send("Not found", "text/plain", 404)
        except Exception as e:  # show errors instead of crashing the server
            self.send(json.dumps({"error": str(e)}), "application/json", 500)

    def log_message(self, *args):  # keep the terminal quiet
        pass


if __name__ == "__main__":
    print(f"\nReady! Open http://localhost:{PORT} in your browser.")
    print("Press Ctrl+C here to stop.\n")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
