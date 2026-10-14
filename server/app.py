"""
SingAlongSync backend entry point.

Usage (from server/):
    uv run app.py
"""
import os

import uvicorn

from src.api import app

if __name__ == "__main__":
    # localhost only by default; Docker sets HOST=0.0.0.0 so the web container can reach it
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
