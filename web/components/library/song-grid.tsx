"use client";

import { Play, Trash2 } from "lucide-react";
import { memo } from "react";
import { artworkUrl, imageCors, prefetchSong, type Song } from "@/lib/api";
import { removeSong } from "@/lib/library";
import { player, usePlayer } from "@/lib/player";
import { toast } from "@/lib/toast";
import { confirm } from "@/components/ui/confirm-dialog";
import { ExplicitBadge } from "@/components/ui/explicit-badge";
import { Marquee } from "@/components/ui/marquee";

const GRID = "grid grid-cols-[repeat(auto-fill,minmax(152px,1fr))] gap-x-5 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(176px,1fr))]";

export function SongGrid({ songs }: { songs: Song[] }) {
  const { song: current, playing } = usePlayer();
  return (
    <ul className={GRID}>
      {songs.map((song, i) => (
        <SongCard
          key={song.videoId}
          song={song}
          index={i}
          state={current?.videoId === song.videoId ? (playing ? "playing" : "paused") : "idle"}
        />
      ))}
    </ul>
  );
}

const SongCard = memo(function SongCard({
  song,
  index,
  state,
  compact = false,
}: {
  song: Song;
  index: number;
  state: "idle" | "playing" | "paused";
  /** Inside the recently-played row: no delete button, rendered as a plain div. */
  compact?: boolean;
}) {
  const art = artworkUrl(song);
  const Wrapper = compact ? "div" : "li";
  return (
    // content-visibility skips rendering off-screen cards in large libraries
    <Wrapper className="group/card relative [contain-intrinsic-size:auto_240px] [content-visibility:auto]">
      <button
        type="button"
        onClick={() => player.play(song)}
        onPointerEnter={() => prefetchSong(song.videoId)}
        onFocus={() => prefetchSong(song.videoId)}
        aria-label={`Play ${song.title} by ${song.artist}`}
        className="group block w-full rounded-xl text-left"
      >
        <div className="image-outline relative aspect-square overflow-hidden rounded-xl bg-surface-2 transition-[scale] duration-[160ms] ease-[var(--ease-out)] group-active:scale-[0.96]">
          <img
            src={art}
            alt=""
            width={240}
            height={240}
            loading={index < 12 ? "eager" : "lazy"}
            fetchPriority={index < 6 ? "high" : "auto"}
            decoding="async"
            crossOrigin={imageCors(art)}
            className="size-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-black/0 to-black/0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100" />
          <span className="absolute right-2.5 bottom-2.5 grid size-10 place-items-center rounded-full bg-accent text-white opacity-0 shadow-[0_4px_12px_rgb(0_0_0/0.35)] transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100">
            <Play size={18} fill="currentColor" strokeWidth={0} className="translate-x-px" />
          </span>
          {!song.hasLyrics && (
            <span className="absolute top-2 left-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] font-medium text-white/85 backdrop-blur-md">
              No lyrics
            </span>
          )}
          {state !== "idle" && (
            <span className="absolute bottom-2.5 left-2.5 flex h-7 items-center gap-[3px] rounded-full bg-black/55 px-2.5 backdrop-blur-md">
              <span className="eq flex h-3 items-end gap-[3px]" data-paused={state === "paused"}>
                <span className="h-full w-[3px] rounded-full bg-accent" />
                <span className="h-full w-[3px] rounded-full bg-accent" />
                <span className="h-full w-[3px] rounded-full bg-accent" />
              </span>
              <span className="sr-only">{state === "playing" ? "Now playing" : "Paused"}</span>
            </span>
          )}
        </div>
        <p className="mt-2.5 flex items-center gap-1.5">
          <span className="truncate text-[14px] font-medium">{song.title}</span>
          {song.explicit && <ExplicitBadge />}
        </p>
        <Marquee className="text-[13px] text-muted">{song.artist}</Marquee>
      </button>
      {!compact && <DeleteButton song={song} />}
    </Wrapper>
  );
});

function DeleteButton({ song }: { song: Song }) {
  const askDelete = () =>
    confirm({
      title: `Delete “${song.title}”?`,
      body: "This removes the song from your library and deletes its downloaded audio, stems and lyrics. This can't be undone.",
      confirmLabel: "Delete",
      onConfirm: async () => {
        await removeSong(song);
        toast({ title: "Song deleted", description: song.title });
      },
    });

  return (
    <button
      type="button"
      aria-label={`Delete ${song.title}`}
      title="Delete from Library"
      onClick={askDelete}
      className="pressable absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-md group-hover/card:opacity-100 hover:bg-danger focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <Trash2 size={15} strokeWidth={2} />
    </button>
  );
}

export function SongGridSkeleton() {
  return (
    <ul className={GRID} aria-hidden>
      {Array.from({ length: 10 }, (_, i) => (
        <li key={i}>
          <div className="skeleton aspect-square rounded-xl" style={{ animationDelay: `${i * 60}ms` }} />
          <div className="skeleton mt-3 h-3.5 w-3/4 rounded" />
          <div className="skeleton mt-2 h-3 w-1/2 rounded" />
        </li>
      ))}
    </ul>
  );
}

/** Horizontal row of the songs played most recently in this browser. */
export function RecentlyPlayed({ songs }: { songs: Song[] }) {
  const { song: current, playing } = usePlayer();
  if (!songs.length) return null;
  return (
    <section aria-labelledby="recent-heading" className="mb-8">
      <h2 id="recent-heading" className="mb-3 text-[15px] font-semibold text-muted">
        Recently played
      </h2>
      <ul className="-mx-5 flex snap-x gap-4 overflow-x-auto scroll-px-5 px-5 pb-2 sm:-mx-8 sm:scroll-px-8 sm:px-8 lg:-mx-12 lg:scroll-px-12 lg:px-12 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {songs.map((song, i) => (
          <li key={song.videoId} className="w-[132px] shrink-0 snap-start sm:w-[148px]">
            <SongCard
              song={song}
              index={i}
              state={current?.videoId === song.videoId ? (playing ? "playing" : "paused") : "idle"}
              compact
            />
          </li>
        ))}
      </ul>
    </section>
  );
}
