"use client";

import { Pause, Play, SkipBack, SkipForward, Volume, Volume1, Volume2, VolumeX } from "lucide-react";
import { libraryStore } from "@/lib/library";
import { player, queuePosition, usePlayer } from "@/lib/player";
import { useStore } from "@/lib/store";
import { Slider } from "./slider";

export function PlayPauseIcon({ playing, size }: { playing: boolean; size: number }) {
  return (
    <span className="icon-swap" style={{ width: size, height: size }}>
      <Play data-hidden={playing} size={size} fill="currentColor" strokeWidth={1.5} strokeLinejoin="round" className="translate-x-[6%]" />
      <Pause data-hidden={!playing} size={size} fill="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
    </span>
  );
}

export function TransportControls() {
  const state = usePlayer();
  const { playing } = state;
  const { songs, index } = queuePosition(state, useStore(libraryStore).songs);
  const hasNext = index >= 0 && index < songs.length - 1;

  return (
    <div className="flex items-center justify-center gap-6">
      <button
        type="button"
        aria-label="Previous"
        onClick={() => player.previous()}
        className="pressable grid size-14 place-items-center rounded-full text-white/90 hover:bg-white/10"
      >
        <SkipBack size={28} fill="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      </button>
      <button
        type="button"
        aria-label={playing ? "Pause" : "Play"}
        onClick={() => player.toggle()}
        className="pressable grid size-18 place-items-center rounded-full text-white hover:bg-white/10"
      >
        <PlayPauseIcon playing={playing} size={44} />
      </button>
      <button
        type="button"
        aria-label="Next"
        disabled={!hasNext}
        onClick={() => player.next()}
        className="pressable grid size-14 place-items-center rounded-full text-white/90 hover:bg-white/10 disabled:pointer-events-none disabled:opacity-35"
      >
        <SkipForward size={28} fill="currentColor" strokeWidth={1.5} strokeLinejoin="round" />
      </button>
    </div>
  );
}

export function VolumeControl() {
  const { volume, muted } = usePlayer();
  const level = muted ? 0 : volume;
  const Icon = level === 0 ? VolumeX : level < 0.34 ? Volume : level < 0.67 ? Volume1 : Volume2;

  return (
    <div className="flex items-center gap-3 text-white/60">
      <button
        type="button"
        aria-label={muted ? "Unmute" : "Mute"}
        onClick={() => player.toggleMute()}
        className="pressable grid size-8 shrink-0 place-items-center rounded-full hover:text-white"
      >
        <Icon size={18} strokeWidth={2} />
      </button>
      <Slider
        label="Volume"
        value={level}
        keyboardStep={0.05}
        valueText={(f) => `${Math.round(f * 100)}%`}
        onScrub={(f) => player.setVolume(f)}
        onCommit={(f) => player.setVolume(f)}
        className="flex-1"
      />
    </div>
  );
}
