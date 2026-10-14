"""
One lock for the GPU. Processing jobs (Demucs, WhisperX) and key/chord/beat analysis
each fill most of a laptop GPU's memory, so running them side by side ran analysis out
of memory whenever songs were queued back to back. Whoever holds this runs alone.
"""
import threading

GPU_LOCK = threading.Lock()
