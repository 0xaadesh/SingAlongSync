"""
User settings for AI translation, stored in server/settings.json (gitignored).

API keys are kept per provider so switching providers doesn't lose a saved key,
and they never leave the server unmasked.
"""
import json
import threading
from pathlib import Path, PureWindowsPath

from src.config import DATA_DIR
from src.status import write_json_atomic

SETTINGS_PATH = DATA_DIR / "settings.json"
# cookies.txt picked or pasted in Settings (gitignored)
COOKIES_PATH = DATA_DIR / "cookies.txt"

PROVIDERS = {
    "openai": "OpenAI",
    "google": "Google",
    "anthropic": "Anthropic",
    "groq": "Groq",
    "xai": "xAI",
    "openrouter": "OpenRouter",
    # Any server speaking the OpenAI chat API (Ollama, LM Studio, vLLM, LiteLLM…) at baseUrl
    "custom": "OpenAI-compatible",
}

# Providers that work without an API key (local servers often need none)
KEY_OPTIONAL = {"custom"}

DEFAULTS = {
    "provider": None,
    "model": None,
    "translationEnabled": False,
    "apiKeys": {},
    # Endpoint for the OpenAI-compatible provider, e.g. http://localhost:11434/v1
    "baseUrl": None,
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


def translation_problem(settings):
    """Why translation can't run yet, as a sentence for the user, or None when it can."""
    provider = settings["provider"]
    name = PROVIDERS.get(provider, provider)
    if not settings["translationEnabled"]:
        return "Turn on AI translation in Settings first."
    if not provider:
        return "Choose an AI provider in Settings first."
    if provider == "custom" and not settings.get("baseUrl"):
        return "Add your server's URL in Settings first."
    if provider not in KEY_OPTIONAL and not api_key(settings):
        return f"Add an API key for {name} in Settings first."
    if not settings["model"]:
        # Switching providers clears the model, so this is the usual one
        return f"AI translation is on but has no model. Pick one for {name} in Settings."
    return None


def translation_ready(settings):
    """Translation runs only when switched on and fully configured."""
    return translation_problem(settings) is None


def cookies_file(settings):
    """
    The cookies.txt to use, or None. The one saved from Settings is stored by name and lives
    in the data folder, so the same settings work on the host and inside Docker.
    """
    value = settings.get("cookiesFile")
    if not value:
        return None
    path = Path(value)
    # A Windows path isn't "absolute" to Linux, so check both kinds
    absolute = path.is_absolute() or PureWindowsPath(value).is_absolute()
    if not absolute:
        return DATA_DIR / path
    # Saved as an absolute path by an older version, or on the other side of a Docker mount
    if not path.exists() and PureWindowsPath(value).name == COOKIES_PATH.name and COOKIES_PATH.exists():
        return COOKIES_PATH
    return path


def youtube_cookie_count(path):
    """How many youtube.com cookies a cookies.txt holds, or None when it can't be read."""
    try:
        text = Path(path).read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None
    return sum(1 for line in text.splitlines() if "youtube.com" in line.split("\t", 1)[0])


def public(settings):
    """Settings safe to send to the browser: keys masked, cookie contents never included."""
    cookies = cookies_file(settings)
    return {
        "provider": settings["provider"],
        "model": settings["model"],
        "translationEnabled": settings["translationEnabled"],
        "ready": translation_ready(settings),
        "keys": {p: mask(api_key(settings, p)) for p in PROVIDERS},
        "providers": [{"id": p, "name": name} for p, name in PROVIDERS.items()],
        "baseUrl": settings.get("baseUrl"),
        "cookiesBrowser": settings.get("cookiesBrowser"),
        "cookiesFile": str(cookies) if cookies else None,
        "cookiesCount": youtube_cookie_count(cookies) if cookies else None,
        "cookieBrowsers": COOKIE_BROWSERS,
        "alignmentMode": settings.get("alignmentMode") or "auto",
    }
