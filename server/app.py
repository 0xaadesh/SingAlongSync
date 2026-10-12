"""
SingAlongSync backend entry point.

Usage (from server/):
    uv run app.py
"""
import uvicorn

from src.api import app

if __name__ == "__main__":
    # Start uvicorn server on localhost:8000
    uvicorn.run(app, host="127.0.0.1", port=8000)
