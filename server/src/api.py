import asyncio
from pathlib import Path
import json
import mimetypes
import shutil
import threading

import requests

from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from src import settings as settings_store
from src.config import DOWNLOADS_DIR, WEB_ORIGINS
from src.align import ALIGNMENT_MODES
from src.enrich import backfill_async
from src.stems import backfill_stems_async
from src.status import write_json_atomic
from src.jobs import JobManager
from src.library import get_song_detail, is_valid_video_id, library_artists, list_songs, read_metadata
from src.translate import list_models
from src.translation_queue import TranslationQueue, untranslated_songs
from src.ytmusic import AVATARS_DIR, download_missing_avatars, search_songs
from src.youtube import extract_video_id, quick_metadata

# Windows' registry often lacks this, which would serve artwork as application/octet-stream
mimetypes.add_type("image/webp", ".webp")

app = FastAPI(title="SingAlongSync Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=WEB_ORIGINS,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
)

jobs = JobManager()
translations = TranslationQueue()

# Songs processed before the current metadata enrichment get it filled in, and
# avatars known only by URL (older versions) get downloaded
backfill_async()
backfill_stems_async()
threading.Thread(
    target=download_missing_avatars, kwargs={"log": lambda m: print(f"[avatars] {m}", flush=True)}, daemon=True
).start()


class CachedStaticFiles(StaticFiles):
    """Song assets never change once written, so let the browser cache them."""

    async def get_response(self, path, scope):
        response = await super().get_response(path, scope)
        if response.status_code in (200, 206) and not path.endswith(".json"):
            response.headers["Cache-Control"] = "public, max-age=86400"
        # Artwork is fetched both with and without CORS; key the cache by Origin so a
        # cached no-CORS copy is never reused for a CORS request (which breaks the image).
        response.headers["Vary"] = "Origin"
        return response


# Audio, artwork and the raw bundle files under /downloads/<video_id>/...
app.mount("/downloads", CachedStaticFiles(directory=DOWNLOADS_DIR), name="downloads")

# Artist avatars, downloaded once instead of hotlinking Google's CDN
AVATARS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media/avatars", CachedStaticFiles(directory=AVATARS_DIR), name="avatars")


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.get("/api/songs")
async def songs():
    return list_songs()


@app.get("/api/artists")
def artists():
    """Avatar URLs for library artists, keyed by name."""
    return library_artists()


@app.get("/api/search")
def search(q: str = ""):
    """Search YouTube Music for songs, marking ones already in the library."""
    q = q.strip()
    if len(q) < 2:
        return []
    try:
        results = search_songs(q)
    except Exception:
        raise HTTPException(status_code=502, detail="YouTube Music search is unavailable right now.")
    for song in results:
        song["inLibrary"] = (DOWNLOADS_DIR / song["videoId"] / "karaoke.json").exists()
    return results


@app.get("/api/songs/{video_id}")
async def song_detail(video_id: str):
    song = get_song_detail(video_id) if is_valid_video_id(video_id) else None
    if song is None:
        raise HTTPException(status_code=404, detail="Song not found")
    return song


@app.delete("/api/songs/{video_id}")
def delete_song(video_id: str):
    """Remove a song and its whole downloads/<video_id>/ folder."""
    song_dir = DOWNLOADS_DIR / video_id
    if not is_valid_video_id(video_id) or not song_dir.is_dir():
        raise HTTPException(status_code=404, detail="Song not found")
    if jobs.is_active(video_id):
        raise HTTPException(status_code=409, detail="This song is still processing. Cancel it first.")
    try:
        shutil.rmtree(song_dir)
    except OSError as e:
        # On Windows a file still being streamed can't be removed yet
        raise HTTPException(status_code=409, detail=f"Couldn't delete the song's files: {e.strerror or e}")
    jobs.forget(video_id)
    return {"ok": True}


class OffsetUpdate(BaseModel):
    offset: float


@app.put("/api/songs/{video_id}/offset")
def set_lyrics_offset(video_id: str, body: OffsetUpdate):
    """Save how far to shift this song's lyrics (seconds, positive = earlier)."""
    song_dir = DOWNLOADS_DIR / video_id
    meta = read_metadata(song_dir) if is_valid_video_id(video_id) else None
    if meta is None:
        raise HTTPException(status_code=404, detail="Song not found")
    meta["lyricsOffset"] = round(max(-10.0, min(10.0, body.offset)), 2)
    write_json_atomic(song_dir / "metadata.json", meta)
    return {"lyricsOffset": meta["lyricsOffset"]}


class JobRequest(BaseModel):
    url: str


@app.post("/api/jobs")
async def create_job(body: JobRequest):
    url = body.url.strip()
    video_id = extract_video_id(url)
    if not video_id or not is_valid_video_id(video_id):
        raise HTTPException(status_code=422, detail="That doesn't look like a YouTube or YouTube Music link.")
    if (DOWNLOADS_DIR / video_id / "karaoke.json").exists():
        return {"exists": True, "videoId": video_id}
    preview = await run_in_threadpool(quick_metadata, video_id)
    return {"exists": False, "videoId": video_id, "job": jobs.submit(video_id, url, preview)}


@app.get("/api/jobs")
async def list_jobs():
    return jobs.snapshot()


@app.get("/api/jobs/stream")
async def stream_jobs(request: Request):
    """Server-sent events: the full job list whenever anything changes."""

    async def events():
        version = -1
        idle = 0.0
        while not await request.is_disconnected():
            if jobs.version != version:
                version = jobs.version
                idle = 0.0
                yield f"data: {json.dumps(jobs.snapshot())}\n\n"
            elif idle >= 15:
                # Keep proxies and the browser from closing an idle stream
                idle = 0.0
                yield ": ping\n\n"
            await asyncio.sleep(0.25)
            idle += 0.25

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.delete("/api/jobs/{video_id}")
async def cancel_job(video_id: str):
    if not jobs.cancel_or_dismiss(video_id):
        raise HTTPException(status_code=404, detail="Job not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Settings (AI translation)
# ---------------------------------------------------------------------------


class SettingsUpdate(BaseModel):
    provider: str | None = None
    model: str | None = None
    translationEnabled: bool | None = None
    # Saved for `provider` (or the current provider when omitted). Empty string clears it.
    apiKey: str | None = None
    # YouTube access: a browser to read cookies from, or a cookies.txt path. Empty string clears.
    cookiesBrowser: str | None = None
    cookiesFile: str | None = None
    alignmentMode: str | None = None


@app.get("/api/settings")
def get_settings():
    return settings_store.public(settings_store.load())


@app.put("/api/settings")
def update_settings(body: SettingsUpdate):
    settings = settings_store.load()
    if body.provider is not None:
        if body.provider not in settings_store.PROVIDERS:
            raise HTTPException(status_code=422, detail="Unknown provider.")
        if body.provider != settings["provider"]:
            # A model id from one provider means nothing to another
            settings["model"] = None
        settings["provider"] = body.provider
    if body.apiKey is not None:
        provider = body.provider or settings["provider"]
        if not provider:
            raise HTTPException(status_code=422, detail="Pick a provider before adding a key.")
        keys = dict(settings.get("apiKeys") or {})
        if body.apiKey.strip():
            keys[provider] = body.apiKey.strip()
        else:
            keys.pop(provider, None)
        settings["apiKeys"] = keys
    if body.model is not None:
        settings["model"] = body.model.strip() or None
    if body.translationEnabled is not None:
        settings["translationEnabled"] = body.translationEnabled
    if body.alignmentMode is not None:
        if body.alignmentMode not in ALIGNMENT_MODES:
            raise HTTPException(status_code=422, detail="Unknown alignment mode.")
        settings["alignmentMode"] = body.alignmentMode
    if body.cookiesBrowser is not None:
        browser = body.cookiesBrowser.strip().lower() or None
        if browser and browser not in settings_store.COOKIE_BROWSERS:
            raise HTTPException(status_code=422, detail="Unsupported browser.")
        settings["cookiesBrowser"] = browser
    if body.cookiesFile is not None:
        path = body.cookiesFile.strip().strip('"') or None
        if path and not Path(path).is_file():
            raise HTTPException(status_code=422, detail="No file found at that path.")
        settings["cookiesFile"] = path
    settings_store.save(settings)
    return settings_store.public(settings)


@app.get("/api/providers/{provider}/models")
def provider_models(provider: str):
    """The provider's chat models, fetched live with the saved key (doubles as a key check)."""
    if provider not in settings_store.PROVIDERS:
        raise HTTPException(status_code=404, detail="Unknown provider.")
    key = settings_store.api_key(settings_store.load(), provider)
    if not key:
        raise HTTPException(status_code=400, detail="Add an API key for this provider first.")
    try:
        return list_models(provider, key)
    except requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        if status in (401, 403):
            raise HTTPException(status_code=400, detail="That API key was rejected by the provider.")
        raise HTTPException(status_code=502, detail=f"The provider returned an error ({status}).")
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Couldn't reach the provider.")


# ---------------------------------------------------------------------------
# Translations
# ---------------------------------------------------------------------------


@app.get("/api/translations/status")
def translation_status():
    return translations.status()


@app.post("/api/translations/backfill")
def translate_library():
    """Queue every song that has no translations yet."""
    if not settings_store.translation_ready(settings_store.load()):
        raise HTTPException(status_code=400, detail="Turn on AI translation and finish setting it up first.")
    return {"queued": translations.enqueue(untranslated_songs())}


@app.post("/api/songs/{video_id}/translate")
def translate_one(video_id: str):
    """(Re)translate one song in the background, e.g. after switching models."""
    song_dir = DOWNLOADS_DIR / video_id
    if not is_valid_video_id(video_id) or not (song_dir / "karaoke.json").exists():
        raise HTTPException(status_code=404, detail="Song not found")
    if not settings_store.translation_ready(settings_store.load()):
        raise HTTPException(status_code=400, detail="Turn on AI translation and finish setting it up first.")
    (song_dir / "translations.json").unlink(missing_ok=True)
    translations.enqueue([video_id])
    return {"ok": True}


@app.post("/api/youtube/check")
def youtube_check():
    """Try a metadata-only YouTube request with the saved cookie settings."""
    from yt_dlp import YoutubeDL

    from src.youtube import available_js_runtimes, cookie_options

    opts = {"quiet": True, "no_warnings": True, "skip_download": True, "js_runtimes": available_js_runtimes()}
    opts.update(cookie_options(settings_store.load()))
    try:
        with YoutubeDL(opts) as ydl:
            # "Me at the zoo": tiny, permanent, and always public
            ydl.extract_info("https://www.youtube.com/watch?v=jNQXAC9IVRw", download=False)
    except Exception as e:
        message = str(e).replace("ERROR: ", "").split("\n")[0][:300]
        return {"ok": False, "message": message}
    return {"ok": True, "message": "YouTube accepted the request."}
