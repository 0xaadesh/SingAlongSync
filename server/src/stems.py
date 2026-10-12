"""
Browser-friendly copies of the Demucs stems for karaoke mode.

Demucs writes uncompressed WAVs (~40-50 MB each). The web player streams the
instrumental and (optionally) the vocals side by side, so they're encoded to
192 kbps MP3 once, right after separation (and backfilled for older songs).
"""
import subprocess
import threading

from src.config import DOWNLOADS_DIR

STEMS = ("instrumental", "vocals")


def stems_ready(work_dir):
    return all((work_dir / f"{name}.mp3").exists() for name in STEMS)


def encode_stems(work_dir, log=print):
    """Encode instrumental.wav / vocals.wav to MP3. Never raises; returns True when both exist."""
    for name in STEMS:
        wav, mp3 = work_dir / f"{name}.wav", work_dir / f"{name}.mp3"
        if mp3.exists() or not wav.exists():
            continue
        tmp = mp3.with_suffix(".tmp.mp3")
        result = subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", str(wav), "-codec:a", "libmp3lame", "-b:a", "192k", str(tmp)],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            tmp.unlink(missing_ok=True)
            log(f"Stem encode failed for {name}: {result.stderr.strip()[:200]}")
            continue
        tmp.replace(mp3)
        log(f"Encoded {mp3.name} ({mp3.stat().st_size // 1024} KB)")
    return stems_ready(work_dir)


def backfill_stems_async():
    """Encode stems for songs separated before karaoke mode existed, in the background."""

    def run():
        for song_dir in DOWNLOADS_DIR.iterdir():
            if song_dir.is_dir() and (song_dir / "karaoke.json").exists() and not stems_ready(song_dir):
                encode_stems(song_dir, log=lambda m, vid=song_dir.name: print(f"[stems {vid}] {m}", flush=True))

    threading.Thread(target=run, daemon=True).start()
