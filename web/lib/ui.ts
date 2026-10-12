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

/** Whether the player shows Latin-letter pronunciation under non-Latin-script lines. */
export const showRomanizationsStore = createStore(true);

export function initShowRomanizations() {
  try {
    showRomanizationsStore.set(localStorage.getItem(ROMANIZATIONS_KEY) !== "false");
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
