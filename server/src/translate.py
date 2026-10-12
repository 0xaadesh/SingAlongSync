"""
English translations for non-English lyric lines.

One structured-output call per song: the model sees every numbered line (so it
translates with the whole song as context) and returns English only for lines
that aren't already English. That covers native scripts and romanised lyrics
(e.g. Hindi written in Latin letters), which no script check can tell apart
from English. An empty list means the song is entirely English.
"""
import json
import time

import requests
from pydantic import BaseModel, Field

from src import settings as settings_store
from src.status import write_json_atomic


class LineTranslation(BaseModel):
    line: int = Field(description="The number of the lyric line, exactly as given in the input.")
    english: str = Field(description="Natural English translation of that line.")
    romanized: str | None = Field(
        default=None,
        description="Only for lines written in a non-Latin script (Devanagari, Gurmukhi, Malayalam, Tamil...): "
        "how the line is pronounced, written in everyday Latin letters as fans would type it. Null otherwise.",
    )


class SongTranslation(BaseModel):
    translations: list[LineTranslation] = Field(
        description="Only lines that are not already in English. Empty if every line is English."
    )


SYSTEM_PROMPT = """You translate song lyrics into English.

You get a song's lyrics as numbered lines. For each line that is NOT already in English,
return its English translation, keeping the line's number. Skip lines that are already English.

Rules:
- Lyrics can mix languages line by line (Bollywood songs often have English lines between
  Hindi or Punjabi ones). Judge every line on its own.
- Romanised lyrics count as non-English: "Tujhe dekha to ye jaana sanam" is Hindi written in
  Latin letters and must be translated.
- Lines that are mostly English with a few borrowed words stay untranslated.
- Vocalisations and fillers ("oh", "na na na", "hey") need no translation.
- Translate naturally and poetically, keeping each line's meaning and mood; don't explain.
- Use the surrounding lines as context, but translate each line separately.
- For lines written in a non-Latin script, also give `romanized`: the pronunciation in plain Latin
  letters, the way people casually type that language (e.g. "Tujhe dekha to ye jaana sanam"),
  without diacritics. Use exactly one romanised word per original word, in the same order, so
  the words line up. Leave `romanized` null for lines already in Latin letters."""

# Bump when translations.json gains fields; older files are refreshed by "Translate all".
TRANSLATIONS_VERSION = 2


def has_non_latin(text):
    """True if the text contains letters outside the Latin alphabet (e.g. Devanagari)."""
    return any(ch.isalpha() and ord(ch) > 0x24F for ch in text)


def build_model(provider, model_name, key):
    """A pydantic-ai model for the chosen provider."""
    if provider == "openai":
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        return OpenAIChatModel(model_name, provider=OpenAIProvider(api_key=key))
    if provider == "xai":
        # xAI speaks the OpenAI API; this avoids the separate xai-sdk dependency
        from pydantic_ai.models.openai import OpenAIChatModel
        from pydantic_ai.providers.openai import OpenAIProvider

        return OpenAIChatModel(model_name, provider=OpenAIProvider(base_url="https://api.x.ai/v1", api_key=key))
    if provider == "anthropic":
        from pydantic_ai.models.anthropic import AnthropicModel
        from pydantic_ai.providers.anthropic import AnthropicProvider

        return AnthropicModel(model_name, provider=AnthropicProvider(api_key=key))
    if provider == "google":
        from pydantic_ai.models.google import GoogleModel
        from pydantic_ai.providers.google import GoogleProvider

        return GoogleModel(model_name, provider=GoogleProvider(api_key=key))
    if provider == "groq":
        from pydantic_ai.models.groq import GroqModel
        from pydantic_ai.providers.groq import GroqProvider

        return GroqModel(model_name, provider=GroqProvider(api_key=key))
    if provider == "openrouter":
        from pydantic_ai.models.openrouter import OpenRouterModel
        from pydantic_ai.providers.openrouter import OpenRouterProvider

        return OpenRouterModel(model_name, provider=OpenRouterProvider(api_key=key, app_title="SingAlongSync"))
    raise ValueError(f"Unknown provider: {provider}")


def translate_song(work_dir, settings=None):
    """Translate one song's lyrics and write translations.json. Returns the line count translated."""
    from pydantic_ai import Agent

    settings = settings or settings_store.load()
    provider, model_name = settings["provider"], settings["model"]
    key = settings_store.api_key(settings)
    if not (provider and model_name and key):
        raise RuntimeError("AI translation isn't configured. Pick a provider, model and API key in Settings.")

    lines = lyric_lines(work_dir)
    meta = json.loads((work_dir / "metadata.json").read_text(encoding="utf-8"))
    numbered = "\n".join(f"{i}: {line['line']}" for i, line in enumerate(lines))
    prompt = f'Song: "{meta.get("title")}" by {meta.get("artist")}\n\nLyrics:\n{numbered}'

    agent = Agent(build_model(provider, model_name, key), output_type=SongTranslation, system_prompt=SYSTEM_PROMPT)
    result = agent.run_sync(prompt).output

    # Keep only valid line numbers; drop "translations" identical to the original, and
    # romanisations for lines that were already in Latin letters.
    translated, romanized = {}, {}
    for t in result.translations:
        if not 0 <= t.line < len(lines):
            continue
        original = lines[t.line]["line"].strip()
        if t.english.strip() and t.english.strip() != original:
            translated[str(t.line)] = t.english.strip()
        if t.romanized and t.romanized.strip() and has_non_latin(original):
            romanized[str(t.line)] = t.romanized.strip()

    write_json_atomic(work_dir / "translations.json", {
        "version": TRANSLATIONS_VERSION,
        "provider": provider,
        "model": model_name,
        "createdAt": time.time(),
        "lines": translated,
        "romanized": romanized,
    })
    return len(translated)


def lyric_lines(work_dir):
    """
    Lines to translate, as {"line": text}: karaoke.json once aligned (indices match the
    player), else the synced .lrc (translation now runs before alignment, which keeps
    one karaoke line per .lrc line, so indices stay the same).
    """
    karaoke = work_dir / "karaoke.json"
    if karaoke.exists():
        return json.loads(karaoke.read_text(encoding="utf-8"))
    from src.lyrics import parse_lrc

    lrc = (work_dir / "synced.lrc").read_text(encoding="utf-8")
    return [{"line": line["text"]} for line in parse_lrc(lrc) if line["text"].strip()]


def needs_translation(work_dir):
    """No translations yet, or an older file missing romanisations for a non-Latin-script song."""
    path = work_dir / "translations.json"
    if not path.exists():
        return True
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return True
    if data.get("version", 1) >= TRANSLATIONS_VERSION:
        return False
    return any(has_non_latin(line["line"]) for line in lyric_lines(work_dir))


# ---------------------------------------------------------------------------
# Model listing, so the settings page can offer a provider's real models
# ---------------------------------------------------------------------------

OPENAI_COMPATIBLE = {
    "openai": "https://api.openai.com/v1/models",
    "groq": "https://api.groq.com/openai/v1/models",
    "xai": "https://api.x.ai/v1/models",
}

# OpenAI's list includes embeddings, audio, image and moderation models
NON_CHAT_HINTS = ("embedding", "whisper", "tts", "dall-e", "image", "moderation", "audio", "realtime",
                  "transcribe", "search", "davinci", "babbage", "guard", "sora")


def list_models(provider, key):
    """[{id, name}] of chat models for a provider, newest-looking first."""
    timeout = 15
    if provider in OPENAI_COMPATIBLE:
        res = requests.get(OPENAI_COMPATIBLE[provider], headers={"Authorization": f"Bearer {key}"}, timeout=timeout)
        res.raise_for_status()
        models = [{"id": m["id"], "name": m["id"]} for m in res.json().get("data", [])]
        models = [m for m in models if not any(h in m["id"].lower() for h in NON_CHAT_HINTS)]
    elif provider == "anthropic":
        res = requests.get(
            "https://api.anthropic.com/v1/models",
            headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
            params={"limit": 100},
            timeout=timeout,
        )
        res.raise_for_status()
        models = [{"id": m["id"], "name": m.get("display_name") or m["id"]} for m in res.json().get("data", [])]
    elif provider == "google":
        res = requests.get(
            "https://generativelanguage.googleapis.com/v1beta/models",
            params={"key": key, "pageSize": 200},
            timeout=timeout,
        )
        res.raise_for_status()
        models = [
            {"id": m["name"].removeprefix("models/"), "name": m.get("displayName") or m["name"]}
            for m in res.json().get("models", [])
            if "generateContent" in m.get("supportedGenerationMethods", [])
            and "gemini" in m["name"]
        ]
    elif provider == "openrouter":
        res = requests.get("https://openrouter.ai/api/v1/models", headers={"Authorization": f"Bearer {key}"}, timeout=timeout)
        res.raise_for_status()
        models = [
            {"id": m["id"], "name": m.get("name") or m["id"]}
            for m in res.json().get("data", [])
            # Translation needs structured output (or tool calling to emulate it)
            if {"structured_outputs", "response_format", "tools"} & set(m.get("supported_parameters") or [])
        ]
    else:
        raise ValueError(f"Unknown provider: {provider}")
    return sorted(models, key=lambda m: m["id"], reverse=True) if provider != "anthropic" else models
