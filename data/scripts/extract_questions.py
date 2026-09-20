"""
Extract UPSC Prelims questions from the UnlockIAS PYQ PDF into CSV and JSON.

Usage:
    pip install pypdf
    python extract_questions.py "path/to/question_bank.pdf"

Outputs (next to this script):
    questions.csv   - one row per question, opens in Excel
    questions.json  - same data, for the search app later
    problems.txt    - any questions that didn't parse cleanly
"""

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

from pypdf import PdfReader

# ---------- patterns that describe the PDF layout ----------
FOOTER = "UnlockIAS | www.unlockias.in/upsc-prelims-pyq"
HEADER = re.compile(
    r"^UPSC (?P<year>\d{4}) (?P<topic>.+?) (?P<difficulty>easy|moderate|difficult)$"
)
QSTART = re.compile(r"^Q(?P<num>\d+)\.\s*(?P<text>.*)$")
OPTION = re.compile(r"^\((?P<letter>[a-d])\)\s*(?P<text>.*)$")
ANSWER = re.compile(r"^Answer\s*:\s*(?P<raw>.*)$", re.IGNORECASE)
ANSWER_LETTER = re.compile(r"^\(([a-d])\)$", re.IGNORECASE)
NEW_LINE = re.compile(
    r"^(\d+\.|[A-D]\.|[IVX]+\.|List|Code|Select|Which|What|How many|Consider|"
    r"Statement|Assertion|Reason|[A-D] [A-D] [A-D] [A-D])"
)
SKIP = [
    re.compile(r"^UPSC Prelims PYQ Complete Collection$"),
    re.compile(r"^\d+ Questions \(\d{4}.\d{4}\) \| UnlockIAS$"),
    re.compile(r"^UnlockIAS . www\.unlockias\.in$"),
    re.compile(r"^UPSC Prelims \d{4}$"),  # year section headings
]


def read_lines(pdf_path):
    """Pull text out of every page and return clean, non-empty lines."""
    reader = PdfReader(pdf_path)
    lines = []
    for page in reader.pages:
        text = (page.extract_text() or "").replace(FOOTER, "\n")
        for line in text.splitlines():
            line = line.strip()
            if line and not any(p.match(line) for p in SKIP):
                lines.append(line)
    return lines


def parse(lines):
    """Walk the lines and build one record per question."""
    questions, current, section = [], None, None

    def finish():
        if current:
            questions.append(current)

    for line in lines:
        m = HEADER.match(line)
        if m:
            finish()
            topic = m["topic"]
            subject, _, subtopic = topic.partition(" › ")
            current = {
                "year": int(m["year"]),
                "q_no": None,
                "subject": subject.strip(),
                "subtopic": subtopic.strip(),
                "difficulty": m["difficulty"],
                "question": "",
                "a": "", "b": "", "c": "", "d": "",
                "answer": "",
                "answer_note": "",
                "status": "ok",
            }
            section = None
            continue
        if current is None:
            continue

        if m := QSTART.match(line):
            current["q_no"] = int(m["num"])
            current["question"] = m["text"]
            section = "question"
        elif m := OPTION.match(line):
            section = m["letter"]
            current[section] = m["text"]
        elif m := ANSWER.match(line):
            # Normal case is "Answer: (b)". Anything else (e.g. a dropped
            # question or two options) is kept as a note, answer left blank.
            raw = m["raw"].strip()
            if single := ANSWER_LETTER.match(raw):
                current["answer"] = single[1].lower()
            elif "cancel" in raw.lower() or "dropped" in raw.lower():
                current["status"] = "cancelled"
                current["answer_note"] = raw
            else:
                # e.g. "(c  (should read ...))" -> keep the letter, flag it
                current["status"] = "disputed"
                current["answer_note"] = raw
                if lead := re.match(r"^\(([a-d])\b", raw, re.IGNORECASE):
                    current["answer"] = lead[1].lower()
            section = None
        elif section:
            # Inside the question, keep a real line break before numbered
            # statements, list items and instruction lines; anything else is
            # just the PDF wrapping a long sentence, so join it with a space.
            if section == "question" and NEW_LINE.match(line):
                current[section] += "\n" + line
            else:
                current[section] += " " + line

    finish()
    return questions


def check(questions):
    """Return a list of problem descriptions."""
    problems = []
    for q in questions:
        tag = f"{q['year']} Q{q['q_no']}"
        needed = ["question", "a", "b", "c", "d"]
        if q["status"] == "ok":
            needed.append("answer")  # cancelled/disputed ones may have none
        missing = [k for k in needed if not q[k]]
        if q["q_no"] is None or missing:
            msg = f"{tag}: missing {missing or 'question number'}"
            if q["answer_note"]:
                msg += f" | answer line says: {q['answer_note']}"
            elif "answer" in missing:
                msg += f" | no answer line found | option (d) ends: ...{q['d'][-80:]}"
            problems.append(msg)
    seen = Counter((q["year"], q["q_no"]) for q in questions)
    problems += [f"{y} Q{n}: appears {c} times" for (y, n), c in seen.items() if c > 1]
    return problems


def main():
    if len(sys.argv) != 2:
        sys.exit('Usage: python extract_questions.py "question_bank.pdf"')
    pdf_path = sys.argv[1]
    out = Path(__file__).resolve().parent.parent

    print(f"Reading {pdf_path} ...")
    questions = parse(read_lines(pdf_path))
    for i, q in enumerate(questions, 1):
        q["id"] = i

    fields = ["id", "year", "q_no", "subject", "subtopic", "difficulty",
              "question", "a", "b", "c", "d", "answer", "status", "answer_note"]
    with open(out / "questions.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=fields)
        w.writeheader()
        w.writerows(questions)
    with open(out / "questions.json", "w", encoding="utf-8") as f:
        json.dump(questions, f, ensure_ascii=False, indent=1)

    problems = check(questions)
    (out / "problems.txt").write_text("\n".join(problems) or "No problems found.\n",
                                      encoding="utf-8")

    print(f"\nExtracted {len(questions)} questions")
    print("\nQuestions per year:")
    for year, n in sorted(Counter(q["year"] for q in questions).items()):
        print(f"  {year}: {n}")
    print("\nAnswer status:")
    for status, n in Counter(q["status"] for q in questions).most_common():
        print(f"  {status}: {n}")
    print(f"\nProblems found: {len(problems)} (see problems.txt)")


if __name__ == "__main__":
    main()
