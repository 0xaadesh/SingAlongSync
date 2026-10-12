"use client";

import { SkipForward } from "lucide-react";
import { useEffect, useRef } from "react";
import { artworkUrl, imageCors } from "@/lib/api";
import { libraryStore } from "@/lib/library";
import { player, queuePosition, usePlayer } from "@/lib/player";
import { useStore } from "@/lib/store";
import { Marquee } from "@/components/ui/marquee";
import { PlayPauseIcon } from "./controls";

/** Floating now-playing bar over the library. Tap to open the full player. */
export function MiniPlayer() {
  const state = usePlayer();
  const { song, playing, duration, sheetOpen } = state;
  const library = useStore(libraryStore).songs;
  const fillRef = useRef<HTMLDivElement>(null);
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    if (!song || sheetOpen) return;
    return player.subscribeTime((t) => {
      const d = durationRef.current;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${d ? Math.min(t / d, 1) : 0})`;
    });
  }, [song, sheetOpen]);

  if (!song) return null;

  const art = artworkUrl(song);
  const { songs, index } = queuePosition(state, library);
  const hasNext = index >= 0 && index < songs.length - 1;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom),12px)] sm:px-6 sm:pb-6">
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open player: ${song.title} by ${song.artist}`}
        onClick={() => player.openSheet()}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            player.openSheet();
          }
        }}
        className="enter-up pointer-events-auto relative mx-auto flex max-w-xl cursor-pointer items-center gap-3 overflow-hidden rounded-[18px] bg-[#1c1c1f]/85 p-2.5 pr-3 shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_12px_40px_-8px_rgb(0_0_0/0.7)] backdrop-blur-xl backdrop-saturate-150"
      >
        <img
          src={art}
          alt=""
          width={44}
          height={44}
          decoding="async"
          crossOrigin={imageCors(art)}
          className="image-outline size-11 shrink-0 rounded-lg object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{song.title}</p>
          <Marquee className="text-[13px] text-muted">{song.artist}</Marquee>
        </div>
        <button
          type="button"
          aria-label={playing ? "Pause" : "Play"}
          onClick={(e) => {
            e.stopPropagation();
            player.toggle();
          }}
          className="pressable grid size-10 place-items-center rounded-full text-white hover:bg-white/10"
        >
          <PlayPauseIcon playing={playing} size={22} />
        </button>
        <button
          type="button"
          aria-label="Next"
          disabled={!hasNext}
          onClick={(e) => {
            e.stopPropagation();
            player.next();
          }}
          className="pressable grid size-10 place-items-center rounded-full text-white/85 hover:bg-white/10 disabled:opacity-35"
        >
          <SkipForward size={20} fill="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
        </button>
        <div className="absolute inset-x-[18px] bottom-0 h-[2px] overflow-hidden rounded-full bg-white/10">
          <div ref={fillRef} className="h-full origin-left bg-white/70" style={{ transform: "scaleX(0)" }} />
        </div>
      </div>
    </div>
  );
}
