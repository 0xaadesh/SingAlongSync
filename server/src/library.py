"""Read processed songs out of downloads/<video_id>/ bundles."""
import json
import re

from src.config import DOWNLOADS_DIR

VIDEO_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{11}$")
# "A, B feat. C" -> ["A", "B", "C"]; "&" only splits lists that also use commas,
# so duos like "Simon & Garfunkel" stay whole.
ARTIST_SEPARATORS = re.compile(r"\s*(?:,|\b(?:feat|ft)\.?\s|\bwith\s)\s*", re.IGNORECASE)
ARTWORK_EXTENSIONS = ("webp", "jpg", "jpeg", "png")


def is_valid_video_id(video_id):
    return bool(VIDEO_ID_PATTERN.match(video_id))


def find_artwork(song_dir):
    """
    URL path of the song's artwork: the square YouTube Music cover if we have it,
    else the (16:9) video thumbnail yt-dlp saved next to the audio.
    """
    candidates = [song_dir / "cover.jpg"] + [song_dir / f"audio.{ext}" for ext in ARTWORK_EXTENSIONS]
    for path in candidates:
        if path.exists():
            # Version query busts any copy browsers cached before CORS headers were consistent
            return f"/downloads/{song_dir.name}/{path.name}?v={int(path.stat().st_mtime)}"
    return None


def read_metadata(song_dir):
    try:
        with open(song_dir / "metadata.json", "r", encoding="utf-8") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def split_artists(artist):
    artist = artist or ""
    pattern = ARTIST_SEPARATORS.pattern
    if "," in artist:
        pattern += r"|\s&\s"
    return [a.strip() for a in re.split(pattern, artist, flags=re.IGNORECASE) if a.strip()]


def read_song(song_dir):
    """Song summary, or None unless the bundle is fully processed."""
    karaoke_path = song_dir / "karaoke.json"
    if not karaoke_path.exists():
        return None
    meta = read_metadata(song_dir)
    if meta is None:
        return None
    return {
        "videoId": song_dir.name,
        "title": meta.get("title") or "Unknown Title",
        "artist": meta.get("artist") or "Unknown Artist",
        "artists": meta.get("artists") or split_artists(meta.get("artist")) or ["Unknown Artist"],
        "album": meta.get("album") or "",
        "genre": meta.get("genre"),
        "year": meta.get("year"),
        "explicit": meta.get("explicit"),
        "duration": meta.get("duration") or 0,
        "thumbnail": meta.get("thumbnail"),
        "artwork": find_artwork(song_dir),
        "audio": f"/downloads/{song_dir.name}/audio.mp3",
        "addedAt": karaoke_path.stat().st_mtime,
    }


def list_songs():
    songs = [song for d in DOWNLOADS_DIR.iterdir() if d.is_dir() and (song := read_song(d))]
    # Newest first
    songs.sort(key=lambda s: s["addedAt"], reverse=True)
    return songs


def get_song_detail(video_id):
    """Song summary plus its word-timed lyric lines, or None."""
    song_dir = DOWNLOADS_DIR / video_id
    song = read_song(song_dir)
    if song is None:
        return None
    with open(song_dir / "karaoke.json", "r", encoding="utf-8") as f:
        song["lines"] = json.load(f)
    # English for non-English lines, keyed by line index (absent until translated)
    try:
        with open(song_dir / "translations.json", "r", encoding="utf-8") as f:
            song["translations"] = json.load(f).get("lines", {})
    except (FileNotFoundError, json.JSONDecodeError):
        song["translations"] = None
    return song


def library_artists():
    """{artist name: avatar URL path} for every artist credited in the library with a saved avatar."""
    from src.ytmusic import avatar_path  # keeps ytmusicapi out of CLI-only imports

    avatars = {}
    for song_dir in DOWNLOADS_DIR.iterdir():
        meta = read_metadata(song_dir) if song_dir.is_dir() else None
        for name, artist_id in ((meta or {}).get("artistIds") or {}).items():
            path = avatar_path(artist_id)
            if path.exists():
                avatars[name] = f"/media/avatars/{path.name}?v={int(path.stat().st_mtime)}"
    return avatars
