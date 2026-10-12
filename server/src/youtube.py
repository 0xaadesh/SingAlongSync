import os
import shutil

import requests
from urllib.parse import urlparse, parse_qs

from yt_dlp import YoutubeDL
from yt_dlp.utils import DownloadError

from src import settings as settings_store

# YouTube now requires solving JS challenges (via yt-dlp-ejs) to get working
# download URLs; without a runtime, downloads fail with HTTP 403.
JS_RUNTIMES = ("deno", "node", "bun")


def extract_video_id(url):
    parsed = urlparse(url)
    if "youtube.com" in parsed.netloc:
        query = parse_qs(parsed.query)
        if "v" in query:
            return query["v"][0]
    if "youtu.be" in parsed.netloc:
        return parsed.path[1:]
    return None


def quick_metadata(video_id):
    """
    Title and artist from YouTube's oEmbed endpoint: one fast request, no JS challenge.
    Returns {} on any failure; yt-dlp's full metadata replaces this later anyway.
    """
    try:
        res = requests.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
            timeout=4,
        )
        res.raise_for_status()
        data = res.json()
    except (requests.RequestException, ValueError):
        return {}
    artist = data.get("author_name") or ""
    # YouTube Music auto-generated channels are named "<Artist> - Topic"
    if artist.endswith(" - Topic"):
        artist = artist[: -len(" - Topic")]
    return {"title": data.get("title"), "artist": artist or None}


def available_js_runtimes():
    return {name: {"path": path} for name in JS_RUNTIMES if (path := shutil.which(name))}


def track_metadata(info, video_id):
    return {
        "videoId": video_id,
        "title": info.get("track") or info.get("title"),
        "artist": info.get("artist") or info.get("uploader"),
        # YouTube Music provides the individual credited artists as a list
        "artists": info.get("artists") or None,
        "album": info.get("album") or "",
        "duration": round(info.get("duration") or 0),
        "thumbnail": info.get("thumbnail"),
    }


BOT_CHECK_HINT = (
    "YouTube wants to confirm you're not a bot. In Settings > YouTube access, pick a browser "
    "you're signed in to YouTube with (Firefox works best on Windows) or point to an exported "
    "cookies.txt, then retry."
)


class YouTubeBotCheckError(RuntimeError):
    pass


def cookie_options(settings):
    """yt-dlp options for signed-in requests, from Settings or server/.env (YTDLP_COOKIES_*)."""
    browser = settings.get("cookiesBrowser") or os.getenv("YTDLP_COOKIES_FROM_BROWSER")
    cookie_file = settings.get("cookiesFile") or os.getenv("YTDLP_COOKIES_FILE")
    if cookie_file:
        return {"cookiefile": cookie_file}
    if browser:
        return {"cookiesfrombrowser": (browser,)}
    return {}


def download_audio(url, work_dir, video_id, on_progress=None, on_metadata=None):
    """
    Download best audio as audio.mp3 (plus thumbnail) into work_dir and return track metadata.
    on_metadata, if given, receives the metadata before the download starts.
    on_progress, if given, receives the download fraction (0-1).
    """
    def progress_hook(d):
        if on_progress and d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate")
            if total:
                on_progress(d.get("downloaded_bytes", 0) / total)

    runtimes = available_js_runtimes()
    if not runtimes:
        raise RuntimeError("No JavaScript runtime found. Install Node.js, Deno or Bun so yt-dlp can download from YouTube.")

    ydl_opts = {
        "progress_hooks": [progress_hook],
        "format": "bestaudio/best",
        "outtmpl": str(work_dir / "audio.%(ext)s"),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "320",
        }],
        "writethumbnail": True,
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "js_runtimes": runtimes,
        **cookie_options(settings_store.load()),
    }

    try:
        with YoutubeDL(ydl_opts) as ydl:
            # Resolve metadata first so callers can show the title while audio downloads.
            info = ydl.extract_info(url, download=False)
            metadata = track_metadata(info, video_id)
            if on_metadata:
                on_metadata(metadata)
            ydl.process_ie_result(info, download=True)
    except DownloadError as e:
        if "confirm you" in str(e) and "not a bot" in str(e):
            raise YouTubeBotCheckError(BOT_CHECK_HINT) from e
        raise

    return metadata
