export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");

export type Word = { word: string; start: number; end: number };

export type KaraokeLine = { line: string; start: number; end: number; words: Word[] };

export type Song = {
  videoId: string;
  title: string;
  artist: string;
  /** Individual credited artists ("A, B & C" split up). */
  artists: string[];
  album: string;
  genre: string | null;
  year: string | null;
  /** From YouTube Music; null when unknown. */
  explicit: boolean | null;
  duration: number;
  thumbnail: string | null;
  artwork: string | null;
  audio: string;
  addedAt: number;
  /** Compressed stems for karaoke mode; null until encoded. */
  stems: { instrumental: string; vocals: string } | null;
  /** Seconds to shift the lyrics by (positive = lyrics earlier). */
  lyricsOffset: number;
  /** False for songs saved without synced lyrics (they can be added from the player). */
  hasLyrics: boolean;
  /** Detected key, e.g. "A minor"; null until analysed. */
  key: string | null;
};

export type ChordSegment = { start: number; end: number; chord: string };

export type SongAnalysis = {
  key: string;
  keyConfidence: number;
  keyMethod: "audio" | "audio+chords";
  chords: ChordSegment[];
  source: string;
  /** Beat and bar-start times in seconds (beat_this). */
  beats: number[];
  downbeats: number[];
  bpm: number | null;
};

export type SongDetail = Song & {
  lines: KaraokeLine[];
  /** English for non-English lines, keyed by line index; null until translated. */
  translations: Record<string, string> | null;
  /** Latin-letter pronunciation for non-Latin-script lines; null if not generated yet. */
  romanizations: Record<string, string> | null;
  /** Key and chords, detected in the background after processing. */
  analysis: SongAnalysis | null;
  analysisStatus: "ready" | "pending" | "failed" | "none";
};

export type StepKey = "download" | "lyrics" | "separate" | "align" | "translate";
export type StepStatus = "pending" | "active" | "done" | "failed" | "skipped";
export type JobState = "queued" | "running" | "done" | "failed" | "cancelled";

export type Job = {
  id: string;
  url: string;
  state: JobState;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  error: string | null;
  steps: { key: StepKey; status: StepStatus }[];
  stepProgress: number | null;
  title: string | null;
  artist: string | null;
  artwork: string | null;
  translationError: string | null;
  /** Finished (or finishing) without synced lyrics. */
  noLyrics: boolean;
};

export class ApiError extends Error {}

/** Absolute URL for a server path like /downloads/<id>/audio.mp3. */
export function assetUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return path.startsWith("http") ? path : API_URL + path;
}

/** Best artwork for a song: the local copy (CORS-readable for colour sampling) or YouTube's. */
export function artworkUrl(song: Pick<Song, "artwork" | "thumbnail" | "videoId">): string {
  return (
    assetUrl(song.artwork) ?? song.thumbnail ?? `https://i.ytimg.com/vi/${song.videoId}/hqdefault.jpg`
  );
}

/**
 * crossOrigin value for an image URL. Our server sends CORS headers (needed to sample
 * artwork colours); third-party thumbnails may not, and would fail to load in CORS mode.
 */
export function imageCors(url: string): "anonymous" | undefined {
  return url.startsWith(API_URL) ? "anonymous" : undefined;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(API_URL + path, init);
  } catch {
    throw new ApiError("Can't reach the SingAlongSync server.");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(typeof body?.detail === "string" ? body.detail : `Request failed (${res.status})`);
  }
  return res.json();
}

export function fetchSongs(signal?: AbortSignal) {
  return request<Song[]>("/api/songs", { signal, cache: "no-store" });
}

const songCache = new Map<string, Promise<SongDetail>>();

/** Song with lyrics. Cached per session; call on hover to make opening instant. */
export function fetchSong(videoId: string): Promise<SongDetail> {
  let pending = songCache.get(videoId);
  if (!pending) {
    pending = request<SongDetail>(`/api/songs/${videoId}`);
    pending.catch(() => songCache.delete(videoId));
    songCache.set(videoId, pending);
  }
  return pending;
}

export function prefetchSong(videoId: string) {
  fetchSong(videoId).catch(() => {});
}

export async function deleteSong(videoId: string) {
  await request<{ ok: boolean }>(`/api/songs/${videoId}`, { method: "DELETE" });
  songCache.delete(videoId);
}

export type SearchResult = {
  videoId: string;
  title: string;
  artist: string;
  artists: string[];
  album: string | null;
  duration: number | null;
  explicit: boolean;
  thumbnail: string | null;
  inLibrary: boolean;
};

/** Song search on YouTube Music (through our server). */
export function searchSongs(query: string, signal?: AbortSignal) {
  return request<SearchResult[]>(`/api/search?q=${encodeURIComponent(query)}`, { signal });
}

/** Artist name to avatar URL, for artists credited in the library. */
export function fetchArtistAvatars() {
  return request<Record<string, string>>("/api/artists", { cache: "no-store" });
}

export const watchUrl = (videoId: string) => `https://music.youtube.com/watch?v=${videoId}`;

export type ProviderId = "openai" | "google" | "anthropic" | "groq" | "xai" | "openrouter";

export type Settings = {
  provider: ProviderId | null;
  model: string | null;
  translationEnabled: boolean;
  /** Enabled and fully configured. */
  ready: boolean;
  /** Masked saved key per provider, null when none. */
  keys: Record<ProviderId, string | null>;
  providers: { id: ProviderId; name: string }[];
  /** Browser yt-dlp reads YouTube cookies from, or null. */
  cookiesBrowser: string | null;
  /** Path to an exported cookies.txt, or null. */
  cookiesFile: string | null;
  cookieBrowsers: string[];
  alignmentMode: AlignmentMode;
};

export type AlignmentMode = "auto" | "native" | "romanized";

export type SettingsUpdate = Partial<Pick<Settings, "provider" | "model" | "translationEnabled" | "alignmentMode">> & {
  apiKey?: string;
  /** Empty string clears. */
  cookiesBrowser?: string;
  cookiesFile?: string;
};

export const checkYouTubeAccess = () => request<{ ok: boolean; message: string }>("/api/youtube/check", { method: "POST" });

export type ModelOption = { id: string; name: string };

export type TranslationStatus = {
  pending: number;
  current: string | null;
  done: number;
  errors: Record<string, string>;
  untranslated: number;
};

export const fetchSettings = () => request<Settings>("/api/settings", { cache: "no-store" });

export const updateSettings = (update: SettingsUpdate) =>
  request<Settings>("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(update),
  });

export const fetchModels = (provider: ProviderId) => request<ModelOption[]>(`/api/providers/${provider}/models`);

export const fetchTranslationStatus = () => request<TranslationStatus>("/api/translations/status", { cache: "no-store" });

export const translateLibrary = () => request<{ queued: number }>("/api/translations/backfill", { method: "POST" });

/** Translate (or re-translate) one song; clears the cached detail so the result is refetched. */
export async function translateSong(videoId: string) {
  await request<{ ok: boolean }>(`/api/songs/${videoId}/translate`, { method: "POST" });
  songCache.delete(videoId);
}

export function setLyricsOffset(videoId: string, offset: number) {
  return request<{ lyricsOffset: number }>(`/api/songs/${videoId}/offset`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ offset }),
  });
}

export function invalidateSong(videoId: string) {
  songCache.delete(videoId);
}

export type CreateJobResult = { exists: boolean; videoId: string; job?: Job };

export function createJob(url: string) {
  return request<CreateJobResult>("/api/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
}

export function cancelJob(videoId: string) {
  return request<{ ok: boolean }>(`/api/jobs/${videoId}`, { method: "DELETE" });
}

export const JOBS_STREAM_URL = `${API_URL}/api/jobs/stream`;

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** Mirrors the server's extract_video_id so bad links fail before a round trip. */
export function parseYouTubeId(input: string): string | null {
  try {
    const url = new URL(input.trim());
    let id: string | null = null;
    if (url.hostname.endsWith("youtube.com")) id = url.searchParams.get("v");
    else if (url.hostname === "youtu.be") id = url.pathname.slice(1);
    return id && YOUTUBE_ID.test(id) ? id : null;
  } catch {
    return null;
  }
}

export type PlaylistTrack = {
  videoId: string;
  title: string;
  artist: string;
  duration: number | null;
  explicit: boolean;
  available: boolean;
  thumbnail: string | null;
  inLibrary: boolean;
  queued: boolean;
};

export type PlaylistInfo = {
  kind: "album" | "playlist";
  title: string;
  artist: string | null;
  year: string | null;
  cover: string | null;
  tracks: PlaylistTrack[];
};

/** list= id of an album / playlist link that isn't a single-song link. */
export function parsePlaylistId(input: string): string | null {
  if (parseYouTubeId(input)) return null;
  try {
    const url = new URL(input.trim());
    if (!url.hostname.endsWith("youtube.com") && url.hostname !== "youtu.be") return null;
    return url.searchParams.get("list");
  } catch {
    return null;
  }
}

export const fetchPlaylist = (url: string) => request<PlaylistInfo>(`/api/playlists?url=${encodeURIComponent(url)}`);

export const createJobsBatch = (tracks: { videoId: string; title: string; artist: string }[]) =>
  request<{ queued: string[]; skipped: string[] }>("/api/jobs/batch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tracks }),
  });

export type LrclibResult = {
  id: number;
  trackName: string;
  artistName: string;
  albumName: string | null;
  duration: number | null;
  synced: boolean;
  instrumental: boolean;
  preview: string[];
};

export const searchLrclib = (query: string, signal?: AbortSignal) =>
  request<LrclibResult[]>(`/api/lyrics/search?q=${encodeURIComponent(query)}`, { signal });

/** Use an LRCLIB entry or an LRC text for a song; the server re-aligns it as a job. */
export async function setSongLyrics(videoId: string, body: { lrclibId: number } | { lrc: string }) {
  const result = await request<{ job: Job }>(`/api/songs/${videoId}/lyrics`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  songCache.delete(videoId);
  return result;
}

/** Timed lines in an LRC text, mirroring the server's check. */
export function countLrcLines(text: string) {
  return text.split(/\r?\n/).filter((line) => /^\s*\[\d+:\d+(\.\d+)?\]\s*\S/.test(line)).length;
}
