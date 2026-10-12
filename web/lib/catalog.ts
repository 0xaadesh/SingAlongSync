/** Albums, artists and genres derived from the flat song list, plus search helpers. */
import type { Song } from "./api";

export type Collection = {
  /** Display name; also the URL segment (encoded). */
  name: string;
  songs: Song[];
  /** Song whose artwork represents the collection. */
  cover: Song;
};

export type Album = Collection & { artist: string };

export const UNKNOWN_GENRE = "Other";

const normalize = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** True when every word of the query appears somewhere in the given fields. */
export function matches(query: string, ...fields: (string | null | undefined)[]) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalize(fields.filter(Boolean).join(" "));
  return terms.every((t) => haystack.includes(t));
}

export const songMatches = (song: Song, query: string) =>
  matches(query, song.title, song.artist, song.album, song.genre);

function groupBy(songs: Song[], keys: (song: Song) => string[]) {
  const groups = new Map<string, Song[]>();
  for (const song of songs) {
    for (const key of keys(song)) {
      const list = groups.get(key);
      if (list) list.push(song);
      else groups.set(key, [song]);
    }
  }
  return groups;
}

const byName = (a: Collection, b: Collection) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });

function mostCommon(values: string[]) {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

export function getAlbums(songs: Song[]): Album[] {
  return [...groupBy(songs, (s) => (s.album ? [s.album] : []))]
    .map(([name, list]) => ({
      name,
      songs: list,
      cover: list[0],
      artist: mostCommon(list.map((s) => s.artists[0] ?? s.artist)),
    }))
    .sort(byName);
}

export function getArtists(songs: Song[]): Collection[] {
  return [...groupBy(songs, (s) => s.artists)].map(([name, list]) => ({ name, songs: list, cover: list[0] })).sort(byName);
}

export function getGenres(songs: Song[]): Collection[] {
  return [...groupBy(songs, (s) => [s.genre ?? UNKNOWN_GENRE])]
    .map(([name, list]) => ({ name, songs: list, cover: list[0] }))
    // "Other" goes last
    .sort((a, b) => (a.name === UNKNOWN_GENRE ? 1 : b.name === UNKNOWN_GENRE ? -1 : byName(a, b)));
}

export const collectionHref = (section: "albums" | "artists" | "genres", name: string) =>
  `/${section}/${encodeURIComponent(name)}`;

export function totalDuration(songs: Song[]) {
  const seconds = songs.reduce((sum, s) => sum + (s.duration || 0), 0);
  const minutes = Math.round(seconds / 60);
  return minutes >= 60 ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min` : `${minutes} min`;
}

/** Stable hue (0-360) for a name, used to colour genre tiles. */
export function hueFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
