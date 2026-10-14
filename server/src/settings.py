"""
User settings for AI translation, stored in server/settings.json (gitignored).

API keys are kept per provider so switching providers doesn't lose a saved key,
and they never leave the server unmasked.
"""
import json
import threading
from pathlib import Path

from src.config import SERVER_ROOT
from src.status import write_json_atomic

SETTINGS_PATH = SERVER_ROOT / "settings.json"
# cookies.txt picked or pasted in Settings (gitignored)
COOKIES_PATH = SERVER_ROOT / "cookies.txt"

PROVIDERS = {
    "openai": "OpenAI",
    "google": "Google",
    "anthropic": "Anthropic",
    "groq": "Groq",
    "xai": "xAI",
    "openrouter": "OpenRouter",
}

DEFAULTS = {
    "provider": None,
    "model": None,
    "translationEnabled": False,
    "apiKeys": {},
    # yt-dlp cookies for when YouTube asks to confirm you're not a bot
    "cookiesBrowser": None,
    "cookiesFile": None,
    # How lyrics are aligned: auto | native | romanized (see src/align.py)
    "alignmentMode": "auto",
}

COOKIE_BROWSERS = ["firefox", "chrome", "edge", "brave", "opera", "vivaldi", "chromium", "safari"]

_lock = threading.Lock()


def load():
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        data = {}
    return {**DEFAULTS, **data}


def save(settings):
    with _lock:
        write_json_atomic(SETTINGS_PATH, settings)


def mask(key):
    if not key:
        return None
    return f"{key[:4]}…{key[-4:]}" if len(key) > 12 else "••••"


def api_key(settings, provider=None):
    return (settings.get("apiKeys") or {}).get(provider or settings.get("provider"))


def translation_ready(settings):
    """Translation runs only when switched on and fully configured."""
    return bool(settings["translationEnabled"] and settings["provider"] and settings["model"] and api_key(settings))


def youtube_cookie_count(path):
    """How many youtube.com cookies a cookies.txt holds, or None when it can't be read."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return sum(1 for line in text.splitlines() if "youtube.com" in line.split("\t", 1)[0])


def public(settings):
    """Settings safe to send to the browser: keys masked, cookie contents never included."""
    cookies_file = settings.get("cookiesFile")
    return {
        "provider": settings["provider"],
        "model": settings["model"],
        "translationEnabled": settings["translationEnabled"],
        "ready": translation_ready(settings),
        "keys": {p: mask(api_key(settings, p)) for p in PROVIDERS},
        "providers": [{"id": p, "name": name} for p, name in PROVIDERS.items()],
        "cookiesBrowser": settings.get("cookiesBrowser"),
        "cookiesFile": cookies_file,
        "cookiesCount": youtube_cookie_count(cookies_file) if cookies_file else None,
        "cookieBrowsers": COOKIE_BROWSERS,
        "alignmentMode": settings.get("alignmentMode") or "auto",
    }
