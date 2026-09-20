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
