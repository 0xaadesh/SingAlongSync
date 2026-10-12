"use client";

import Link from "next/link";
import { useMemo, type ReactNode } from "react";
import { artworkUrl, assetUrl, imageCors, type Song } from "@/lib/api";
import {
  collectionHref,
  getAlbums,
  getArtists,
  getGenres,
  hueFor,
  matches,
  songMatches,
  type Collection,
} from "@/lib/catalog";
import { artistAvatarStore, libraryStore } from "@/lib/library";
import { useStore } from "@/lib/store";
import { useSearchQuery } from "@/lib/use-search";
import { Marquee } from "@/components/ui/marquee";
import { SongGrid, SongGridSkeleton } from "./song-grid";
import {
  countLabel,
  EmptyLibraryState,
  NoMatchesState,
  OfflineState,
  PageHeading,
  plural,
} from "./states";

const GRID =
  "grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-x-5 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]";

/** Handles the loading / offline / empty-library states shared by every section. */
function LibraryGate({ title, children }: { title: string; children: (songs: Song[]) => ReactNode }) {
  const library = useStore(libraryStore);
  if (library.status === "error" && !library.songs.length) {
    return (
      <>
        <PageHeading title={title} />
        <OfflineState />
      </>
    );
  }
  if (library.status === "loading" && !library.songs.length) {
    return (
      <>
        <PageHeading title={title} />
        <SongGridSkeleton />
      </>
    );
  }
  if (!library.songs.length) {
    return (
      <>
        <PageHeading title={title} />
        <EmptyLibraryState />
      </>
    );
  }
  return <>{children(library.songs)}</>;
}

// ---------------------------------------------------------------------------
// Songs
// ---------------------------------------------------------------------------

export function SongsView() {
  return <LibraryGate title="Songs">{(songs) => <SongsSection songs={songs} />}</LibraryGate>;
}

function SongsSection({ songs }: { songs: Song[] }) {
  const { query, searching } = useSearchQuery();
  const shown = useMemo(() => songs.filter((s) => songMatches(s, query)), [songs, query]);
  return (
    <>
      <PageHeading title="Songs" count={countLabel(shown.length, songs.length, "song", searching)} />
      {shown.length ? <SongGrid songs={shown} /> : <NoMatchesState query={query} noun="songs" />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Albums
// ---------------------------------------------------------------------------

export function AlbumsView() {
  return <LibraryGate title="Albums">{(songs) => <AlbumsSection songs={songs} />}</LibraryGate>;
}

function AlbumsSection({ songs }: { songs: Song[] }) {
  const { query, searching } = useSearchQuery();
  const albums = useMemo(() => getAlbums(songs), [songs]);
  const shown = useMemo(() => albums.filter((a) => matches(query, a.name, a.artist)), [albums, query]);
  return (
    <>
      <PageHeading title="Albums" count={countLabel(shown.length, albums.length, "album", searching)} />
      {shown.length ? (
        <ul className={GRID}>
          {shown.map((album, i) => (
            <CollectionCard
              key={album.name}
              href={collectionHref("albums", album.name)}
              collection={album}
              subtitle={album.artist}
              index={i}
            />
          ))}
        </ul>
      ) : (
        <NoMatchesState query={query} noun="albums" />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Artists
// ---------------------------------------------------------------------------

export function ArtistsView() {
  return <LibraryGate title="Artists">{(songs) => <ArtistsSection songs={songs} />}</LibraryGate>;
}

function ArtistsSection({ songs }: { songs: Song[] }) {
  const { query, searching } = useSearchQuery();
  const artists = useMemo(() => getArtists(songs), [songs]);
  const avatars = useStore(artistAvatarStore);
  const shown = useMemo(() => artists.filter((a) => matches(query, a.name)), [artists, query]);
  return (
    <>
      <PageHeading title="Artists" count={countLabel(shown.length, artists.length, "artist", searching)} />
      {shown.length ? (
        <ul className={GRID}>
          {shown.map((artist, i) => (
            <CollectionCard
              key={artist.name}
              href={collectionHref("artists", artist.name)}
              collection={artist}
              subtitle={plural(artist.songs.length, "song")}
              image={assetUrl(avatars[artist.name]) ?? undefined}
              index={i}
              round
            />
          ))}
        </ul>
      ) : (
        <NoMatchesState query={query} noun="artists" />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Genres
// ---------------------------------------------------------------------------

export function GenresView() {
  return <LibraryGate title="Genres">{(songs) => <GenresSection songs={songs} />}</LibraryGate>;
}

function GenresSection({ songs }: { songs: Song[] }) {
  const { query, searching } = useSearchQuery();
  const genres = useMemo(() => getGenres(songs), [songs]);
  const shown = useMemo(() => genres.filter((g) => matches(query, g.name)), [genres, query]);
  return (
    <>
      <PageHeading title="Genres" count={countLabel(shown.length, genres.length, "genre", searching)} />
      {shown.length ? (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-4 sm:grid-cols-[repeat(auto-fill,minmax(240px,1fr))]">
          {shown.map((genre) => (
            <GenreTile key={genre.name} genre={genre} />
          ))}
        </ul>
      ) : (
        <NoMatchesState query={query} noun="genres" />
      )}
    </>
  );
}

function GenreTile({ genre }: { genre: Collection }) {
  const hue = hueFor(genre.name);
  const art = artworkUrl(genre.cover);
  return (
    <li>
      <Link
        href={collectionHref("genres", genre.name)}
        className="group relative block aspect-[16/9] overflow-hidden rounded-2xl transition-[scale] duration-[160ms] ease-[var(--ease-out)] active:scale-[0.96]"
        style={{ background: `linear-gradient(135deg, oklch(0.52 0.16 ${hue}), oklch(0.32 0.12 ${hue + 40}))` }}
      >
        {/* Tilted cover peeking from the corner, like a record sleeve */}
        <img
          src={art}
          alt=""
          width={120}
          height={120}
          loading="lazy"
          decoding="async"
          crossOrigin={imageCors(art)}
          className="absolute -right-4 -bottom-3 size-[46%] rotate-[18deg] rounded-lg object-cover shadow-[0_8px_24px_rgb(0_0_0/0.45)] transition-[rotate] duration-300 ease-[var(--ease-out)] group-hover:rotate-[12deg]"
        />
        <div className="relative p-4">
          <p className="text-[19px] leading-tight font-bold tracking-tight text-white">{genre.name}</p>
          <p className="mt-1 text-[13px] text-white/75">{plural(genre.songs.length, "song")}</p>
        </div>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Shared card for albums and artists
// ---------------------------------------------------------------------------

function CollectionCard({
  href,
  collection,
  subtitle,
  image,
  index,
  round = false,
}: {
  href: string;
  collection: Collection;
  subtitle: string;
  /** Overrides the cover song's artwork (artist avatars). */
  image?: string;
  index: number;
  round?: boolean;
}) {
  const art = image ?? artworkUrl(collection.cover);
  return (
    <li className="[contain-intrinsic-size:auto_240px] [content-visibility:auto]">
      <Link href={href} className={`group block text-left ${round ? "text-center" : ""}`}>
        <div
          className={`image-outline aspect-square overflow-hidden bg-surface-2 transition-[scale] duration-[160ms] ease-[var(--ease-out)] group-active:scale-[0.96] ${
            round ? "rounded-full" : "rounded-xl"
          }`}
        >
          <img
            src={art}
            alt=""
            width={240}
            height={240}
            loading={index < 12 ? "eager" : "lazy"}
            decoding="async"
            crossOrigin={imageCors(art)}
            className="size-full object-cover"
          />
        </div>
        <p className="mt-2.5 truncate text-[14px] font-medium">{collection.name}</p>
        <Marquee className="text-[13px] text-muted">{subtitle}</Marquee>
      </Link>
    </li>
  );
}
