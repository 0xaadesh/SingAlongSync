"""
Background translation for songs already in the library (from the settings page
or a single song's "Translate" button). One song at a time; failures are kept
per song so the UI can show them.
"""
import queue
import threading

from src import settings as settings_store
from src.config import DOWNLOADS_DIR
from src.translate import translate_song


class TranslationQueue:
    def __init__(self):
        self._queue: queue.Queue[str] = queue.Queue()
        self._lock = threading.Lock()
        self._pending: set[str] = set()
        self._current: str | None = None
        self._errors: dict[str, str] = {}
        self._done = 0
        threading.Thread(target=self._worker, daemon=True).start()

    def status(self):
        with self._lock:
            return {
                "pending": len(self._pending),
                "current": self._current,
                "done": self._done,
                "errors": dict(self._errors),
                "untranslated": len(untranslated_songs()),
            }

    def enqueue(self, video_ids):
        added = 0
        with self._lock:
            for video_id in video_ids:
                if video_id in self._pending or video_id == self._current:
                    continue
                self._pending.add(video_id)
                self._errors.pop(video_id, None)
                self._queue.put(video_id)
                added += 1
        return added

    def _worker(self):
        while True:
            video_id = self._queue.get()
            with self._lock:
                self._pending.discard(video_id)
                self._current = video_id
            try:
                translate_song(DOWNLOADS_DIR / video_id, settings_store.load())
                with self._lock:
                    self._done += 1
            except Exception as e:
                with self._lock:
                    self._errors[video_id] = str(e)
            finally:
                with self._lock:
                    self._current = None


def untranslated_songs():
    return [
        d.name
        for d in DOWNLOADS_DIR.iterdir()
        if d.is_dir() and (d / "karaoke.json").exists() and not (d / "translations.json").exists()
    ]
