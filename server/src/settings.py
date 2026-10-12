"""
User settings for AI translation, stored in server/settings.json (gitignored).

API keys are kept per provider so switching providers doesn't lose a saved key,
and they never leave the server unmasked.
"""
import json
import threading

from src.config import SERVER_ROOT
from src.status import write_json_atomic

SETTINGS_PATH = SERVER_ROOT / "settings.json"

PROVIDERS = {
    "openai": "OpenAI",
    "google": "Google",
    "anthropic": "Anthropic",
    "groq": "Groq",
    "xai": "xAI",
    "openrouter": "OpenRouter",
}

DEFAULTS = {"provider": None, "model": None, "translationEnabled": False, "apiKeys": {}}

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


def public(settings):
    """Settings safe to send to the browser: keys masked."""
    return {
        "provider": settings["provider"],
        "model": settings["model"],
        "translationEnabled": settings["translationEnabled"],
        "ready": translation_ready(settings),
        "keys": {p: mask(api_key(settings, p)) for p in PROVIDERS},
        "providers": [{"id": p, "name": name} for p, name in PROVIDERS.items()],
    }
