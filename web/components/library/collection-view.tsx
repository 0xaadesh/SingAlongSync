"use client";

import { ChevronLeft, Play, Shuffle } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { artworkUrl, assetUrl, imageCors, type Song } from "@/lib/api";
import {
  collectionHref,
  getAlbums,
  getArtists,
  getGenres,
  hueFor,
  songMatches,
  totalDuration,
  type Album,
  type Collection,
} from "@/lib/catalog";
import { artistAvatarStore, libraryStore } from "@/lib/library";
import { player } from "@/lib/player";
import { useStore } from "@/lib/store";
import { useSearchQuery } from "@/lib/use-search";
import { SongGridSkeleton } from "./song-grid";
import { EmptyState, NoMatchesState, OfflineState, plural } from "./states";
import { TrackList } from "./track-list";

type Section = "albums" | "artists" | "genres";

const META: Record<Section, { label: string; back: string; noun: string }> = {
  albums: { label: "Album", back: "Albums", noun: "album" },
  artists: { label: "Artist", back: "Artists", noun: "artist" },
  genres: { label: "Genre", back: "Genres", noun: "genre" },
};

const FIND: Record<Section, (songs: Song[]) => Collection[]> = {
  albums: getAlbums,
  artists: getArtists,
  genres: getGenres,
};

/** Detail page for one album, artist or genre: header plus its tracks. */
export function CollectionView({ section, name }: { section: Section; name: string }) {
  const library = useStore(libraryStore);
  const collection = useMemo(
    () => FIND[section](library.songs).find((c) => c.name === name),
    [section, library.songs, name],
  );
  const meta = META[section];

  return (
    <div className="pt-6">
      <Link
        href={`/${section}`}
        className="inline-flex items-center gap-1 rounded-md text-[13px] font-medium text-muted transition-colors duration-150 hover:text-fg"
      >
        <ChevronLeft size={16} strokeWidth={2} />
        {meta.back}
      </Link>

      {collection ? (
        <CollectionBody section={section} collection={collection} />
      ) : library.status === "error" && !library.songs.length ? (
        <div className="mt-6">
          <OfflineState />
        </div>
      ) : library.status === "loading" ? (
        <div className="mt-6">
          <SongGridSkeleton />
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState
            icon={<ChevronLeft size={22} strokeWidth={2} />}
            title={`${meta.label} not found`}
            body={`There's no ${meta.noun} called “${name}” in your library.`}
          />
        </div>
      )}
    </div>
  );
}

function CollectionBody({ section, collection }: { section: Section; collection: Collection }) {
  const { query } = useSearchQuery();
  const shown = useMemo(() => collection.songs.filter((s) => songMatches(s, query)), [collection.songs, query]);
  const album = section === "albums" ? (collection as Album) : null;

  const playAll = (shuffle: boolean) => {
    const queue = shuffle ? shuffled(collection.songs) : collection.songs;
    player.play(queue[0], { queue });
  };

  return (
    <>
      <header className="mt-5 mb-8 flex flex-col gap-6 sm:flex-row sm:items-end">
        <Cover section={section} collection={collection} />
        <div className="min-w-0">
          <p className="text-[12px] font-semibold tracking-wide text-muted uppercase">{META[section].label}</p>
          <h1 className="mt-1 text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] font-bold tracking-[-0.03em] text-balance">
            {collection.name}
          </h1>
          {album && (
            <p className="mt-2 text-[15px] text-muted">
              <Link href={collectionHref("artists", album.artist)} className="font-medium text-fg hover:underline">
                {album.artist}
              </Link>
              {album.cover.genre && (
                <>
                  {" · "}
                  <Link href={collectionHref("genres", album.cover.genre)} className="hover:underline">
                    {album.cover.genre}
                  </Link>
                </>
              )}
            </p>
          )}
          <p className="mt-1.5 text-[13px] text-subtle tabular-nums">
            {plural(collection.songs.length, "song")} · {totalDuration(collection.songs)}
          </p>
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => playAll(false)}
              className="pressable flex h-10 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-semibold text-white hover:bg-accent-hover"
            >
              <Play size={15} fill="currentColor" strokeWidth={0} />
              Play
            </button>
            <button
              type="button"
              onClick={() => playAll(true)}
              className="pressable flex h-10 items-center gap-2 rounded-full bg-white/10 px-5 text-[14px] font-semibold hover:bg-white/15"
            >
              <Shuffle size={15} strokeWidth={2.25} />
              Shuffle
            </button>
          </div>
        </div>
      </header>

      {shown.length ? (
        <TrackList songs={shown} queue={collection.songs} showAlbum={section !== "albums"} />
      ) : (
        <NoMatchesState query={query} noun={`songs in this ${META[section].noun}`} />
      )}
    </>
  );
}

/** Fisher-Yates: every order equally likely. */
function shuffled<T>(items: T[]) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function Cover({ section, collection }: { section: Section; collection: Collection }) {
  const avatars = useStore(artistAvatarStore);
  const art = (section === "artists" && assetUrl(avatars[collection.name])) || artworkUrl(collection.cover);
  if (section === "genres") {
    const hue = hueFor(collection.name);
    return (
      <div
        className="relative size-44 shrink-0 overflow-hidden rounded-2xl shadow-[0_20px_50px_-12px_rgb(0_0_0/0.6)] sm:size-52"
        style={{ background: `linear-gradient(135deg, oklch(0.52 0.16 ${hue}), oklch(0.32 0.12 ${hue + 40}))` }}
      >
        <img
          src={art}
          alt=""
          width={120}
          height={120}
          crossOrigin={imageCors(art)}
          className="absolute -right-5 -bottom-4 size-[58%] rotate-[18deg] rounded-lg object-cover shadow-[0_8px_24px_rgb(0_0_0/0.45)]"
        />
      </div>
    );
  }
  return (
    <img
      src={art}
      alt=""
      width={208}
      height={208}
      decoding="async"
      crossOrigin={imageCors(art)}
      className={`image-outline size-44 shrink-0 object-cover shadow-[0_20px_50px_-12px_rgb(0_0_0/0.6)] sm:size-52 ${
        section === "artists" ? "rounded-full" : "rounded-xl"
      }`}
    />
  );
}
