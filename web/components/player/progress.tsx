"use client";

import { useCallback, useRef } from "react";
import { formatTime } from "@/lib/format";
import { player, usePlayer } from "@/lib/player";
import { Slider } from "./slider";

/** Scrubber with elapsed / remaining labels. Updates via the clock, not React state. */
export function Progress() {
  const { duration, song } = usePlayer();
  const elapsedRef = useRef<HTMLSpanElement>(null);
  const remainingRef = useRef<HTMLSpanElement>(null);
  const durationRef = useRef(duration);
  durationRef.current = duration;
  const lastSecondRef = useRef(-1);
  const scrubbingRef = useRef(false);

  const writeLabels = (time: number) => {
    const second = Math.floor(time);
    if (second === lastSecondRef.current) return;
    lastSecondRef.current = second;
    if (elapsedRef.current) elapsedRef.current.textContent = formatTime(time);
    if (remainingRef.current)
      remainingRef.current.textContent = `-${formatTime(Math.max(0, durationRef.current - time))}`;
  };

  const bind = useCallback(
    (set: (f: number) => void) =>
      player.subscribeTime((t) => {
        const d = durationRef.current;
        set(d ? t / d : 0);
        if (!scrubbingRef.current) writeLabels(t);
      }),
    // Re-bind per song so a new duration repaints immediately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [song?.videoId, duration],
  );

  return (
    <div className="w-full">
      <Slider
        label="Seek"
        bind={bind}
        keyboardStep={5 / Math.max(duration, 1)}
        valueText={(f) => `${formatTime(f * durationRef.current)} of ${formatTime(durationRef.current)}`}
        onScrub={(f) => {
          scrubbingRef.current = true;
          lastSecondRef.current = -1;
          writeLabels(f * durationRef.current);
        }}
        onCommit={(f) => {
          scrubbingRef.current = false;
          lastSecondRef.current = -1;
          player.seek(f * durationRef.current);
        }}
      />
      <div className="mt-1 flex justify-between text-[11px] font-medium text-white/50 tabular-nums">
        <span ref={elapsedRef}>0:00</span>
        <span ref={remainingRef}>-{formatTime(duration)}</span>
      </div>
    </div>
  );
}
