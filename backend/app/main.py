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
    min_year: str = "",
    max_year: str = "",
    subject: str = "",
    difficulty: str = "",
):
    return search_module.search(
        q=q,
        top=top,
        min_year=int(min_year) if min_year else 0,
        max_year=int(max_year) if max_year else 9999,
        subject=subject,
        difficulty=difficulty,
    )


@app.get("/api/meta")
def api_meta():
    return search_module.meta()
