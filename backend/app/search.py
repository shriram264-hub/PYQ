"""Search + metadata logic for the UPSC PYQ API, ported from the original app.py."""
import re
from collections import Counter

import numpy as np

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
    """Load the embedding model lazily.

    fastembed is imported here rather than at module scope so that starting the
    server costs nothing: /api/meta and filter-only browsing never touch the
    model, and on a cold start the process binds its port immediately instead of
    sitting through the import first.
    """
    global _model
    if _model is None:
        from fastembed import TextEmbedding

        _model = TextEmbedding(model_name=MODEL_NAME)
    return _model


def embed_query(text):
    """Embed one search query into the same space as data/embeddings.npy.

    fastembed returns L2-normalised vectors, which is what build_index.py asked
    sentence-transformers for, so the dot product below stays a cosine.
    """
    return np.asarray(next(iter(get_model().embed([text]))), dtype=np.float32)


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


def search(q="", top=25, offset=0, min_year=0, max_year=9999, subject="", difficulty=""):
    top = min(max(top, 1), 200)
    offset = max(offset, 0)

    keep = (YEARS >= min_year) & (YEARS <= max_year)
    if subject:
        keep &= SUBJECTS == subject
    if difficulty:
        keep &= DIFFICULTY == difficulty

    if q:
        qvec = embed_query(QUERY_PREFIX + q)
        scores = VECTORS @ qvec + KEYWORD_WEIGHT * keyword_score(q)
    else:  # no text: just browse the filtered questions, newest first
        scores = YEARS / 10000.0

    scores = np.where(keep, scores, -np.inf)

    # Rank everything that passed the filters, then hand back one window of it.
    # Ranking the whole set is what makes paging past the first page possible.
    order = np.argsort(-scores)
    matched = int(keep.sum())
    window = order[offset : offset + top]

    results = []
    for i in window:
        if not np.isfinite(scores[i]):
            break
        results.append({**QUESTIONS[i], "score": round(float(scores[i]), 3)})

    return {
        "query": q,
        "total_filtered": matched,
        "total_results": matched,
        "offset": offset,
        "page_size": top,
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
