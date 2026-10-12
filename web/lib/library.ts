import { useEffect } from "react";
import { deleteSong, fetchArtistAvatars, fetchSongs, type Song } from "./api";
import { createStore, useStore } from "./store";

type LibraryState =
  | { status: "loading"; songs: Song[] }
  | { status: "ready"; songs: Song[] }
  | { status: "error"; songs: Song[]; error: string };

export const libraryStore = createStore<LibraryState>({ status: "loading", songs: [] });

/** Artist name to avatar path on our server (/media/avatars/…), refreshed alongside the library. */
export const artistAvatarStore = createStore<Record<string, string>>({});

let inflight: Promise<void> | null = null;

export function refreshLibrary(): Promise<void> {
  fetchArtistAvatars()
    .then((avatars) => artistAvatarStore.set(avatars))
    .catch(() => {});
  inflight ??= fetchSongs()
    .then((songs) => libraryStore.set({ status: "ready", songs }))
    .catch((e: Error) =>
      libraryStore.set((prev) => ({ status: "error", songs: prev.songs, error: e.message })),
    )
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function useLibrary() {
  const state = useStore(libraryStore);
  useEffect(() => {
    refreshLibrary();
    // Pick up songs added from the CLI while the tab was in the background.
    const onFocus = () => document.visibilityState === "visible" && refreshLibrary();
    document.addEventListener("visibilitychange", onFocus);
    return () => document.removeEventListener("visibilitychange", onFocus);
  }, []);
  return state;
}

/** Delete a song and its files. Stops it first if it's playing so the server can remove the audio. */
export async function removeSong(song: Song) {
  // Imported lazily: the player module imports this one.
  const { player, playerStore } = await import("./player");
  if (playerStore.get().song?.videoId === song.videoId) player.unload();
  await deleteSong(song.videoId);
  libraryStore.set((s) => ({ ...s, songs: s.songs.filter((x) => x.videoId !== song.videoId) }));
}
