import os
from pathlib import Path

from dotenv import load_dotenv

# All paths are anchored to the server/ folder so commands work from any CWD.
SERVER_ROOT = Path(__file__).resolve().parent.parent
DOWNLOADS_DIR = SERVER_ROOT / "downloads"
CLI_PATH = SERVER_ROOT / "src" / "cli.py"

load_dotenv(SERVER_ROOT / ".env")

# pydantic-ai prints a promo banner to stdout otherwise
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

# Origins allowed to call the API (the Next.js web app). Comma-separated.
WEB_ORIGINS = os.getenv("WEB_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

DOWNLOADS_DIR.mkdir(exist_ok=True)
