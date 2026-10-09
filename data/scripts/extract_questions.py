"""
Extract UPSC Prelims questions from the UnlockIAS PYQ PDF into CSV and JSON.

Usage:
    pip install pypdf
    python extract_questions.py "path/to/question_bank.pdf"

Subjects and topics are relabelled from data/taxonomy.json after the corrections
are applied; the run stops if the mapping is incomplete or its result drifts from
the approved list.

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
    r"^UPSC (?P<year>\d{4}) (?P<topic>.+?) (?P<difficulty>easy|moderate|medium|difficult|hard)$"
)
# The PDF mostly says easy/moderate/difficult, but 19 headers say "medium" or
# "hard". An unmatched header is silent and destructive: the next "Q<n>." line
# overwrites the previous record, so one question vanishes and the next one
# inherits its neighbour's subject, difficulty and status. Normalise the
# synonyms to the three levels the site uses.
DIFFICULTY = {"medium": "moderate", "hard": "difficult"}
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
    starts = 0  # every "Q<n>." line seen; must equal the number of records

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
                "difficulty": DIFFICULTY.get(m["difficulty"], m["difficulty"]),
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
            starts += 1
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
    if starts != len(questions):
        sys.exit(
            f"{starts} question starts but {len(questions)} records: a question header "
            "was not recognised, so questions were overwritten. Fix HEADER before using this output."
        )
    return questions


def apply_corrections(questions, path):
    """Apply data/corrections.json: verified fixes for text the PDF gets wrong."""
    if not path.exists():
        return 0
    by_key = {(q["year"], q["q_no"]): q for q in questions}
    patches = json.loads(path.read_text(encoding="utf-8"))["patches"]
    for p in patches:
        key = (p["year"], p["q_no"])
        q = by_key.get(key)
        if "add" in p:
            # A question the PDF omits entirely, sourced and verified elsewhere.
            if q is not None:
                sys.exit(f"corrections.json: {p['year']} Q{p['q_no']} already exists; use set, not add")
            record = {"year": p["year"], "q_no": p["q_no"], "answer_note": "", "status": "ok", **p["add"]}
            # Keep paper order: after the nearest earlier question of that year.
            before = [i for i, r in enumerate(questions) if r["year"] == p["year"] and r["q_no"] < p["q_no"]]
            questions.insert(before[-1] + 1 if before else len(questions), record)
            by_key[key] = record
            continue
        if q is None:
            sys.exit(f"corrections.json: {p['year']} Q{p['q_no']} is not in the extracted data")
        if p.get("drop"):
            # A record that is not a real question (e.g. the PDF repeating
            # another question under this number). The number stays a gap.
            questions.remove(q)
            continue
        if "set" in p:
            # The PDF holds the wrong question under this number (a copy of
            # another one); replace the record's content wholesale.
            q.update(p["set"])
            continue
        for find, repl in p["replace"]:
            hits = q[p["field"]].count(find)
            if hits != 1:
                sys.exit(
                    f"corrections.json: {p['year']} Q{p['q_no']} {p['field']}: expected the "
                    f"text to fix exactly once, found it {hits} times; the source has changed"
                )
            q[p["field"]] = q[p["field"]].replace(find, repl)
    return len(patches)


MIN_TOPIC_QUESTIONS = 5


def load_taxonomy(path):
    """Read data/taxonomy.json, stopping with a clear message if it is not there."""
    if not path.exists():
        sys.exit(f"{path} not found: the subjects and topics come from data/taxonomy.json, "
                 "so extraction cannot run without it")
    return json.loads(path.read_text(encoding="utf-8"))


def _destination(where, dest):
    """A taxonomy destination must be exactly [subject, topic]; anything else is a typo in the file."""
    if not (isinstance(dest, list) and len(dest) == 2 and all(isinstance(x, str) for x in dest)):
        sys.exit(f"taxonomy.json {where}: expected a [subject, topic] pair of two strings, got {dest!r}")
    return dest[0], dest[1]


def apply_taxonomy(questions, taxonomy):
    """Relabel every question with the approved subject and topic (data/taxonomy.json).

    The PDF's own labels are kept only as the lookup key ("<subject>|<topic>"), so
    the output never carries a raw alias such as Polity or Science. Mutates
    `subject` and `subtopic` in place and returns the number of questions per
    subject. Exits, leaving every question untouched, if the mapping is not total
    or its result drifts from the approved list.
    """
    subjects = set(taxonomy["subjects"])
    allowed = [tuple(p) for p in taxonomy["allowed"]]
    allowed_set = set(allowed)
    topics = {key: _destination(f"topics['{key}']", dest) for key, dest in taxonomy["topics"].items()}
    overrides = {key: _destination(f"questions['{key}']", dest)
                 for key, dest in taxonomy.get("questions", {}).items()}

    labels = []
    for q in questions:
        tag = f"{q['year']} Q{q['q_no']}"
        raw_subject, raw_topic = q["subject"], q["subtopic"]
        key = f"{raw_subject}|{raw_topic}"
        if key not in topics:
            sys.exit(f"{tag}: '{key}' has no taxonomy mapping; add it to data/taxonomy.json")
        subject, topic = topics[key]

        # A hand-placed question overrides its topic's mapping only when that
        # pair is being re-homed, that is when the move actually changes where
        # its questions live: the topic name changes, or the pair leaves an
        # approved subject. A raw alias that merely takes its approved name
        # (Polity -> Indian Polity, same topic) is not re-homed, so an override
        # there could never apply. It is a stale entry, so the run stops and
        # names it rather than silently ignoring it.
        rehomed = topic != raw_topic or (raw_subject in subjects and subject != raw_subject)
        override_key = f"{q['year']}-{q['q_no']}"
        if override_key in overrides:
            if not rehomed:
                sys.exit(f"taxonomy.json questions['{override_key}']: {tag} sits in '{key}', which is "
                         "not re-homed (its topic name and approved subject stay the same), so this "
                         "override would be ignored; remove it, or re-home the pair in topics")
            subject, topic = overrides[override_key]

        if subject not in subjects:
            sys.exit(f"{tag}: '{subject}' is not an approved subject (taxonomy.json subjects)")
        if (subject, topic) not in allowed_set:
            sys.exit(f"{tag}: {subject} / {topic} is not an approved subject and topic "
                     f"pair (taxonomy.json allowed), reached from '{key}'")
        labels.append((subject, topic))

    present = {f"{q['year']}-{q['q_no']}" for q in questions}
    orphans = sorted(set(overrides) - present)
    if orphans:
        sys.exit("taxonomy.json questions: " + ", ".join(f"'{k}'" for k in orphans)
                 + " match no question in the extracted data; fix the year-number or remove the entry")

    per_topic = Counter(labels)
    small = [f"{s} / {t} ({per_topic[(s, t)]})" for s, t in allowed
             if per_topic[(s, t)] < MIN_TOPIC_QUESTIONS]
    if small:
        sys.exit(f"Topics with fewer than {MIN_TOPIC_QUESTIONS} questions: " + "; ".join(small))

    for q, (subject, topic) in zip(questions, labels):
        q["subject"], q["subtopic"] = subject, topic
    return Counter(subject for subject, _ in labels)


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

    taxonomy = load_taxonomy(out / "taxonomy.json")  # before the slow PDF read, so a missing file fails fast
    print(f"Reading {pdf_path} ...")
    questions = parse(read_lines(pdf_path))
    fixed = apply_corrections(questions, out / "corrections.json")
    print(f"Applied {fixed} correction(s) from corrections.json")
    subject_counts = apply_taxonomy(questions, taxonomy)
    print(f"Relabelled {len(questions)} questions with taxonomy.json")
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
    print("\nQuestions per subject:")
    for subject, n in subject_counts.most_common():
        print(f"  {subject}: {n}")
    print("\nAnswer status:")
    for status, n in Counter(q["status"] for q in questions).most_common():
        print(f"  {status}: {n}")
    print(f"\nProblems found: {len(problems)} (see problems.txt)")


if __name__ == "__main__":
    main()
