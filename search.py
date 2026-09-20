"""
Step 3: search the questions by concept.

Usage:
    python search.py

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

import numpy as np
from sentence_transformers import SentenceTransformer

MODEL_NAME = "BAAI/bge-small-en-v1.5"
# bge models work best when a search query starts with this instruction
QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


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
    with open("questions.json", encoding="utf-8") as f:
        questions = json.load(f)
    vectors = np.load("embeddings.npy")
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
