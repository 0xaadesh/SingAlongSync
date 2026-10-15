/**
 * Playback engine: one main <audio> element for the whole app (plus a second one
 * for guide vocals in karaoke mode), a store for the UI state that changes rarely,
 * and a requestAnimationFrame clock for playback time.
 *
 * Time never goes through React state. Components that need it (progress bars,
 * lyrics) subscribe to the clock and write to the DOM directly, so playback
 * causes zero React re-renders per frame.
 */
import { artworkUrl, assetUrl, fetchSong, invalidateSong, setLyricsOffset, type Song, type SongDetail } from "./api";
import { recordPlay } from "./history";
import { libraryStore } from "./library";
import { createStore, useStore } from "./store";
import { toast } from "./toast";

export type PlayerState = {
  song: Song | null;
  detail: SongDetail | null;
  detailError: string | null;
  playing: boolean;
  buffering: boolean;
  duration: number;
  volume: number;
  muted: boolean;
  sheetOpen: boolean;
  /** What Next/Previous step through; null means the whole library. */
  queue: Song[] | null;
  /** Karaoke mode: play the instrumental stem, with optional guide vocals. */
  karaoke: boolean;
  /** Guide vocal volume in karaoke mode, relative to the main volume (0-1). */
  vocalLevel: number;
  /** Vocals-only mode: play just the vocal stem. Exclusive with karaoke. */
  vocalsOnly: boolean;
  /** Seconds the current song's lyrics are shifted by (positive = earlier). */
  lyricsOffset: number;
  /** Semitones the current song is transposed by; chords and key follow. */
  pitch: number;
};

export const playerStore = createStore<PlayerState>({
  song: null,
  detail: null,
  detailError: null,
  playing: false,
  buffering: false,
  duration: 0,
  volume: 0.8,
  muted: false,
  sheetOpen: false,
  queue: null,
  karaoke: false,
  vocalLevel: 0,
  vocalsOnly: false,
  lyricsOffset: 0,
  pitch: 0,
});

export const usePlayer = () => useStore(playerStore);

const VOLUME_KEY = "sas:volume";
const KARAOKE_KEY = "sas:karaoke";
const VOCAL_LEVEL_KEY = "sas:vocal-level";
const VOCALS_ONLY_KEY = "sas:vocals-only";
const PITCH_KEY = "sas:pitch";

/** Furthest the pitch can be shifted either way, in semitones. */
export const PITCH_RANGE = 6;

let audio: HTMLAudioElement | null = null;
/** Second element that plays the vocal stem alongside the instrumental in karaoke mode. */
let vocals: HTMLAudioElement | null = null;
const patch = (p: Partial<PlayerState>) => playerStore.set((s) => ({ ...s, ...p }));

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

type TimeListener = (time: number) => void;
const timeListeners = new Set<TimeListener>();
let rafId = 0;
let lastMediaTime = -1;
let anchorMedia = 0;
let anchorNow = 0;

/**
 * Some browsers only advance currentTime every few frames. Interpolate between
 * updates with the frame clock so word highlighting stays smooth.
 */
function readTime(now: number): number {
  if (!audio) return 0;
  const media = audio.currentTime;
  if (audio.paused || audio.seeking || playerStore.get().buffering || media !== lastMediaTime) {
    lastMediaTime = media;
    anchorMedia = media;
    anchorNow = now;
    return media;
  }
  const t = anchorMedia + ((now - anchorNow) / 1000) * audio.playbackRate;
  return Math.min(t, media + 0.25);
}

function frame(now: number) {
  const t = readTime(now);
  timeListeners.forEach((l) => l(t));
  rafId = requestAnimationFrame(frame);
}

function syncLoop() {
  const shouldRun = !!audio && !audio.paused && timeListeners.size > 0;
  if (shouldRun && !rafId) rafId = requestAnimationFrame(frame);
  if (!shouldRun && rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function emitNow() {
  const t = audio?.currentTime ?? 0;
  timeListeners.forEach((l) => l(t));
}

// ---------------------------------------------------------------------------
// History: the open player is reflected as ?v=<id> so Back closes it
// ---------------------------------------------------------------------------

let pushedHistoryEntry = false;

function urlVideoId() {
  return new URLSearchParams(window.location.search).get("v");
}

function onPopState() {
  const v = urlVideoId();
  const { sheetOpen, song } = playerStore.get();
  if (!v && sheetOpen) {
    pushedHistoryEntry = false;
    patch({ sheetOpen: false });
  } else if (v && !sheetOpen) {
    if (song?.videoId === v) patch({ sheetOpen: true });
    else player.openById(v);
  }
}

// ---------------------------------------------------------------------------
// Media Session (OS media keys, lock screen, headset buttons)
// ---------------------------------------------------------------------------

function updateMediaMetadata(song: Song) {
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist,
    album: song.album,
    artwork: [{ src: artworkUrl(song) }],
  });
}

function updatePositionState() {
  if (!audio || !("mediaSession" in navigator) || !Number.isFinite(audio.duration)) return;
  try {
    navigator.mediaSession.setPositionState({
      duration: audio.duration,
      position: Math.min(audio.currentTime, audio.duration),
      playbackRate: audio.playbackRate,
    });
  } catch {
    // Some browsers reject position state mid-load.
  }
}

function registerMediaSession() {
  if (!("mediaSession" in navigator)) return;
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => audio?.play()],
    ["pause", () => audio?.pause()],
    ["seekbackward", (d) => player.skip(-(d.seekOffset ?? 10))],
    ["seekforward", (d) => player.skip(d.seekOffset ?? 10)],
    ["seekto", (d) => d.seekTime != null && player.seek(d.seekTime)],
    ["previoustrack", () => player.previous()],
    ["nexttrack", () => player.next()],
  ];
  for (const [action, handler] of handlers) {
    try {
      navigator.mediaSession.setActionHandler(action, handler);
    } catch {
      // Unsupported action
    }
  }
}

// ---------------------------------------------------------------------------
// Karaoke: instrumental on the main element, vocals on a second one kept in sync.
// Vocals only: the vocal stem on the main element, second one unused.
// ---------------------------------------------------------------------------

function mainSource(song: Song) {
  const { karaoke, vocalsOnly } = playerStore.get();
  if (song.stems && vocalsOnly) return assetUrl(song.stems.vocals)!;
  if (song.stems && karaoke) return assetUrl(song.stems.instrumental)!;
  return assetUrl(song.audio)!;
}

/** Point the main element at the source for the current mode, keeping position and play state. */
function switchMainSource() {
  const { song } = playerStore.get();
  if (!audio || !song) return;
  const source = mainSource(song);
  if (audio.src !== source) {
    const time = audio.currentTime;
    const wasPlaying = !audio.paused;
    audio.src = source;
    // Applied once the new source loads
    audio.currentTime = time;
    if (wasPlaying) audio.play().catch(() => {});
  }
  setVocalsSource(song);
  alignVocals();
}

function vocalsWanted() {
  const { karaoke, song, vocalLevel } = playerStore.get();
  return !!(karaoke && song?.stems && vocalLevel > 0);
}

function setVocalsSource(song: Song | null) {
  if (!vocals) return;
  const url = playerStore.get().karaoke && song?.stems ? assetUrl(song.stems.vocals) : null;
  if (url) {
    if (vocals.src !== url) vocals.src = url;
  } else if (vocals.getAttribute("src")) {
    vocals.pause();
    vocals.removeAttribute("src");
    vocals.load();
  }
}

function applyVocalsVolume() {
  if (!vocals || !audio) return;
  vocals.volume = Math.min(1, audio.volume * playerStore.get().vocalLevel);
  vocals.muted = audio.muted;
}

/** Snap the vocals to the instrumental's position and match its play state. */
function alignVocals() {
  if (!vocals || !audio) return;
  if (!vocalsWanted() || audio.paused) {
    vocals.pause();
    return;
  }
  vocals.currentTime = audio.currentTime;
  vocals.playbackRate = 1;
  vocals.play().catch(() => {});
}

let driftTimer = 0;

/**
 * Two media elements drift apart over a song. Nudge the vocals' playback rate to
 * close small gaps inaudibly, and jump when they're clearly apart.
 */
function correctDrift() {
  if (!audio || !vocals || audio.paused || !vocalsWanted()) return;
  if (vocals.paused) return alignVocals();
  const diff = vocals.currentTime - audio.currentTime;
  if (Math.abs(diff) > 0.25) {
    vocals.currentTime = audio.currentTime;
    vocals.playbackRate = 1;
  } else if (Math.abs(diff) > 0.03) {
    vocals.playbackRate = 1 - Math.max(-0.05, Math.min(0.05, diff));
  } else {
    vocals.playbackRate = 1;
  }
}

// ---------------------------------------------------------------------------
// Pitch: both elements routed through a Web Audio pitch shifter. The graph is
// built the first time a shift is used; from then on the elements only sound
// through it (it passes audio straight through at 0).
// ---------------------------------------------------------------------------

let audioContext: AudioContext | null = null;
let shifter: AudioWorkletNode | null = null;
let pitchGraph: Promise<void> | null = null;

/** Per-song shifts, keyed by video id; songs at 0 aren't stored. */
function storedPitches(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(PITCH_KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
}

function ensurePitchGraph() {
  if (pitchGraph || !audio || !vocals) return;
  const main = audio;
  const guide = vocals;
  const ctx = new AudioContext();
  pitchGraph = ctx.audioWorklet
    .addModule("/pitch-shifter.js")
    .then(() => {
      shifter = new AudioWorkletNode(ctx, "pitch-shifter", {
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: "explicit",
      });
      ctx.createMediaElementSource(main).connect(shifter);
      ctx.createMediaElementSource(guide).connect(shifter);
      shifter.connect(ctx.destination);
      audioContext = ctx;
      applyPitch();
      if (!main.paused) ctx.resume().catch(() => {});
    })
    .catch(() => {
      pitchGraph = null;
      shifter = null;
      ctx.close().catch(() => {});
      toast({ title: "Couldn't change the pitch in this browser", tone: "error" });
    });
}

function applyPitch() {
  shifter?.port.postMessage({ ratio: 2 ** (playerStore.get().pitch / 12) });
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

let offsetSaveTimer = 0;

function loadSong(song: Song, autoplay: boolean) {
  if (!audio) return;
  const pitch = storedPitches()[song.videoId] ?? 0;
  patch({ song, detail: null, detailError: null, duration: song.duration, buffering: autoplay, lyricsOffset: song.lyricsOffset ?? 0, pitch });
  if (pitch !== 0) ensurePitchGraph();
  applyPitch();
  audio.src = mainSource(song);
  setVocalsSource(song);
  if (autoplay) {
    audio.play().catch(() => {});
    recordPlay(song.videoId);
  }
  emitNow();
  updateMediaMetadata(song);
  if (playerStore.get().sheetOpen) window.history.replaceState(null, "", `?v=${song.videoId}`);

  fetchSong(song.videoId)
    .then((detail) => {
      if (playerStore.get().song?.videoId === song.videoId) patch({ detail });
    })
    .catch((e: Error) => {
      if (playerStore.get().song?.videoId === song.videoId) patch({ detailError: e.message });
    });
}

/** The list Next/Previous move through, and the current song's place in it. */
export function queuePosition(state: PlayerState = playerStore.get(), library: Song[] = libraryStore.get().songs) {
  const songs = state.queue ?? library;
  return { songs, index: songs.findIndex((s) => s.videoId === state.song?.videoId) };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export const player = {
  /** Wire up the app's audio elements (main + karaoke vocals). Returns a cleanup function. */
  attach(el: HTMLAudioElement, vocalsEl: HTMLAudioElement) {
    audio = el;
    vocals = vocalsEl;
    const stored = parseFloat(localStorage.getItem(VOLUME_KEY) ?? "");
    el.volume = stored >= 0 && stored <= 1 ? stored : 0.8;
    const storedLevel = parseFloat(localStorage.getItem(VOCAL_LEVEL_KEY) ?? "");
    patch({
      volume: el.volume,
      karaoke: localStorage.getItem(KARAOKE_KEY) === "true",
      vocalsOnly: localStorage.getItem(KARAOKE_KEY) !== "true" && localStorage.getItem(VOCALS_ONLY_KEY) === "true",
      vocalLevel: storedLevel >= 0 && storedLevel <= 1 ? storedLevel : 0,
    });
    applyVocalsVolume();
    driftTimer = window.setInterval(correctDrift, 250);

    const on = <K extends keyof HTMLMediaElementEventMap>(type: K, fn: () => void) => {
      el.addEventListener(type, fn);
      return () => el.removeEventListener(type, fn);
    };

    const offs = [
      on("play", () => {
        patch({ playing: true });
        audioContext?.resume().catch(() => {});
        syncLoop();
        alignVocals();
        updatePositionState();
      }),
      on("pause", () => {
        patch({ playing: false, buffering: false });
        syncLoop();
        vocals?.pause();
        emitNow();
        updatePositionState();
      }),
      on("waiting", () => {
        patch({ buffering: true });
        vocals?.pause();
      }),
      on("playing", () => {
        patch({ buffering: false });
        alignVocals();
      }),
      on("canplay", () => patch({ buffering: false })),
      on("seeked", () => {
        emitNow();
        alignVocals();
        updatePositionState();
      }),
      on("durationchange", () => {
        if (Number.isFinite(el.duration)) patch({ duration: el.duration });
        updatePositionState();
      }),
      on("volumechange", () => {
        patch({ volume: el.volume, muted: el.muted });
        applyVocalsVolume();
      }),
      on("ended", () => {
        const { songs, index } = queuePosition();
        if (index >= 0 && index < songs.length - 1) loadSong(songs[index + 1], true);
        else {
          el.currentTime = 0;
          emitNow();
        }
      }),
      on("error", () => {
        if (el.getAttribute("src")) {
          patch({ playing: false, buffering: false });
          toast({ title: "Couldn't play this track", tone: "error" });
        }
      }),
    ];

    registerMediaSession();
    window.addEventListener("popstate", onPopState);

    // Deep link: /?v=<id> opens that song's player (paused; browsers block autoplay here).
    const v = urlVideoId();
    if (v) player.openById(v);

    return () => {
      offs.forEach((off) => off());
      window.removeEventListener("popstate", onPopState);
      cancelAnimationFrame(rafId);
      clearInterval(driftTimer);
      rafId = 0;
      audio = null;
      vocals = null;
    };
  },

  /**
   * Play a song (or resume it if it's the current one) and open the lyrics view.
   * `queue` sets what Next/Previous step through (an album, an artist…); omit for the library.
   */
  play(song: Song, { open = true, queue = null }: { open?: boolean; queue?: Song[] | null } = {}) {
    if (!audio) return;
    patch({ queue });
    if (playerStore.get().song?.videoId === song.videoId) {
      if (audio.paused) audio.play().catch(() => {});
    } else {
      loadSong(song, true);
    }
    if (open) player.openSheet();
  },

  openById(videoId: string) {
    fetchSong(videoId)
      .then((detail) => {
        if (playerStore.get().song?.videoId !== videoId) loadSong(detail, false);
        patch({ detail, sheetOpen: true });
      })
      .catch(() => {
        window.history.replaceState(null, "", window.location.pathname);
        toast({ title: "That song isn't in your library", tone: "error" });
      });
  },

  /** Stop playback and clear the current song (e.g. it was deleted). */
  unload() {
    if (!audio) return;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    setVocalsSource(null);
    if (playerStore.get().sheetOpen) player.closeSheet();
    patch({ song: null, detail: null, detailError: null, playing: false, buffering: false, duration: 0, queue: null });
    if ("mediaSession" in navigator) navigator.mediaSession.metadata = null;
  },

  /** Switch karaoke mode (turns vocals-only off), keeping the playback position and play state. */
  setKaraoke(on: boolean) {
    patch(on ? { karaoke: true, vocalsOnly: false } : { karaoke: false });
    localStorage.setItem(KARAOKE_KEY, String(on));
    if (on) localStorage.setItem(VOCALS_ONLY_KEY, "false");
    switchMainSource();
  },

  /** Switch vocals-only mode (turns karaoke off), keeping the playback position and play state. */
  setVocalsOnly(on: boolean) {
    patch(on ? { vocalsOnly: true, karaoke: false } : { vocalsOnly: false });
    localStorage.setItem(VOCALS_ONLY_KEY, String(on));
    if (on) localStorage.setItem(KARAOKE_KEY, "false");
    switchMainSource();
  },

  /** Guide vocal volume in karaoke mode (0 = instrumental only). */
  setVocalLevel(level: number) {
    const vocalLevel = Math.max(0, Math.min(1, level));
    const wasWanted = vocalsWanted();
    patch({ vocalLevel });
    localStorage.setItem(VOCAL_LEVEL_KEY, String(vocalLevel));
    applyVocalsVolume();
    // Re-seeking the vocals on every slider step makes them stutter; only start or stop them
    if (vocalsWanted() !== wasWanted) alignVocals();
  },

  /** Transpose the current song by whole semitones (0 = original). Remembered per song. */
  setPitch(semitones: number) {
    const { song } = playerStore.get();
    if (!song) return;
    const pitch = Math.round(Math.max(-PITCH_RANGE, Math.min(PITCH_RANGE, semitones)));
    patch({ pitch });
    const stored = storedPitches();
    if (pitch === 0) delete stored[song.videoId];
    else stored[song.videoId] = pitch;
    localStorage.setItem(PITCH_KEY, JSON.stringify(stored));
    if (pitch !== 0) ensurePitchGraph();
    applyPitch();
  },

  /** Shift the current song's lyrics (seconds, positive = earlier). Saved after a short pause. */
  setLyricsOffset(offset: number) {
    const { song, detail } = playerStore.get();
    if (!song) return;
    const lyricsOffset = Math.round(Math.max(-10, Math.min(10, offset)) * 100) / 100;
    patch({ lyricsOffset, detail: detail && { ...detail, lyricsOffset } });
    // Keep the library copy in step so reopening the song uses the new offset
    libraryStore.set((s) => ({
      ...s,
      songs: s.songs.map((x) => (x.videoId === song.videoId ? { ...x, lyricsOffset } : x)),
    }));
    emitNow();
    clearTimeout(offsetSaveTimer);
    offsetSaveTimer = window.setTimeout(() => {
      invalidateSong(song.videoId);
      setLyricsOffset(song.videoId, lyricsOffset).catch(() =>
        toast({ title: "Couldn't save the lyrics timing", tone: "error" }),
      );
    }, 600);
  },

  /** Re-send the current time to subscribers (e.g. after the lyrics offset changes while paused). */
  resync: () => emitNow(),

  /** Refetch the current song's detail (e.g. once its translations are ready). */
  async refreshDetail() {
    const id = playerStore.get().song?.videoId;
    if (!id) return null;
    invalidateSong(id);
    const detail = await fetchSong(id);
    if (playerStore.get().song?.videoId === id) patch({ detail });
    return detail;
  },

  resume() {
    if (audio?.paused && playerStore.get().song) audio.play().catch(() => {});
  },

  toggle() {
    if (!audio || !playerStore.get().song) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  },

  seek(time: number) {
    if (!audio) return;
    const max = Number.isFinite(audio.duration) ? audio.duration : playerStore.get().duration;
    audio.currentTime = Math.max(0, Math.min(time, max || 0));
    emitNow();
  },

  skip(delta: number) {
    if (audio) player.seek(audio.currentTime + delta);
  },

  next() {
    const { songs, index } = queuePosition();
    if (index >= 0 && index < songs.length - 1) loadSong(songs[index + 1], true);
  },

  previous() {
    if (!audio) return;
    const { songs, index } = queuePosition();
    if (audio.currentTime > 3 || index <= 0) player.seek(0);
    else loadSong(songs[index - 1], true);
  },

  setVolume(volume: number) {
    if (!audio) return;
    audio.volume = Math.max(0, Math.min(1, volume));
    audio.muted = false;
    localStorage.setItem(VOLUME_KEY, String(audio.volume));
  },

  toggleMute() {
    if (audio) audio.muted = !audio.muted;
  },

  openSheet() {
    const { song, sheetOpen } = playerStore.get();
    if (!song || sheetOpen) return;
    patch({ sheetOpen: true });
    if (urlVideoId() !== song.videoId) {
      window.history.pushState(null, "", `?v=${song.videoId}`);
      pushedHistoryEntry = true;
    }
  },

  closeSheet() {
    if (!playerStore.get().sheetOpen) return;
    if (pushedHistoryEntry) {
      // popstate closes the sheet, keeping Back and the close button in agreement
      window.history.back();
    } else {
      patch({ sheetOpen: false });
      window.history.replaceState(null, "", window.location.pathname);
    }
  },

  getTime: () => audio?.currentTime ?? 0,

  /** Subscribe to playback time: every frame while playing, once per seek or pause otherwise. */
  subscribeTime(listener: TimeListener) {
    timeListeners.add(listener);
    listener(audio?.currentTime ?? 0);
    syncLoop();
    return () => {
      timeListeners.delete(listener);
      syncLoop();
    };
  },
};
