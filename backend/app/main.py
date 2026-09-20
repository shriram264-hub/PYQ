from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import search as search_module

app = FastAPI(title="UPSC PYQ Search API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/search")
def api_search(
    q: str = "",
    top: int = 25,
    min_year: int = 0,
    max_year: int = 9999,
    subject: str = "",
    difficulty: str = "",
):
    return search_module.search(
        q=q,
        top=top,
        min_year=min_year,
        max_year=max_year,
        subject=subject,
        difficulty=difficulty,
    )


@app.get("/api/meta")
def api_meta():
    return search_module.meta()
