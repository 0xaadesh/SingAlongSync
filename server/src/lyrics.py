import re
import time

import requests

LRCLIB_SEARCH_URL = "https://lrclib.net/api/search"
LRCLIB_HEADERS = {"User-Agent": "SingAlongSync/1.0"}
LRC_LINE_PATTERN = r"\[(\d+):(\d+\.\d+)\](.*)"

# How far (seconds) an LRCLIB track's duration may drift from the YouTube one.
MAX_DURATION_DRIFT = 5
# LRCLIB answers 429/5xx when busy; wait this long between attempts.
RETRY_DELAYS = (1, 3, 6)

# "(From "Premalu")", "(feat. X)", "[Official Video]"… which LRCLIB titles usually lack
TITLE_NOISE = re.compile(
    r"\s*[(\[][^)\]]*\b(from|feat\.?|ft\.?|with|official|lyrics?|video|audio|remaster(ed)?|version)\b[^)\]]*[)\]]",
    re.IGNORECASE,
)


class LyricsServiceError(Exception):
    """LRCLIB couldn't be reached or kept failing; not the same as "no lyrics exist"."""


def clean_title(title):
    return TITLE_NOISE.sub("", title or "").strip() or title


def _search(params, log):
    """GET /api/search with retries on rate limits, server errors and network failures."""
    last_error = None
    for attempt, delay in enumerate((0, *RETRY_DELAYS)):
        if delay:
            log(f"LRCLIB busy ({last_error}); retrying in {delay}s")
            time.sleep(delay)
        try:
            res = requests.get(LRCLIB_SEARCH_URL, params=params, headers=LRCLIB_HEADERS, timeout=15)
        except requests.RequestException as e:
            last_error = type(e).__name__
            continue
        if res.status_code == 429 or res.status_code >= 500:
            last_error = f"HTTP {res.status_code}"
            continue
        res.raise_for_status()
        data = res.json()
        return data if isinstance(data, list) else []
    raise LyricsServiceError(f"LRCLIB is unavailable right now ({last_error}). Try again in a minute.")


def search_synced_lyrics(title, artists, duration, log=print):
    """
    Search LRCLIB and return (synced_lyrics, reason); synced_lyrics is None when
    nothing usable was found and reason explains why.

    Tries progressively looser searches (structured title + main artist first, free
    text last) and takes the synced result whose duration is closest to the song's.
    Every search and its outcome is reported through `log`.
    Raises LyricsServiceError if LRCLIB itself is down.
    """
    primary = (artists or [""])[0]
    short_title = clean_title(title)

    strategies = [{"track_name": short_title, "artist_name": primary}]
    if short_title != title:
        strategies.append({"track_name": title, "artist_name": primary})
    strategies += [{"q": f"{short_title} {primary}".strip()}, {"q": short_title}]

    reason = "no_results"
    for params in strategies:
        results = _search(params, log)
        synced = [r for r in results if r.get("syncedLyrics")]
        close = [r for r in synced if abs((r.get("duration") or 0) - duration) <= MAX_DURATION_DRIFT]
        query = ", ".join(f"{k}={v!r}" for k, v in params.items())

        if close:
            best = min(close, key=lambda r: abs((r.get("duration") or 0) - duration))
            log(
                f"LRCLIB search {query}: {len(results)} results, {len(synced)} synced -> using "
                f"\"{best.get('trackName')}\" by {best.get('artistName')} ({best.get('duration')}s vs {duration}s)"
            )
            return best["syncedLyrics"], None

        log(f"LRCLIB search {query}: {len(results)} results, {len(synced)} synced, none within {MAX_DURATION_DRIFT}s of {duration}s")
        # Remember the most specific failure for the final message
        if synced:
            reason = "no_duration_match"
        elif results and reason == "no_results":
            reason = "not_synced"

    return None, reason


def parse_lrc(lrc_text):
    """Parse LRC text into [{start, end, text}], each line ending where the next starts."""
    lines = []
    for line in lrc_text.splitlines():
        match = re.match(LRC_LINE_PATTERN, line.strip())
        if not match:
            continue
        timestamp = int(match.group(1)) * 60 + float(match.group(2))
        lines.append({"start": timestamp, "text": match.group(3).strip()})

    for i in range(len(lines) - 1):
        lines[i]["end"] = lines[i + 1]["start"]
    if lines:
        lines[-1]["end"] = lines[-1]["start"] + 5
    return lines


def strip_lrc_timestamps(lrc_text: str) -> str:
    lines = []
    for line in lrc_text.splitlines():
        cleaned = re.sub(r"\[\d+:\d+\.\d+\]", "", line).strip()
        if cleaned:
            lines.append(cleaned)
    return "\n".join(lines)


LRCLIB_GET_URL = "https://lrclib.net/api/get/{id}"


def search_lrclib(params, log=print):
    """Raw LRCLIB search for the manual picker: each result with a short preview."""
    results = []
    for r in _search(params, log):
        synced = r.get("syncedLyrics")
        preview = [line["text"] for line in parse_lrc(synced or "") if line["text"].strip()][:3]
        results.append({
            "id": r.get("id"),
            "trackName": r.get("trackName"),
            "artistName": r.get("artistName"),
            "albumName": r.get("albumName"),
            "duration": r.get("duration"),
            "synced": bool(synced),
            "instrumental": bool(r.get("instrumental")),
            "preview": preview,
        })
    # Usable (synced) results first
    results.sort(key=lambda r: not r["synced"])
    return results


def fetch_lrclib_synced(lrclib_id):
    """Synced lyrics of one LRCLIB entry, or None if it has none."""
    res = requests.get(LRCLIB_GET_URL.format(id=int(lrclib_id)), headers=LRCLIB_HEADERS, timeout=15)
    if res.status_code == 404:
        return None
    res.raise_for_status()
    return res.json().get("syncedLyrics")


def validate_lrc(text):
    """Number of timed lines in an LRC text (0 means it isn't usable)."""
    return sum(1 for line in parse_lrc(text or "") if line["text"].strip())
