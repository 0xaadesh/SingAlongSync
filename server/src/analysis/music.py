"""
Musical key and chord detection with pretrained neural models.

  - Key:    S-KEY (Deezer, ICASSP 2025) on a constant-Q transform of the audio
  - Chords: BTC (Bi-directional Transformer for Chords, 170-chord vocabulary) with
            ChordMini's improved weights (pseudo-labelling + continual learning, 2026)

Model code is vendored (see btc/ and skey/, MIT). Weights are downloaded on first use
from the original repositories, pinned to a commit and verified by SHA-256.
"""
import hashlib
import math

import librosa
import numpy as np
import requests
import torch

from src.config import CACHE_DIR

from .btc.btc_model import BTC_model
from .skey.chromanet import ChromaNet
from .skey.hcqt import VQT, CropCQT

MODELS_DIR = CACHE_DIR / "models"

WEIGHTS = {
    "btc": {
        "file": "chordmini_btc.pth",
        "url": "https://raw.githubusercontent.com/ptnghia-j/ChordMini/aa6e3a8d7b017f082fd2aaff9329d5c26af49c03/checkpoints/btc_model_best.pth",
        "sha256": "e0a12ca6d881f81e01dfb459b4836ec7dac8d8f87b0170a412b5807256b3a1fc",
    },
    "skey": {
        "file": "skey.pt",
        "url": "https://raw.githubusercontent.com/deezer/skey/918b83d273568d5041569bb8068843d19a335726/skey/models/skey.pt",
        "sha256": "78dfd0ad4fa9434bf7cec70a25934b7c575bda9c80e994700140770ad3a5ead4",
    },
}

DEVICE = "cuda" if torch.cuda.is_available() else "cpu"


def _sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def weights_path(name, log=print):
    """Local path to a model's weights, downloading and verifying them the first time."""
    spec = WEIGHTS[name]
    path = MODELS_DIR / spec["file"]
    if path.exists() and _sha256(path) == spec["sha256"]:
        return path
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    log(f"Downloading {name} model weights…")
    tmp = path.with_suffix(".part")
    with requests.get(spec["url"], stream=True, timeout=60) as res:
        res.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in res.iter_content(1 << 20):
                f.write(chunk)
    if _sha256(tmp) != spec["sha256"]:
        tmp.unlink(missing_ok=True)
        raise RuntimeError(f"{name} weights failed the checksum; not using them.")
    tmp.replace(path)
    return path


def _load_checkpoint(name, log=print):
    # These checkpoints contain plain Python objects alongside tensors, so they need
    # weights_only=False; only the pinned, checksum-verified files above are loaded.
    return torch.load(weights_path(name, log), map_location="cpu", weights_only=False)


# ---------------------------------------------------------------------------
# Key (S-KEY)
# ---------------------------------------------------------------------------

# Class order used by the S-KEY checkpoint
SKEY_LABELS = [
    "A major", "Bb major", "B major", "C major", "C# major", "D major", "Eb major", "E major",
    "F major", "F# major", "G major", "Ab major", "B minor", "C minor", "C# minor", "D minor",
    "Eb minor", "E minor", "F minor", "F# minor", "G minor", "G# minor", "A minor", "Bb minor",
]


_models = {}


def _skey_model(log=print):
    if "skey" not in _models:
        ckpt = _load_checkpoint("skey", log)
        device = torch.device(DEVICE)
        hcqt = VQT(harmonics=[1], fmin=27.5, n_bins=99).to(device)
        chromanet = ChromaNet(
            n_bins=84, n_harmonics=1, out_channels=[2, 3, 40, 40, 30, 10, 3], kernels=[7, 7, 7, 7, 7, 5, 5], temperature=1
        ).to(device)
        hcqt.load_state_dict({k.replace("hcqt.", ""): v for k, v in ckpt["stone"].items() if "hcqt" in k})
        chromanet.load_state_dict({k.replace("chromanet.", ""): v for k, v in ckpt["stone"].items() if "chromanet" in k})
        hcqt.eval()
        chromanet.eval()
        _models["skey"] = (hcqt, chromanet, CropCQT(84), ckpt["audio"]["sr"])
    return _models["skey"]


def detect_key(audio_path, log=print):
    """{"key": "A minor", "confidence": 0-1, "alternatives": [...]} for the whole song (S-KEY alone)."""
    hcqt, chromanet, crop, sr = _skey_model(log)
    device = torch.device(DEVICE)

    audio, _ = librosa.load(str(audio_path), sr=sr, mono=True)
    peak = float(np.max(np.abs(audio))) or 1.0
    waveform = torch.from_numpy(audio / peak).float().view(1, 1, -1).to(device)

    with torch.no_grad():
        scores = chromanet(crop(hcqt(waveform), torch.zeros(1, device=device)))
        scores = scores.mean(dim=0).flatten()
        # Treat the model's outputs as a distribution for a confidence figure
        probs = scores / scores.sum() if bool((scores >= 0).all()) and float(scores.sum()) > 0 else torch.softmax(scores, 0)

    order = torch.argsort(probs, descending=True).tolist()
    return {
        "key": SKEY_LABELS[order[0]],
        "confidence": round(float(probs[order[0]]), 3),
        "alternatives": [{"key": SKEY_LABELS[i], "confidence": round(float(probs[i]), 3)} for i in order[1:3]],
    }


# ---------------------------------------------------------------------------
# Chords (BTC with ChordMini weights)
# ---------------------------------------------------------------------------

BTC_SR = 22050
BTC_HOP = 2048
BTC_SEQ_LEN = 108
PITCHES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
QUALITIES = ["min", "maj", "dim", "aug", "min6", "maj6", "min7", "minmaj7", "maj7", "7", "dim7", "hdim7", "sus2", "sus4"]
# Harte quality -> how chords are usually written on a lead sheet
QUALITY_SYMBOL = {
    "maj": "", "min": "m", "dim": "dim", "aug": "aug", "min6": "m6", "maj6": "6", "min7": "m7",
    "minmaj7": "m(maj7)", "maj7": "maj7", "7": "7", "dim7": "dim7", "hdim7": "m7b5", "sus2": "sus2", "sus4": "sus4",
}
NO_CHORD = 169
UNKNOWN_CHORD = 168


def chord_name(index):
    """Lead-sheet name for a BTC class index, or None for no chord / unknown."""
    if index >= UNKNOWN_CHORD:
        return None
    root, quality = PITCHES[index // 14], QUALITIES[index % 14]
    return root + QUALITY_SYMBOL[quality]


def _segments(frame_labels, frame_duration, min_duration):
    """Merge per-frame labels into segments, folding very short ones into the previous one."""
    segments = []
    for i, label in enumerate(frame_labels):
        start = i * frame_duration
        if segments and segments[-1]["chord"] == label:
            segments[-1]["end"] = start + frame_duration
        else:
            segments.append({"start": start, "end": start + frame_duration, "chord": label})
    merged = []
    for seg in segments:
        if merged and (seg["end"] - seg["start"] < min_duration or merged[-1]["chord"] == seg["chord"]):
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(dict(seg))
    # Drop "no chord" stretches, then join neighbours that ended up with the same chord
    result = []
    for s in merged:
        if s["chord"] is None:
            continue
        if result and result[-1]["chord"] == s["chord"] and s["start"] - result[-1]["end"] < min_duration:
            result[-1]["end"] = s["end"]
        else:
            result.append(dict(s))
    return [{"start": round(s["start"], 3), "end": round(s["end"], 3), "chord": s["chord"]} for s in result]


def _btc_model(log=print):
    if "btc" not in _models:
        ckpt = _load_checkpoint("btc", log)
        state = ckpt.get("model_state_dict", ckpt.get("model", ckpt))
        state = {k.replace("module.", ""): v for k, v in state.items()}
        norm = ckpt.get("normalization") or {}
        mean = float(norm.get("mean", ckpt.get("mean", 0.0)))
        std = max(float(norm.get("std", ckpt.get("std", 1.0))), 1e-8)
        model = BTC_model({"seq_len": BTC_SEQ_LEN, "feature_size": 144, "num_chords": 170}).to(torch.device(DEVICE))
        model.load_state_dict(state)
        model.eval()
        _models["btc"] = (model, mean, std)
    return _models["btc"]


def detect_chords(audio_path, min_duration=0.3, log=print):
    """[{"start", "end", "chord"}] in seconds; gaps mean no chord."""
    model, mean, std = _btc_model(log)
    device = torch.device(DEVICE)

    audio, _ = librosa.load(str(audio_path), sr=BTC_SR, mono=True)
    cqt = librosa.cqt(audio, sr=BTC_SR, n_bins=144, bins_per_octave=24, hop_length=BTC_HOP, fmin=librosa.note_to_hz("C1"))
    features = np.log(np.abs(cqt) + 1e-6).T.astype(np.float32)
    n_frames = features.shape[0]

    # 108-frame windows (about 10 s, as trained) overlapping by half. Predictions near a
    # window's edges are unreliable, so each frame's chord comes from the average of the
    # probabilities of every window covering it.
    stride = BTC_SEQ_LEN // 2
    total = max(BTC_SEQ_LEN, math.ceil((n_frames - BTC_SEQ_LEN) / stride) * stride + BTC_SEQ_LEN)
    padded = np.pad(features, ((0, total - n_frames), (0, 0)))
    starts = list(range(0, total - BTC_SEQ_LEN + 1, stride))
    windows = torch.from_numpy(np.stack([padded[s:s + BTC_SEQ_LEN] for s in starts])).to(device)
    windows = (windows - mean) / (std + 1e-8)

    probs = torch.zeros(total, 170, device=device)
    counts = torch.zeros(total, 1, device=device)
    with torch.no_grad():
        for i in range(0, len(starts), 16):
            batch_probs = torch.softmax(model(windows[i:i + 16]), dim=-1)
            for j, start in enumerate(starts[i:i + 16]):
                probs[start:start + BTC_SEQ_LEN] += batch_probs[j]
                counts[start:start + BTC_SEQ_LEN] += 1
    frame_classes = (probs / counts.clamp(min=1)).argmax(dim=-1)[:n_frames].cpu().numpy()

    labels = [chord_name(int(c)) for c in frame_classes]
    return _segments(labels, BTC_HOP / BTC_SR, min_duration)


# ---------------------------------------------------------------------------
# Key decision and spelling
# ---------------------------------------------------------------------------

# Chord quality symbol -> intervals of its tones above the root
CHORD_TONES = {
    "": [0, 4, 7], "m": [0, 3, 7], "dim": [0, 3, 6], "aug": [0, 4, 8], "m6": [0, 3, 7, 9], "6": [0, 4, 7, 9],
    "m7": [0, 3, 7, 10], "m(maj7)": [0, 3, 7, 11], "maj7": [0, 4, 7, 11], "7": [0, 4, 7, 10], "dim7": [0, 3, 6, 9],
    "m7b5": [0, 3, 6, 10], "sus2": [0, 2, 7], "sus4": [0, 5, 7],
}
# Temperley key profiles (suit pop harmony)
MAJOR_PROFILE = np.array([5.0, 2.0, 3.5, 2.0, 4.5, 4.0, 2.0, 4.5, 2.0, 3.5, 1.5, 4.0])
MINOR_PROFILE = np.array([5.0, 2.0, 3.5, 4.5, 2.0, 4.0, 2.0, 4.5, 3.5, 2.0, 1.5, 4.0])

# Conventional key names, and whether each key is written with flats
MAJOR_NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MINOR_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "G#", "A", "Bb", "B"]
FLAT_MAJOR = {1, 3, 5, 8, 10}  # Db Eb F Ab Bb
FLAT_MINOR = {0, 2, 3, 5, 7, 10}  # Cm Dm Ebm Fm Gm Bbm
SHARP_TO_FLAT = {"C#": "Db", "D#": "Eb", "F#": "Gb", "G#": "Ab", "A#": "Bb"}
ENHARMONIC_PC = {"Db": 1, "Eb": 3, "Gb": 6, "Ab": 8, "Bb": 10}


def parse_chord(chord):
    """("A#m7") -> (10, "m7")."""
    for root in sorted(PITCHES + list(ENHARMONIC_PC), key=len, reverse=True):
        if chord.startswith(root):
            pc = PITCHES.index(root) if root in PITCHES else ENHARMONIC_PC[root]
            return pc, chord[len(root):]
    return None, None


def _parse_key(label):
    tonic, mode = label.split()
    pc = PITCHES.index(tonic) if tonic in PITCHES else ENHARMONIC_PC[tonic]
    return pc, mode.lower()


def key_name(pc, mode):
    return f"{(MAJOR_NAMES if mode == 'major' else MINOR_NAMES)[pc]} {mode}"


def chord_key_scores(chords):
    """{(pc, mode): correlation} of the duration-weighted chord-tone profile with all 24 keys."""
    profile = np.zeros(12)
    for c in chords:
        root, quality = parse_chord(c["chord"])
        if root is None or quality not in CHORD_TONES:
            continue
        duration = c["end"] - c["start"]
        for i, interval in enumerate(CHORD_TONES[quality]):
            profile[(root + interval) % 12] += duration * (1.5 if i == 0 else 1.0)
    if not profile.any():
        return {}
    return {
        (pc, mode): float(np.corrcoef(profile, np.roll(prof, pc))[0, 1])
        for pc in range(12)
        for mode, prof in (("major", MAJOR_PROFILE), ("minor", MINOR_PROFILE))
    }


def decide_key(skey_result, chords):
    """
    Combine the audio model with the chords. S-KEY is reliable on the tonic but often
    flips major/minor; the chords settle the mode when both agree on the tonic.
    (Tested on the user's songs: fixes parallel-mode errors, keeps relative-key calls.)
    """
    pc, mode = _parse_key(skey_result["key"])
    method = "audio"
    scores = chord_key_scores(chords)
    if scores:
        chord_pc, chord_mode = max(scores, key=scores.get)
        if chord_pc == pc and chord_mode != mode:
            mode, method = chord_mode, "audio+chords"
    return {"key": key_name(pc, mode), "tonic": pc, "mode": mode, "confidence": skey_result["confidence"], "method": method}


def spell_chords(chords, tonic, mode):
    """Rewrite sharps as flats in flat keys (Eb, not D#, in F minor)."""
    if tonic not in (FLAT_MAJOR if mode == "major" else FLAT_MINOR):
        return chords
    out = []
    for c in chords:
        name = c["chord"]
        root = name[:2] if name[:2] in SHARP_TO_FLAT else None
        out.append({**c, "chord": SHARP_TO_FLAT[root] + name[2:] if root else name})
    return out


# ---------------------------------------------------------------------------
# Beats (beat_this, CPJKU 2024)
# ---------------------------------------------------------------------------


def _beat_model(log=print):
    if "beats" not in _models:
        from beat_this.inference import Audio2Beats

        log("Loading beat tracker…")
        # "final0" downloads once from JKU into the torch hub cache (loaded weights-only)
        _models["beats"] = Audio2Beats(checkpoint_path="final0", device=DEVICE, float16=False, dbn=False)
    return _models["beats"]


def detect_beats(audio_path, log=print):
    """{"beats": [s…], "downbeats": [s…], "bpm": float} — downbeats are bar starts."""
    tracker = _beat_model(log)
    audio, sr = librosa.load(str(audio_path), sr=22050, mono=True)
    beats, downbeats = tracker(audio, sr)
    beats = [round(float(b), 3) for b in beats]
    downbeats = [round(float(b), 3) for b in downbeats]
    intervals = np.diff(beats)
    bpm = round(60.0 / float(np.median(intervals)), 1) if len(intervals) else None
    return {"beats": beats, "downbeats": downbeats, "bpm": bpm}
