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
