"use client";

import { Play } from "lucide-react";
import { memo } from "react";
import { artworkUrl, imageCors, prefetchSong, type Song } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { player, usePlayer } from "@/lib/player";
import { ExplicitBadge } from "@/components/ui/explicit-badge";

/** Numbered track rows. Playing one queues `queue` (the whole collection) behind it. */
export function TrackList({ songs, queue, showAlbum = true }: { songs: Song[]; queue: Song[]; showAlbum?: boolean }) {
  const { song: current, playing } = usePlayer();
  return (
    <ol className="-mx-2">
      {songs.map((song, i) => (
        <TrackRow
          key={song.videoId}
          song={song}
          number={i + 1}
          queue={queue}
          showAlbum={showAlbum}
          state={current?.videoId === song.videoId ? (playing ? "playing" : "paused") : "idle"}
        />
      ))}
    </ol>
  );
}

const TrackRow = memo(function TrackRow({
  song,
  number,
  queue,
  showAlbum,
  state,
}: {
  song: Song;
  number: number;
  queue: Song[];
  showAlbum: boolean;
  state: "idle" | "playing" | "paused";
}) {
  const art = artworkUrl(song);
  const isCurrent = state !== "idle";
  return (
    <li>
      <button
        type="button"
        onClick={() => player.play(song, { queue })}
        onPointerEnter={() => prefetchSong(song.videoId)}
        aria-label={`Play ${song.title} by ${song.artist}`}
        className={`group grid w-full items-center gap-3 rounded-[12px] p-2 text-left transition-colors duration-150 hover:bg-white/[0.05] ${
          showAlbum ? "grid-cols-[28px_40px_minmax(0,1fr)_auto] md:grid-cols-[28px_40px_minmax(0,1.4fr)_minmax(0,1fr)_auto]" : "grid-cols-[28px_40px_minmax(0,1fr)_auto]"
        }`}
      >
        <span className="relative grid h-5 place-items-center text-[13px] text-subtle tabular-nums">
          {isCurrent ? (
            <span className="eq flex h-3 items-end gap-[2px]" data-paused={state === "paused"} aria-hidden>
              <span className="h-full w-[2.5px] rounded-full bg-accent" />
              <span className="h-full w-[2.5px] rounded-full bg-accent" />
              <span className="h-full w-[2.5px] rounded-full bg-accent" />
            </span>
          ) : (
            <>
              <span className="transition-opacity duration-150 group-hover:opacity-0">{number}</span>
              <Play
                size={13}
                fill="currentColor"
                strokeWidth={0}
                className="absolute text-fg opacity-0 transition-opacity duration-150 group-hover:opacity-100"
                aria-hidden
              />
            </>
          )}
        </span>
        <img
          src={art}
          alt=""
          width={40}
          height={40}
          loading="lazy"
          decoding="async"
          crossOrigin={imageCors(art)}
          className="image-outline size-10 rounded-[6px] object-cover"
        />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className={`truncate text-[14px] font-medium ${isCurrent ? "text-accent" : ""}`}>{song.title}</span>
            {song.explicit && <ExplicitBadge />}
          </span>
          <span className="block truncate text-[13px] text-muted">{song.artist}</span>
        </span>
        {showAlbum && <span className="hidden truncate text-[13px] text-muted md:block">{song.album}</span>}
        <span className="pr-1 text-[13px] text-subtle tabular-nums">{formatTime(song.duration)}</span>
      </button>
    </li>
  );
});
