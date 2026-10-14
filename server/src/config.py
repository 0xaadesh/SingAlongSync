import os
from pathlib import Path

from dotenv import load_dotenv

# All paths are anchored to the server/ folder so commands work from any CWD.
SERVER_ROOT = Path(__file__).resolve().parent.parent
CLI_PATH = SERVER_ROOT / "src" / "cli.py"

load_dotenv(SERVER_ROOT / ".env")

# Songs, caches, settings and cookies. The server/ folder itself by default; Docker points
# this at a mounted folder so the library lives on the host, not inside the container.
DATA_DIR = Path(os.getenv("SAS_DATA_DIR") or SERVER_ROOT)
DOWNLOADS_DIR = DATA_DIR / "downloads"
CACHE_DIR = DATA_DIR / "cache"

# pydantic-ai prints a promo banner to stdout otherwise
os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

# Origins allowed to call the API (the Next.js web app). Comma-separated.
WEB_ORIGINS = os.getenv("WEB_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",")

DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
