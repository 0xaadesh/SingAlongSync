"""
Lyric script/language detection.

Detects which Indian script (or English) lyrics are written in by comparing
characters against a Unicode-block map per script, and maps that script to a
WhisperX forced-alignment language code.
"""

# --------------------------------------------------
# SCRIPT -> UNICODE BLOCK MAP
# --------------------------------------------------
SCRIPT_RANGES = {
    "Devanagari": [(0x0900, 0x097F)],   # Hindi, Marathi, Nepali, Sanskrit
    "Gurmukhi":   [(0x0A00, 0x0A7F)],    # Punjabi
    "Gujarati":   [(0x0A80, 0x0AFF)],
    "Bengali":    [(0x0980, 0x09FF)],    # Bengali, Assamese
    "Odia":       [(0x0B00, 0x0B7F)],
    "Tamil":      [(0x0B80, 0x0BFF)],
    "Telugu":     [(0x0C00, 0x0C7F)],
    "Kannada":    [(0x0C80, 0x0CFF)],
    "Malayalam":  [(0x0D00, 0x0D7F)],
    "English":    [(0x0041, 0x005A), (0x0061, 0x007A)],  # A-Z, a-z
}

SCRIPT_TO_LANGUAGE = {
    "Devanagari": "Hindi/Marathi",
    "Gurmukhi": "Punjabi",
    "Gujarati": "Gujarati",
    "Bengali": "Bengali",
    "Odia": "Odia",
    "Tamil": "Tamil",
    "Telugu": "Telugu",
    "Kannada": "Kannada",
    "Malayalam": "Malayalam",
    "English": "English",
}

# WhisperX only ships forced-alignment models for a subset of scripts.
# Any script without a dedicated model falls back to English ("en").
SCRIPT_TO_WHISPERX_CODE = {
    "Devanagari": "hi",
    "Telugu": "te",
    "Malayalam": "ml",
    "English": "en",
}


def detect_script(text: str) -> dict:
    """Count characters per script, ignoring whitespace/digits/punctuation."""
    counts = {script: 0 for script in SCRIPT_RANGES}

    for ch in text:
        if ch.isspace() or ch.isdigit():
            continue
        code = ord(ch)
        for script, ranges in SCRIPT_RANGES.items():
            if any(start <= code <= end for start, end in ranges):
                counts[script] += 1
                break

    return {k: v for k, v in sorted(counts.items(), key=lambda kv: kv[1], reverse=True) if v > 0}


def detect_lyrics_language(lyrics_text: str) -> dict:
    """Return the dominant script, its likely language and WhisperX align code."""
    script_counts = detect_script(lyrics_text)
    top_script = next(iter(script_counts), None)
    return {
        "script": top_script,
        "language": SCRIPT_TO_LANGUAGE.get(top_script, "Unknown"),
        "align_code": SCRIPT_TO_WHISPERX_CODE.get(top_script, "en"),
        "counts": script_counts,
    }
