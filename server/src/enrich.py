"""
Metadata enrichment after download.

yt-dlp gives the basics (title, artist, duration, video thumbnail). The rest is
looked up step by step, each step logged and optional:
  1. YouTube Music track:   credited artists (with channel ids), album (with id), year
  2. YouTube Music album:   square album cover, release year, the song's explicit flag
  3. YouTube Music artists: one avatar per credited artist (cached across songs)
  4. iTunes Search:         genre (YouTube Music has none), matched by title, artist, album, duration
"""
import re
import threading
import time

import requests

from src import ytmusic
from src.config import DOWNLOADS_DIR
from src.status import write_json_atomic

ITUNES_SEARCH_URL = "https://itunes.apple.com/search"

# Bump when enrichment gains new fields so existing songs get backfilled.
ENRICH_VERSION = 3


def _norm(text):
    return re.sub(r"[^\w]+", " ", (text or "").lower()).strip()


def _score(result, title, artist, album, duration):
    score = 0
    if _norm(result.get("trackName")) == _norm(title):
        score += 3
    elif _norm(title) in _norm(result.get("trackName")):
        score += 1
    if album and _norm(album) and _norm(album) in _norm(result.get("collectionName")):
        score += 2
    result_artist = _norm(result.get("artistName"))
    if any(part and part in result_artist for part in _norm(artist).split()):
        score += 1
    if duration and abs(result.get("trackTimeMillis", 0) / 1000 - duration) <= 5:
        score += 2
    return score


def lookup_genre(title, artist, album="", duration=0, log=print):
    """Best-matching iTunes genre, or None if nothing matches confidently."""
    try:
        res = requests.get(
            ITUNES_SEARCH_URL,
            params={"term": f"{title} {artist}", "media": "music", "entity": "song", "limit": 10},
            timeout=6,
        )
        res.raise_for_status()
        results = res.json().get("results", [])
    except (requests.RequestException, ValueError) as e:
        log(f"iTunes: lookup failed ({e})")
        return None
    if not results:
        log("iTunes: no results")
        return None
    best = max(results, key=lambda r: _score(r, title, artist, album, duration))
    if _score(best, title, artist, album, duration) < 4:
        log(f"iTunes: no confident match among {len(results)} results")
        return None
    genre = best.get("primaryGenreName")
    log(f"iTunes: genre {genre!r} from \"{best.get('trackName')}\" by {best.get('artistName')}")
    return genre


def enrich_metadata(metadata, work_dir, log=print):
    """Fill in what yt-dlp's metadata lacks. Never raises: every source is optional."""
    video_id = metadata["videoId"]

    # 1. Track: credits and album reference
    track = None
    try:
        track = ytmusic.track_info(video_id)
        artists = ", ".join(a["name"] for a in track["artists"]) or "none"
        album_name = (track["album"] or {}).get("name") or "none"
        log(f"YouTube Music track: artists {artists}; album {album_name}; year {track['year'] or 'unknown'}")
    except Exception as e:
        log(f"YouTube Music track lookup failed ({e})")

    cover_url = None
    if track:
        if track["artists"]:
            metadata["artists"] = [a["name"] for a in track["artists"]]
            metadata["artistIds"] = {a["name"]: a["id"] for a in track["artists"] if a.get("id")}
        if track["album"]:
            metadata["album"] = metadata.get("album") or track["album"]["name"]
            metadata["albumId"] = track["album"].get("id")
        metadata["year"] = track["year"]
        cover_url = track["thumbnail"]

        # 2. Album: proper cover art, year and the explicit flag
        album_id = (track["album"] or {}).get("id")
        if album_id:
            try:
                album = ytmusic.album_info(album_id, video_id)
                metadata["explicit"] = album["explicit"]
                metadata["year"] = metadata.get("year") or album["year"]
                cover_url = album["cover"] or cover_url
                log(
                    f"YouTube Music album: {album['title']!r} ({album['type'] or 'album'}, {album['year'] or 'year unknown'}, "
                    f"{album['trackCount'] or '?'} tracks); explicit: {album['explicit']}"
                )
            except Exception as e:
                log(f"YouTube Music album lookup failed ({e}); using the track artwork")
        else:
            log("YouTube Music: no album for this track; using the track artwork")

        # 3. Artists: one avatar each
        if track["artists"]:
            ytmusic.fetch_artist_avatars(track["artists"], log=lambda m: log(f"YouTube Music {m[0].lower()}{m[1:]}"))

    if cover_url:
        try:
            size = ytmusic.download_image(cover_url, work_dir / "cover.jpg")
            log(f"Cover saved: cover.jpg ({size // 1024} KB)")
        except Exception as e:
            log(f"Cover download failed ({e}); keeping the video thumbnail")

    # 4. Genre
    metadata["genre"] = lookup_genre(
        metadata.get("title"), metadata.get("artist"), metadata.get("album"), metadata.get("duration"), log=log
    )
    metadata["enriched"] = ENRICH_VERSION
    return metadata


def backfill_async():
    """Enrich songs processed before the current enrichment existed, in the background."""

    def run():
        from src.library import is_processed, read_metadata  # avoid an import cycle

        for song_dir in DOWNLOADS_DIR.iterdir():
            meta = read_metadata(song_dir) if song_dir.is_dir() else None
            if not meta or meta.get("enriched", 0) >= ENRICH_VERSION or not is_processed(song_dir):
                continue
            log = lambda message, vid=song_dir.name: print(f"[enrich {vid}] {message}", flush=True)
            write_json_atomic(song_dir / "metadata.json", enrich_metadata(meta, song_dir, log=log))
            # Stay well under iTunes' ~20 requests/minute limit
            time.sleep(3)

    threading.Thread(target=run, daemon=True).start()
