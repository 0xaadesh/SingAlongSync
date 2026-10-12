import { createStore } from "./store";

const KEY = "sas:recently-played";
const LIMIT = 20;

/** Video ids, most recent first (remembered per browser). */
export const historyStore = createStore<string[]>([]);

export function initHistory() {
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    if (Array.isArray(stored)) historyStore.set(stored.filter((x) => typeof x === "string"));
  } catch {
    // Storage unavailable or corrupt; start empty
  }
}

export function recordPlay(videoId: string) {
  const next = [videoId, ...historyStore.get().filter((id) => id !== videoId)].slice(0, LIMIT);
  historyStore.set(next);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not persisted; still shown this session
  }
}
