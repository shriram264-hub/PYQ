import numpy as np
from fastapi.testclient import TestClient

from app.data import QUESTIONS, VECTORS
from app.main import app
from app.search import QUERY_PREFIX, embed_query, keyword_score, meta, search

client = TestClient(app)


def test_meta_reports_correct_count_and_year_range():
    result = meta()
    assert result["count"] == len(QUESTIONS)
    assert result["min_year"] <= result["max_year"]


def test_search_empty_query_respects_year_filter():
    sample_year = QUESTIONS[0]["year"]
    result = search(q="", min_year=sample_year, max_year=sample_year, top=200)
    assert result["total_filtered"] > 0
    assert all(r["year"] == sample_year for r in result["results"])


def test_search_respects_subject_filter():
    sample_subject = QUESTIONS[0]["subject"]
    result = search(q="", subject=sample_subject, top=5)
    assert all(r["subject"] == sample_subject for r in result["results"])


def test_search_top_caps_result_count():
    result = search(q="", top=3)
    assert len(result["results"]) <= 3


def test_keyword_score_counts_matching_words():
    scores = keyword_score("harappan civilisation")
    assert scores.shape[0] == len(QUESTIONS)
    assert scores.max() <= 1.0
    assert scores.min() >= 0.0


def test_meta_endpoint_returns_expected_shape():
    body = client.get("/api/meta").json()
    assert set(body) == {"count", "min_year", "max_year", "subjects"}


def test_search_endpoint_with_blank_year_params_returns_200():
    r = client.get("/api/search", params={"q": "", "min_year": "", "max_year": "", "top": 3})
    assert r.status_code == 200
    body = r.json()
    assert "results" in body
    assert len(body["results"]) <= 3


def test_search_endpoint_with_real_year_range():
    r = client.get("/api/search", params={"q": "", "min_year": 2015, "max_year": 2015, "top": 200})
    assert r.status_code == 200
    body = r.json()
    assert all(result["year"] == 2015 for result in body["results"])


def test_query_embedding_matches_stored_vector_space():
    """The query encoder must produce vectors comparable to data/embeddings.npy.

    embeddings.npy was built by sentence-transformers (PyTorch) while queries are
    now embedded via fastembed (ONNX). Both use BAAI/bge-small-en-v1.5, so the
    same text must land in the same place - otherwise every score silently
    becomes meaningless rather than failing loudly.
    """
    q = QUESTIONS[0]
    options = " | ".join(q[k] for k in "abcd" if q[k])
    # Exactly how data/scripts/build_index.py built the stored vector for this row
    text = f"{q['subject']} - {q['subtopic']}. {q['question']} Options: {options}"

    vec = embed_query(text)
    assert np.isclose(np.linalg.norm(vec), 1.0, atol=1e-3), "expected an L2-normalised vector"
    assert float(vec @ VECTORS[0]) > 0.99


def test_text_search_ranks_relevant_questions_first():
    result = search(q="Harappan civilisation", top=5)
    assert result["results"], "expected matches for a topic known to be in the bank"
    assert result["results"] == sorted(
        result["results"], key=lambda r: r["score"], reverse=True
    )
    top_subjects = {r["subject"] for r in result["results"][:3]}
    assert "Ancient History" in top_subjects


def test_search_endpoint_with_text_query():
    r = client.get("/api/search", params={"q": "tiger reserves", "top": 5})
    assert r.status_code == 200
    body = r.json()
    assert body["query"] == "tiger reserves"
    assert 0 < len(body["results"]) <= 5


def test_offset_returns_the_next_window_without_overlap():
    first = search(q="", top=5, offset=0)
    second = search(q="", top=5, offset=5)

    first_ids = [r["id"] for r in first["results"]]
    second_ids = [r["id"] for r in second["results"]]

    assert len(first_ids) == 5
    assert len(second_ids) == 5
    assert set(first_ids).isdisjoint(second_ids), "paging must not repeat questions"


def test_offset_reports_the_full_match_count_not_the_page_size():
    """Without this the UI cannot know how many pages exist."""
    result = search(q="", top=5, offset=0)
    assert result["total_results"] > 5
    assert result["page_size"] == 5
    assert result["offset"] == 0


def test_offset_beyond_the_end_returns_no_results_rather_than_failing():
    result = search(q="", top=25, offset=10_000)
    assert result["results"] == []
    assert result["total_results"] > 0


def test_offset_paging_is_reachable_through_the_endpoint():
    r = client.get("/api/search", params={"q": "", "top": 3, "offset": 3})
    assert r.status_code == 200
    body = r.json()
    assert body["offset"] == 3
    assert len(body["results"]) == 3


def test_embed_query_is_prefixed_consistently():
    """Query and passage encodings differ for bge models; keep the prefix applied."""
    plain = embed_query("monsoon")
    prefixed = embed_query(QUERY_PREFIX + "monsoon")
    assert float(plain @ prefixed) < 0.9999, "prefix should change the query vector"
