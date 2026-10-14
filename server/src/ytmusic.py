"""
YouTube Music metadata via ytmusicapi (unauthenticated): song search, credited
artists, albums (cover, year, explicit flags) and artist avatars.
"""
import json
import re
import threading
import time

import requests
from ytmusicapi import YTMusic

from src.config import CACHE_DIR
from src.status import write_json_atomic

ARTISTS_CACHE = CACHE_DIR / "artists.json"
# Served by the API at /media/avatars/<channel id>.jpg
AVATARS_DIR = CACHE_DIR / "avatars"
COVER_SIZE = 1000
AVATAR_SIZE = 600

_client = None
_client_lock = threading.Lock()
_cache_lock = threading.Lock()


def client():
    global _client
    with _client_lock:
        if _client is None:
            _client = YTMusic()
        return _client


def resize(url, size):
    """googleusercontent images take their size from the URL suffix; ask for a square one."""
    if not url:
        return None
    base = re.sub(r"=[^/=]*$", "", url)
    return f"{base}=w{size}-h{size}-l90-rj"


def _largest(thumbnails):
    return thumbnails[-1]["url"] if thumbnails else None


def _artist_names(artists):
    return [a["name"] for a in artists or [] if a.get("name")]


def search_songs(query, limit=20):
    results = client().search(query, filter="songs", limit=limit)
    songs = []
    for r in results:
        if not r.get("videoId"):
            continue
        names = _artist_names(r.get("artists"))
        songs.append({
            "videoId": r["videoId"],
            "title": r.get("title"),
            "artists": names,
            "artist": ", ".join(names),
            "album": (r.get("album") or {}).get("name"),
            "duration": r.get("duration_seconds"),
            "explicit": bool(r.get("isExplicit")),
            "thumbnail": resize(_largest(r.get("thumbnails")), 120),
        })
    return songs[:limit]


def track_info(video_id):
    """The song as YouTube Music sees it: credited artists (with ids), album (with id), year, artwork."""
    track = client().get_watch_playlist(video_id, limit=1)["tracks"][0]
    return {
        "title": track.get("title"),
        "artists": [a for a in track.get("artists") or [] if a.get("name")],
        "album": track.get("album") or None,
        "year": track.get("year"),
        "thumbnail": resize(_largest(track.get("thumbnail")), COVER_SIZE),
    }


def album_info(album_id, video_id):
    """Album cover, year, artists and this song's explicit flag (only listed per album track)."""
    album = client().get_album(album_id)
    track = next((t for t in album.get("tracks", []) if t.get("videoId") == video_id), None)
    return {
        "title": album.get("title"),
        "type": album.get("type"),
        "year": album.get("year"),
        "artists": _artist_names(album.get("artists")),
        "cover": resize(_largest(album.get("thumbnails")), COVER_SIZE),
        "explicit": track.get("isExplicit") if track else album.get("isExplicit"),
        "trackCount": album.get("trackCount"),
    }


def download_image(url, path):
    """Save an image; returns its size in bytes."""
    res = requests.get(url, timeout=15)
    res.raise_for_status()
    path.write_bytes(res.content)
    return len(res.content)


# ---------------------------------------------------------------------------
# Artist avatars, cached on disk by channel id: {id: {"name": ..., "avatar": ...}}
# ---------------------------------------------------------------------------


def load_artist_cache():
    try:
        return json.loads(ARTISTS_CACHE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def avatar_path(artist_id):
    return AVATARS_DIR / f"{artist_id}.jpg"


def _save_avatar(artist_id, url):
    """Download an avatar so the browser never hotlinks Google's CDN (it answers 429 when throttling)."""
    AVATARS_DIR.mkdir(parents=True, exist_ok=True)
    return download_image(url, avatar_path(artist_id))


def fetch_artist_avatars(artists, log=print):
    """
    Look up and download avatars for {name, id} artists, one get_artist call each,
    skipping ones already on disk. Failures aren't cached, so they're retried next time.
    """
    with _cache_lock:
        cache = load_artist_cache()
        changed = False
        for artist in artists:
            artist_id, name = artist.get("id"), artist["name"]
            if not artist_id:
                log(f"Artist {name}: no YouTube Music channel, skipping avatar")
                continue
            if avatar_path(artist_id).exists():
                log(f"Artist {name}: avatar cached")
                continue
            url = cache.get(artist_id, {}).get("avatar")
            if not url:
                try:
                    url = resize(_largest(client().get_artist(artist_id).get("thumbnails")), AVATAR_SIZE)
                except Exception as e:
                    log(f"Artist {name}: lookup failed ({e})")
                    continue
                if not url:
                    log(f"Artist {name}: no avatar on YouTube Music")
                    continue
                cache[artist_id] = {"name": name, "avatar": url}
                changed = True
            try:
                size = _save_avatar(artist_id, url)
                log(f"Artist {name}: avatar saved ({size // 1024} KB)")
            except Exception as e:
                log(f"Artist {name}: avatar download failed ({e})")
        if changed:
            ARTISTS_CACHE.parent.mkdir(exist_ok=True)
            write_json_atomic(ARTISTS_CACHE, cache)


def download_missing_avatars(log=print):
    """Download avatars that are known (cached URL) but not on disk yet, e.g. from older versions."""
    for artist_id, entry in load_artist_cache().items():
        if entry.get("avatar") and not avatar_path(artist_id).exists():
            try:
                _save_avatar(artist_id, entry["avatar"])
                log(f"Avatar saved for {entry['name']}")
            except Exception as e:
                log(f"Avatar download failed for {entry['name']} ({e})")
            # Be gentle with Google's CDN
            time.sleep(1)


def playlist_info(playlist_id):
    """
    Tracks of a YouTube Music album or playlist. Album links (list=OLAK5uy_…) are
    resolved to the album itself, which has the artist, year and a proper cover.
    """
    yt = client()
    if playlist_id.startswith("OLAK5uy_"):
        album = yt.get_album(yt.get_album_browse_id(playlist_id))
        album_artist = ", ".join(_artist_names(album.get("artists")))
        raw_tracks = album.get("tracks", [])
        info = {
            "kind": "album",
            "title": album.get("title"),
            "artist": album_artist,
            "year": album.get("year"),
            "cover": resize(_largest(album.get("thumbnails")), 600),
        }
    else:
        playlist = yt.get_playlist(playlist_id, limit=500)
        author = playlist.get("author")
        raw_tracks = playlist.get("tracks", [])
        info = {
            "kind": "playlist",
            "title": playlist.get("title"),
            "artist": author.get("name") if isinstance(author, dict) else author,
            "year": playlist.get("year"),
            "cover": resize(_largest(playlist.get("thumbnails")), 600),
        }

    tracks = []
    for t in raw_tracks:
        if not t.get("videoId"):
            continue
        names = _artist_names(t.get("artists")) or ([info["artist"]] if info["artist"] else [])
        tracks.append({
            "videoId": t["videoId"],
            "title": t.get("title"),
            "artist": ", ".join(names),
            "duration": t.get("duration_seconds"),
            "explicit": bool(t.get("isExplicit")),
            "available": t.get("isAvailable", True) is not False,
            "thumbnail": resize(_largest(t.get("thumbnails")), 120) or info["cover"],
        })
    info["tracks"] = tracks
    return info
