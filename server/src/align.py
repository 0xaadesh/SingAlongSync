"""
Choosing how lyrics are aligned, and turning WhisperX output back into one
karaoke line per lyric line with the original words.

Alignment modes (Settings > Lyrics alignment):
  native    - align the lyrics as written, with the script's own WhisperX model
              (English model when the script has none)
  romanized - align Latin-letter versions of non-Latin lines with the English model
  auto      - native when the script has its own model (Hindi, Telugu, Malayalam),
              romanized otherwise (Punjabi, Tamil, Kannada, Bengali, Gujarati, Odia)
"""
import re

from src.lang import SCRIPT_TO_WHISPERX_CODE

ALIGNMENT_MODES = ("auto", "native", "romanized")


def choose_alignment(script, mode):
    """(use_romanized, whisperx language code) for the lyrics' main script."""
    native = SCRIPT_TO_WHISPERX_CODE.get(script)
    if script in (None, "English"):
        return False, native or "en"
    if mode == "romanized" or (mode == "auto" and native is None):
        return True, "en"
    return False, native or "en"


def _squash(text):
    return re.sub(r"\s+", "", text or "")


def group_words_by_line(align_texts, segments):
    """
    WhisperX may split one input line into several sentence segments. Walk its output in
    order and collect each input line's words, matching by text length.
    """
    groups, j = [], 0
    for text in align_texts:
        target, consumed, words = len(_squash(text)), 0, []
        while j < len(segments) and consumed < target:
            consumed += len(_squash(segments[j].get("text")))
            words.extend(segments[j].get("words", []))
            j += 1
        groups.append(words)
    return groups


def map_words(align_tokens, aligned_words):
    """
    Index into align_tokens for each aligned word. Same count means one to one; otherwise
    match in order by text, skipping tokens WhisperX dropped.
    """
    if len(aligned_words) == len(align_tokens):
        return list(range(len(align_tokens)))
    indices, k = [], 0
    for word in aligned_words:
        text = (word.get("word") or "").strip()
        while k < len(align_tokens) and align_tokens[k] != text:
            k += 1
        if k >= len(align_tokens):
            indices.append(None)
            continue
        indices.append(k)
        k += 1
    return indices


def build_karaoke(lines, original_tokens, align_tokens, segments):
    """
    One karaoke entry per lyric line: the original text and words (even when a
    romanised version was aligned), with the timings WhisperX found.
    """
    groups = group_words_by_line([" ".join(t) for t in align_tokens], segments)
    karaoke = []
    for line, originals, aligned_tokens, aligned_words in zip(lines, original_tokens, align_tokens, groups):
        words = []
        for word, index in zip(aligned_words, map_words(aligned_tokens, aligned_words)):
            start, end = word.get("start"), word.get("end")
            if index is None or start is None or end is None:
                continue
            words.append({"word": originals[index], "start": round(start, 3), "end": round(end, 3)})
        karaoke.append({
            "line": line["text"],
            "start": round(words[0]["start"] if words else line["start"], 3),
            "end": round(words[-1]["end"] if words else line["end"], 3),
            "words": words,
        })
    return karaoke
