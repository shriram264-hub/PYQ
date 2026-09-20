from app.data import QUESTIONS
from app.search import keyword_score, meta, search


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
