"""
Background download jobs for the web UI.

Each job runs the CLI (src/cli.py) in its own process so the heavy Demucs and
WhisperX work never blocks the API and its memory is freed when it finishes.
Jobs run one at a time (they compete for the same GPU). Progress is read back
from the status.json the pipeline writes into downloads/<video_id>/.
"""
import os
import queue
import re
import signal
import subprocess
import sys
import threading
import time
from dataclasses import dataclass, field

from src import settings as settings_store
from src.config import CLI_PATH, DOWNLOADS_DIR, SERVER_ROOT
from src.gpu import GPU_LOCK
from src.library import find_artwork, is_processed, read_metadata
from src.status import read_status, write_json_atomic

POLL_INTERVAL = 0.4

# tqdm redraws its bar many times a second; echo it to the console only every 10%.
TQDM_PERCENT = re.compile(r"(\d{1,3})%\|")
LINE_BREAK = re.compile(r"[\r\n]+")

# Pipeline steps in order: (key, files that prove the step is done, status.json stage while running)
STEPS = [
    ("download", ("audio.mp3", "metadata.json"), "downloading"),
    ("lyrics", ("synced.lrc",), "fetching_lyrics"),
    ("separate", ("vocals.wav",), "separating_vocals"),
    ("align", ("karaoke.json",), "aligning_lyrics"),
]
# Only part of a job when AI translation was switched on at submit time
TRANSLATE_STEP = ("translate", ("translations.json",), "translating")


@dataclass
class Job:
    id: str
    url: str
    state: str = "queued"  # queued | running | done | failed | cancelled
    created_at: float = field(default_factory=time.time)
    started_at: float | None = None
    finished_at: float | None = None
    error: str | None = None
    progress: dict = field(default_factory=dict)
    process: subprocess.Popen | None = None
    cancel_requested: bool = False
    # Quick title/artist from oEmbed, shown until yt-dlp's metadata.json exists
    preview: dict = field(default_factory=dict)
    # Whether AI translation is part of this job (settings at submit time)
    translate: bool = False

    def to_dict(self, queue_position=None):
        progress = dict(self.progress)
        for key in ("title", "artist"):
            progress[key] = progress.get(key) or self.preview.get(key)
        running = self.state == "running"
        retry_at = progress.pop("retryAt", None)
        if not running:
            progress["note"] = None
        return {
            "id": self.id,
            "url": self.url,
            "state": self.state,
            "createdAt": self.created_at,
            "startedAt": self.started_at,
            "finishedAt": self.finished_at,
            "error": self.error,
            # Seconds until a waiting step retries (relative, so client clock skew doesn't matter)
            "retryIn": max(0.0, retry_at - time.time()) if running and retry_at else None,
            # Jobs ahead of this one (the running job included); None unless queued
            "queuePosition": queue_position,
            **progress,
        }


def read_progress(video_id, running, failed=False, translate=False):
    """
    Derive per-step states, the active step's progress and known metadata from disk.
    running marks the first unfinished step active; failed marks it failed instead.
    """
    work_dir = DOWNLOADS_DIR / video_id
    status = read_status(work_dir / "status.json")
    meta = read_metadata(work_dir) or {}

    # Translation runs right after the lyrics are fetched
    all_steps = STEPS[:2] + [TRANSLATE_STEP] + STEPS[2:] if translate else STEPS
    steps = []
    active_found = False
    for key, files, _stage in all_steps:
        if all((work_dir / name).exists() for name in files):
            steps.append("done")
        elif key == "lyrics" and status.get("lyrics_found") is False:
            # Not fatal: the song is still downloaded and separated
            steps.append("failed")
        elif key in ("align", "translate") and status.get("lyrics_found") is False:
            steps.append("skipped")
        elif key == "translate" and status.get("translation_error"):
            # Translation is best-effort: the song is still playable without it
            steps.append("failed")
        elif not active_found and (running or failed):
            steps.append("active" if running else "failed")
            active_found = True
        else:
            steps.append("pending")

    progress = None
    if "active" in steps:
        active_stage = all_steps[steps.index("active")][2]
        if status.get("stage") == active_stage:
            progress = status.get("progress")

    return {
        "steps": [{"key": key, "status": s} for (key, _, _), s in zip(all_steps, steps)],
        "translationError": status.get("translation_error"),
        "noLyrics": status.get("lyrics_found") is False,
        "stepProgress": progress,
        "title": meta.get("title"),
        "artist": meta.get("artist"),
        "artwork": find_artwork(work_dir),
        "statusError": status.get("error"),
        # Set while a step waits to retry, e.g. "Download failed (HTTP 403). Retry 1 of 3"
        "note": status.get("note"),
        "retryAt": status.get("retry_at"),
    }


def kill_tree(proc):
    """Stop the CLI and the Demucs process it may have spawned."""
    if proc.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        os.killpg(proc.pid, signal.SIGTERM)


def console_log(video_id, message):
    """Print a job line to the server console, surviving consoles that can't show emoji."""
    text = f"[job {video_id}] {message}\n"
    stream = sys.stdout
    encoding = stream.encoding or "utf-8"
    stream.buffer.write(text.encode(encoding, errors="replace"))
    stream.flush()


def tee_output(proc, log, video_id):
    """Copy the CLI's output into job.log verbatim and line-by-line to the server console."""
    pending = ""
    last_bucket = None
    while chunk := proc.stdout.read1(4096):
        text = chunk.decode("utf-8", errors="replace")
        log.write(text)
        log.flush()
        pending += text
        *lines, pending = LINE_BREAK.split(pending)
        for line in lines:
            line = line.rstrip()
            if not line:
                continue
            if match := TQDM_PERCENT.search(line):
                bucket = int(match.group(1)) // 10
                if bucket == last_bucket:
                    continue
                last_bucket = bucket
            console_log(video_id, line)
    if pending.strip():
        console_log(video_id, pending.rstrip())


def last_log_line(log_path):
    try:
        lines = log_path.read_text(encoding="utf-8", errors="replace").strip().splitlines()
    except FileNotFoundError:
        return None
    return lines[-1].strip() if lines else None


class JobManager:
    def __init__(self, on_done=None):
        # Called with the video id when a job finishes successfully (e.g. queue analysis)
        self._on_done = on_done
        self._jobs: dict[str, Job] = {}
        self._queue: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        self.version = 0
        threading.Thread(target=self._worker, daemon=True).start()

    def _bump(self):
        self.version += 1

    def _queue_positions(self):
        """How many jobs are ahead of each queued one, in run order."""
        running = sum(1 for j in self._jobs.values() if j.state == "running")
        queued = sorted((j for j in self._jobs.values() if j.state == "queued"), key=lambda j: j.created_at)
        return {job.id: running + i for i, job in enumerate(queued)}

    def snapshot(self):
        with self._lock:
            positions = self._queue_positions()
            jobs = sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)
            return [job.to_dict(positions.get(job.id)) for job in jobs]

    def get(self, video_id):
        with self._lock:
            job = self._jobs.get(video_id)
            return job.to_dict(self._queue_positions().get(video_id)) if job else None

    def submit(self, video_id, url, preview=None):
        """Queue a job; returns the existing one if this song is already queued or running."""
        with self._lock:
            existing = self._jobs.get(video_id)
            if existing and existing.state in ("queued", "running"):
                return existing.to_dict(self._queue_positions().get(video_id))
            job = Job(id=video_id, url=url, preview=preview or {}, translate=settings_store.translation_ready(settings_store.load()))
            job.progress = read_progress(video_id, running=False, translate=job.translate)
            self._jobs[video_id] = job
            self._bump()
            result = job.to_dict(self._queue_positions().get(video_id))
        self._queue.put(video_id)
        return result

    def is_active(self, video_id):
        with self._lock:
            job = self._jobs.get(video_id)
            return bool(job and job.state in ("queued", "running"))

    def forget(self, video_id):
        """Drop a finished job from the list (used when its song is deleted)."""
        with self._lock:
            job = self._jobs.get(video_id)
            if job and job.state not in ("queued", "running"):
                del self._jobs[video_id]
                self._bump()

    def cancel_or_dismiss(self, video_id):
        """Cancel a queued/running job, or remove a finished one from the list."""
        with self._lock:
            job = self._jobs.get(video_id)
            if job is None:
                return False
            if job.state == "queued":
                job.state = "cancelled"
                job.finished_at = time.time()
            elif job.state == "running":
                job.cancel_requested = True
                if job.process:
                    kill_tree(job.process)
            else:
                del self._jobs[video_id]
            self._bump()
            return True

    def _worker(self):
        while True:
            video_id = self._queue.get()
            # Waits for a running key/chord analysis to finish; the job stays queued meanwhile
            with GPU_LOCK:
                with self._lock:
                    job = self._jobs.get(video_id)
                    if job is None or job.state != "queued":
                        continue
                self._run(job)

    def _run(self, job):
        work_dir = DOWNLOADS_DIR / job.id
        work_dir.mkdir(exist_ok=True)
        log_path = work_dir / "job.log"

        # Forget the previous run's outcome so a crash can't surface a stale error
        status_path = work_dir / "status.json"
        if status_path.exists():
            status = read_status(status_path)
            for key in ("error", "lyrics_found", "lyrics_error", "progress", "translation_error", "note", "retry_at"):
                status.pop(key, None)
            write_json_atomic(status_path, status)

        env = {**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUNBUFFERED": "1"}
        console_log(job.id, f"started: {job.url}")
        log = open(log_path, "w", encoding="utf-8")
        with self._lock:
            job.process = subprocess.Popen(
                [sys.executable, str(CLI_PATH), job.url],
                cwd=SERVER_ROOT,
                env=env,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                stdin=subprocess.DEVNULL,
                start_new_session=os.name != "nt",
            )
            job.state = "running"
            job.started_at = time.time()
            self._bump()
        tee = threading.Thread(target=tee_output, args=(job.process, log, job.id), daemon=True)
        tee.start()

        while job.process.poll() is None:
            self._refresh(job, running=True)
            time.sleep(POLL_INTERVAL)
        tee.join(timeout=5)
        log.close()

        with self._lock:
            if job.cancel_requested:
                job.state = "cancelled"
            elif job.process.returncode == 0 and is_processed(work_dir):
                job.state = "done"
            else:
                job.state = "failed"
            job.progress = read_progress(job.id, running=False, failed=job.state == "failed", translate=job.translate)
            if job.state == "failed":
                job.error = job.progress.get("statusError") or last_log_line(log_path) or "Processing failed."
            job.finished_at = time.time()
            job.process = None
            self._bump()
        took = time.strftime("%M:%S", time.gmtime(job.finished_at - job.started_at))
        console_log(job.id, f"{job.state} in {took}" + (f": {job.error}" if job.error else ""))
        if job.state == "done" and self._on_done:
            self._on_done(job.id)

    def _refresh(self, job, running):
        progress = read_progress(job.id, running, translate=job.translate)
        with self._lock:
            if progress != job.progress:
                job.progress = progress
                self._bump()
