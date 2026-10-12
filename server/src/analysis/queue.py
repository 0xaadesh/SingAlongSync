"""
Background key and chord analysis, separate from the download pipeline.

Songs are queued when their processing job finishes (and on server start for songs
analysed before this existed). Results go to downloads/<id>/analysis.json; while a
song is queued or running, its detail reports the analysis as pending.
"""
import queue
import threading
import time

from src.config import DOWNLOADS_DIR
from src.status import read_status, write_json_atomic

# 2: added beats, bar starts and BPM
ANALYSIS_VERSION = 2


def analysis_path(song_dir):
    return song_dir / "analysis.json"


def needs_analysis(song_dir):
    data = read_status(analysis_path(song_dir))
    return data.get("version", 0) < ANALYSIS_VERSION and (song_dir / "audio.mp3").exists()


def analyze_song(song_dir, log=print):
    """Detect key and chords for one song and write analysis.json."""
    # Imported lazily: torch/librosa models only load in the worker
    from src.analysis.music import decide_key, detect_beats, detect_chords, detect_key, spell_chords

    # The instrumental stem carries the harmony without the melody on top
    source = "instrumental.wav" if (song_dir / "instrumental.wav").exists() else "audio.mp3"
    audio = song_dir / source
    started = time.time()
    chords = detect_chords(audio, log=log)
    key = decide_key(detect_key(audio, log=log), chords)
    chords = spell_chords(chords, key["tonic"], key["mode"])
    # Beats come from the full mix: drums carry the pulse
    beats = detect_beats(song_dir / "audio.mp3", log=log)
    write_json_atomic(analysis_path(song_dir), {
        "version": ANALYSIS_VERSION,
        "source": source,
        "key": key["key"],
        "keyConfidence": key["confidence"],
        "keyMethod": key["method"],
        "chords": chords,
        "beats": beats["beats"],
        "downbeats": beats["downbeats"],
        "bpm": beats["bpm"],
        "analyzedAt": time.time(),
    })
    log(
        f"{key['key']} ({key['method']}), {len(chords)} chord changes, {beats['bpm']} BPM "
        f"({len(beats['beats'])} beats) in {time.time() - started:.1f}s"
    )


class AnalysisQueue:
    def __init__(self):
        self._queue: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        self._pending: set[str] = set()
        self._errors: dict[str, str] = {}
        threading.Thread(target=self._worker, daemon=True).start()

    def enqueue(self, video_id):
        with self._lock:
            if video_id in self._pending:
                return
            self._pending.add(video_id)
            self._errors.pop(video_id, None)
        self._queue.put(video_id)

    def status(self, video_id):
        """'pending' while queued or running, else None (see analysis.json / error())."""
        with self._lock:
            return "pending" if video_id in self._pending else None

    def error(self, video_id):
        with self._lock:
            return self._errors.get(video_id)

    def backfill(self):
        """Queue every processed song without a current analysis."""
        from src.library import is_processed

        for song_dir in DOWNLOADS_DIR.iterdir():
            if song_dir.is_dir() and is_processed(song_dir) and needs_analysis(song_dir):
                self.enqueue(song_dir.name)

    def _worker(self):
        while True:
            video_id = self._queue.get()
            log = lambda m, vid=video_id: print(f"[analysis {vid}] {m}", flush=True)
            try:
                analyze_song(DOWNLOADS_DIR / video_id, log=log)
            except Exception as e:
                log(f"failed: {e}")
                with self._lock:
                    self._errors[video_id] = str(e)
            finally:
                with self._lock:
                    self._pending.discard(video_id)


def read_analysis(song_dir):
    data = read_status(analysis_path(song_dir))
    return data if data.get("version") else None
