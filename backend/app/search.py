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
