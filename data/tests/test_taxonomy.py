import sys, pytest
from collections import Counter
sys.path.insert(0, str(__import__('pathlib').Path(__file__).resolve().parents[1] / 'scripts'))
from extract_questions import apply_taxonomy, load_taxonomy

TAX = {
    "subjects": ["A", "B"],
    "allowed": [["A", "x"], ["B", "y"]],
    "topics": {"Raw|x": ["A", "x"], "Raw|old": ["B", "y"], "Other|z": ["A", "x"]},
    "questions": {"2020-2": ["A", "x"]},
}

# For the tests that are not about overrides: an override that matches no question
# is itself an error, so they use a mapping with none.
NO_OVERRIDES = {**TAX, "questions": {}}

def q(year, n, s, t):
    return {"year": year, "q_no": n, "subject": s, "subtopic": t}

def five(s, t, start=100):
    return [q(2000, start + i, s, t) for i in range(5)]

def test_maps_pairs_and_applies_overrides_only_inside_remapped_pairs():
    qs = five("Raw", "x") + five("Raw", "old", 200) + [q(2020, 2, "Raw", "old"), q(2020, 3, "Other", "z")]
    counts = apply_taxonomy(qs, TAX)
    assert qs[-2]["subject"] == "A" and qs[-2]["subtopic"] == "x"   # override applied (Raw|old is remapped)
    assert qs[5]["subject"] == "B" and qs[5]["subtopic"] == "y"
    assert counts == Counter({"A": 7, "B": 5})

def test_unmapped_pair_fails():
    with pytest.raises(SystemExit, match="no taxonomy mapping"):
        apply_taxonomy(five("Raw", "x") + [q(2001, 1, "Raw", "new")], NO_OVERRIDES)

def test_result_outside_allowed_fails():
    bad = {**NO_OVERRIDES, "topics": {**TAX["topics"], "Raw|x": ["A", "nope"]}}
    with pytest.raises(SystemExit, match="not an approved"):
        apply_taxonomy(five("Raw", "x"), bad)

def test_small_topic_fails():
    with pytest.raises(SystemExit, match="fewer than 5"):
        apply_taxonomy(five("Raw", "x") + [q(2001, 9, "Raw", "old")], NO_OVERRIDES)

def test_topic_with_zero_questions_fails():
    # B / y is allowed and nothing reaches it, so it has no questions at all.
    with pytest.raises(SystemExit, match=r"fewer than 5.*B / y \(0\)"):
        apply_taxonomy(five("Raw", "x"), NO_OVERRIDES)

# The cases below are not in the brief. They pin down what "remapped" means for
# the two ways a pair can move without its topic name changing.

def test_subject_outside_subjects_fails():
    bad = {**NO_OVERRIDES, "subjects": ["B"]}
    with pytest.raises(SystemExit, match="not an approved subject"):
        apply_taxonomy(five("Raw", "x"), bad)

def test_override_on_a_pair_that_only_renames_an_alias_subject_fails():
    # "Raw" is an alias, not an approved subject: Raw|x -> A|x keeps the topic, so it is not
    # re-homed and the override could never apply. That is a stale entry, so the run stops.
    tax = {
        "subjects": ["A"],
        "allowed": [["A", "x"], ["A", "w"]],
        "topics": {"Raw|x": ["A", "x"], "Raw|w": ["A", "w"]},
        "questions": {"2020-2": ["A", "w"]},
    }
    qs = five("Raw", "x") + five("Raw", "w", 200) + [q(2020, 2, "Raw", "x")]
    with pytest.raises(SystemExit, match=r"2020-2.*Raw\|x.*not re-homed"):
        apply_taxonomy(qs, tax)
    assert all(r["subject"] == "Raw" for r in qs)

def test_override_applies_when_only_the_subject_moves():
    # "A" is an approved subject: A|x -> B|x moves the question to another subject, so it is remapped.
    tax = {
        "subjects": ["A", "B"],
        "allowed": [["B", "x"], ["B", "w"]],
        "topics": {"A|x": ["B", "x"], "B|w": ["B", "w"]},
        "questions": {"2020-2": ["B", "w"]},
    }
    qs = five("A", "x") + five("B", "w", 200) + [q(2020, 2, "A", "x")]
    apply_taxonomy(qs, tax)
    assert qs[-1]["subject"] == "B" and qs[-1]["subtopic"] == "w"

def test_override_matching_no_question_fails():
    tax = {**TAX, "questions": {"2020-2": ["A", "x"], "1999-77": ["A", "x"]}}
    qs = five("Raw", "x") + five("Raw", "old", 200) + [q(2020, 2, "Raw", "old")]
    with pytest.raises(SystemExit, match=r"1999-77.*no question"):
        apply_taxonomy(qs, tax)
    assert all(r["subject"] == "Raw" for r in qs)

@pytest.mark.parametrize("dest", [["A"], ["A", "x", "z"], "A|x", None, ["A", 3], [["A"], "x"], {"A": "x"}])
def test_malformed_topics_destination_fails_naming_the_key(dest):
    bad = {**NO_OVERRIDES, "topics": {**TAX["topics"], "Raw|x": dest}}
    with pytest.raises(SystemExit, match=r"topics.*Raw\|x.*\[subject, topic\]"):
        apply_taxonomy(five("Raw", "x"), bad)

@pytest.mark.parametrize("dest", [["A"], ["A", "x", "z"], "A|x", ["A", None]])
def test_malformed_override_destination_fails_naming_the_key(dest):
    bad = {**TAX, "questions": {"2020-2": dest}}
    qs = five("Raw", "x") + five("Raw", "old", 200) + [q(2020, 2, "Raw", "old")]
    with pytest.raises(SystemExit, match=r"questions.*2020-2.*\[subject, topic\]"):
        apply_taxonomy(qs, bad)

def test_failed_run_leaves_the_questions_untouched():
    qs = five("Raw", "x") + [q(2001, 9, "Raw", "old")]
    with pytest.raises(SystemExit):
        apply_taxonomy(qs, NO_OVERRIDES)
    assert all(r["subject"] == "Raw" for r in qs)

def test_missing_taxonomy_file_fails_with_a_clear_message(tmp_path):
    with pytest.raises(SystemExit, match=r"taxonomy\.json.*not found"):
        load_taxonomy(tmp_path / "taxonomy.json")

def test_load_taxonomy_reads_the_file(tmp_path):
    path = tmp_path / "taxonomy.json"
    path.write_text('{"subjects": ["A"]}', encoding="utf-8")
    assert load_taxonomy(path) == {"subjects": ["A"]}

def test_committed_taxonomy_is_self_consistent():
    import json
    path = __import__('pathlib').Path(__file__).resolve().parents[1] / "taxonomy.json"
    tax = json.loads(path.read_text(encoding="utf-8"))
    allowed = {tuple(p) for p in tax["allowed"]}
    assert len(tax["subjects"]) == 11 and len(allowed) == 116
    assert {s for s, _ in allowed} == set(tax["subjects"])
    assert {tuple(d) for d in tax["topics"].values()} == allowed   # every approved topic is reached
    assert all(tuple(d) in allowed for d in tax["questions"].values())
    assert len(tax["questions"]) == 16
