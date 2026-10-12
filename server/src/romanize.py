"""
Latin-letter versions of lyric lines, word for word, for WhisperX alignment.

WhisperX's alignment models only know their own alphabet. Scripts without a model
(Gurmukhi, Tamil, Kannada, Bengali, Gujarati, Odia) fall back to the English model,
which can't read them at all. Romanising the words first lets that model align them.

Two sources, per line:
  - the AI translation's `romanized` line, when it has exactly one word per original word
  - rule-based transliteration (indic-transliteration), which always maps word for word
"""
import re
import unicodedata

from indic_transliteration import sanscript

from src.lang import SCRIPT_RANGES

SCHEMES = {
    "Devanagari": sanscript.DEVANAGARI,
    "Gurmukhi": sanscript.GURMUKHI,
    "Gujarati": sanscript.GUJARATI,
    "Bengali": sanscript.BENGALI,
    "Odia": sanscript.ORIYA,
    "Tamil": sanscript.TAMIL,
    "Telugu": sanscript.TELUGU,
    "Kannada": sanscript.KANNADA,
    "Malayalam": sanscript.MALAYALAM,
}


def word_script(word):
    """The first non-Latin script found in a word, or None."""
    for ch in word:
        code = ord(ch)
        for script, ranges in SCRIPT_RANGES.items():
            if script != "English" and any(start <= code <= end for start, end in ranges):
                return script
    return None


def to_ascii(text):
    """'vārī' -> 'vari': drop diacritics and anything outside plain letters/apostrophes."""
    decomposed = unicodedata.normalize("NFKD", text)
    plain = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return re.sub(r"[^A-Za-z']+", "", plain).lower()


def transliterate_word(word):
    script = word_script(word)
    if not script or script not in SCHEMES:
        return word
    return to_ascii(sanscript.transliterate(word, SCHEMES[script], sanscript.IAST)) or word


def romanize_lines(line_tokens, ai_romanized=None):
    """
    Romanised tokens for each line (same count as the original tokens) and how many
    lines came from each source.
    """
    ai_romanized = ai_romanized or {}
    result, stats = [], {"ai": 0, "rules": 0, "latin": 0}
    for i, tokens in enumerate(line_tokens):
        if not any(word_script(t) for t in tokens):
            result.append(tokens)
            stats["latin"] += 1
            continue
        ai_words = (ai_romanized.get(str(i)) or "").split()
        if len(ai_words) == len(tokens):
            result.append(ai_words)
            stats["ai"] += 1
        else:
            result.append([transliterate_word(t) for t in tokens])
            stats["rules"] += 1
    return result, stats
