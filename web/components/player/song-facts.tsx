"use client";

import { useEffect, useRef, useState } from "react";
import type { ChordSegment, SongDetail } from "@/lib/api";
import { player } from "@/lib/player";

const POLL_MS = 3000;

/** Index of the chord playing at `t`, or -1 between chords. */
function chordAt(chords: ChordSegment[], t: number) {
  let lo = 0;
  let hi = chords.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (chords[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && t < chords[found].end + 0.25 ? found : -1;
}

/**
 * Key chip (with a spinner while the background analysis runs) and a live
 * "current chord → next chord" readout.
 */
export function SongFacts({ detail }: { detail: SongDetail }) {
  const pending = detail.analysisStatus === "pending";

  // Refetch until the analysis lands
  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => player.refreshDetail().catch(() => {}), POLL_MS);
    return () => clearInterval(id);
  }, [pending, detail.videoId]);

  if (detail.analysisStatus === "none" || detail.analysisStatus === "failed") return null;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <span
        className="flex h-7 items-center gap-1.5 rounded-full bg-white/10 px-3 text-[12px] font-semibold text-white/90"
        title={
          detail.analysis
            ? `Detected key (${Math.round(detail.analysis.keyConfidence * 100)}% confidence${
                detail.analysis.keyMethod === "audio+chords" ? ", mode from chords" : ""
              })`
            : "Detecting key and chords…"
        }
      >
        {pending ? (
          <>
            <span aria-hidden className="spin size-3 rounded-full border-[1.5px] border-white/25 border-t-white" />
            <span className="text-white/60">Detecting key…</span>
          </>
        ) : (
          <>
            <span className="text-white/50">Key</span> {detail.analysis?.key}
            {detail.analysis?.bpm && <span className="text-white/50">· {Math.round(detail.analysis.bpm)} BPM</span>}
          </>
        )}
      </span>
      {detail.analysis && detail.analysis.chords.length > 0 && <ChordTicker chords={detail.analysis.chords} />}
    </div>
  );
}

/** Current and next chord, updated from the playback clock only when they change. */
function ChordTicker({ chords }: { chords: ChordSegment[] }) {
  const [index, setIndex] = useState(-1);
  const last = useRef(-2);

  useEffect(
    () =>
      player.subscribeTime((t) => {
        const i = chordAt(chords, t);
        if (i !== last.current) {
          last.current = i;
          setIndex(i);
        }
      }),
    [chords],
  );

  const current = index >= 0 ? chords[index].chord : null;
  // Next chord: the one after the current, or the first one still to come
  const next = index >= 0 ? chords[index + 1]?.chord : chords.find((c) => c.start > player.getTime())?.chord;

  return (
    <span
      className="flex h-7 items-center gap-2 rounded-full bg-white/10 pr-3 pl-1 text-[12px] font-semibold"
      aria-live="off"
      title="Chord now playing, and the next one"
    >
      <span
        key={`${index}-${current}`}
        className="grid h-5 min-w-9 place-items-center rounded-full bg-white px-2 text-[12px] font-bold text-black"
      >
        {current ?? "–"}
      </span>
      {next && (
        <span className="text-white/55">
          next <span className="text-white/85">{next}</span>
        </span>
      )}
    </span>
  );
}
