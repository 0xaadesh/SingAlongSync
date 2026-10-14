import { createStore } from "./store";

/** Library search query (filters the grid as you type). */
export const searchStore = createStore("");

type AddDialogState =
  | { open: false }
  /** url: prefill and submit straight away. jobId: open on an existing job's progress. */
  | { open: true; url?: string; jobId?: string };

export const addDialogStore = createStore<AddDialogState>({ open: false });

export function openAddDialog(options: { url?: string; jobId?: string } = {}) {
  addDialogStore.set({ open: true, ...options });
}

export function closeAddDialog() {
  addDialogStore.set({ open: false });
}

/** The job the add dialog is showing right now, so we don't also toast about it. */
export const trackedJobStore = createStore<string | null>(null);

const TRANSLATIONS_KEY = "sas:show-translations";

/** Whether the player shows English under translated lines (remembered per browser). */
export const showTranslationsStore = createStore(true);

export function initShowTranslations() {
  try {
    showTranslationsStore.set(localStorage.getItem(TRANSLATIONS_KEY) !== "false");
  } catch {
    // Storage unavailable (private mode); keep the default
  }
}

export function setShowTranslations(show: boolean) {
  showTranslationsStore.set(show);
  try {
    localStorage.setItem(TRANSLATIONS_KEY, String(show));
  } catch {
    // Not persisted; still applies for this session
  }
}

const ROMANIZATIONS_KEY = "sas:show-romanizations";
const ROMANIZED_FIRST_KEY = "sas:romanized-first";

/** Whether the pronunciation is shown as the main line, above the original script. */
export const romanizedFirstStore = createStore(false);

export function setRomanizedFirst(first: boolean) {
  romanizedFirstStore.set(first);
  try {
    localStorage.setItem(ROMANIZED_FIRST_KEY, String(first));
  } catch {
    // Not persisted; still applies for this session
  }
}

/** Whether the player shows Latin-letter pronunciation under non-Latin-script lines. */
export const showRomanizationsStore = createStore(true);

export function initShowRomanizations() {
  try {
    showRomanizationsStore.set(localStorage.getItem(ROMANIZATIONS_KEY) !== "false");
    romanizedFirstStore.set(localStorage.getItem(ROMANIZED_FIRST_KEY) === "true");
  } catch {
    // Storage unavailable; keep the default
  }
}

export function setShowRomanizations(show: boolean) {
  showRomanizationsStore.set(show);
  try {
    localStorage.setItem(ROMANIZATIONS_KEY, String(show));
  } catch {
    // Not persisted; still applies for this session
  }
}

export type LyricsTarget = { videoId: string; title: string; artist: string; artists: string[]; duration: number };

/** The song whose lyrics are being picked in the lyrics dialog (null = closed). */
export const lyricsDialogStore = createStore<LyricsTarget | null>(null);

export const openLyricsDialog = (song: LyricsTarget) => lyricsDialogStore.set(song);
export const closeLyricsDialog = () => lyricsDialogStore.set(null);

const CHORDS_KEY = "sas:show-chords";

/** Whether chord names are shown above the lyrics. */
export const showChordsStore = createStore(true);

export function initShowChords() {
  try {
    showChordsStore.set(localStorage.getItem(CHORDS_KEY) !== "false");
  } catch {
    // Storage unavailable; keep the default
  }
}

export function setShowChords(show: boolean) {
  showChordsStore.set(show);
  try {
    localStorage.setItem(CHORDS_KEY, String(show));
  } catch {
    // Not persisted; still applies for this session
  }
}

const SONG_FACTS_KEY = "sas:show-song-facts";

/** Whether the key chip and live chord readout are shown under the cover. */
export const showSongFactsStore = createStore(true);

export function initShowSongFacts() {
  try {
    showSongFactsStore.set(localStorage.getItem(SONG_FACTS_KEY) !== "false");
  } catch {
    // Storage unavailable; keep the default
  }
}

export function setShowSongFacts(show: boolean) {
  showSongFactsStore.set(show);
  try {
    localStorage.setItem(SONG_FACTS_KEY, String(show));
  } catch {
    // Not persisted; still applies for this session
  }
}

const VIEW_KEY = "sas:player-view";

export type PlayerView = "lyrics" | "beats";

/** What the player's main area shows: synced lyrics, or the beat grid with chord diagrams. */
export const playerViewStore = createStore<PlayerView>("lyrics");

export function initPlayerView() {
  try {
    if (localStorage.getItem(VIEW_KEY) === "beats") playerViewStore.set("beats");
  } catch {
    // Storage unavailable; keep the default
  }
}

export function setPlayerView(view: PlayerView) {
  playerViewStore.set(view);
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not persisted; still applies for this session
  }
}
