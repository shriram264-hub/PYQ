import logging
import os
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app import search as search_module


def _warm():
    try:
        search_module.warm_model()
    except Exception:  # the first search loads it instead, and reports any error
        logging.getLogger(__name__).exception("model warm-up failed")


@asynccontextmanager
async def lifespan(_app):
    # Warm the model on a side thread: the port binds at once (Render waits for
    # it), and by the time a student has typed a query the model is usually
    # ready. The search page pings /api/meta on load to start exactly this.
    threading.Thread(target=_warm, daemon=True).start()
    yield


app = FastAPI(title="UPSC PYQ Search API", lifespan=lifespan)

_default_origins = "http://localhost:5173"
allowed_origins = [
    origin.strip()
    for origin in os.environ.get("ALLOWED_ORIGINS", _default_origins).split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@app.get("/api/search")
def api_search(
    q: str = "",
    top: int = 25,
    offset: int = 0,
    min_year: str = "",
    max_year: str = "",
    subject: str = "",
    difficulty: str = "",
):
    return search_module.search(
        q=q,
        top=top,
        offset=offset,
        min_year=int(min_year) if min_year else 0,
        max_year=int(max_year) if max_year else 9999,
        subject=subject,
        difficulty=difficulty,
    )


@app.get("/api/meta")
def api_meta():
    return search_module.meta()
