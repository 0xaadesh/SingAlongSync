"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { ChordSegment, KaraokeLine, SongAnalysis } from "@/lib/api";
import { pianoVoicing } from "@/lib/chords";
import { player } from "@/lib/player";
import { useStore } from "@/lib/store";
import { romanizedFirstStore, setRomanizedFirst } from "@/lib/ui";

type Cell = { start: number; end: number; chord: string | null; label: string | null; barStart: boolean };

const FOLLOW_ANCHOR = 0.25; // current beat sits a quarter of the way across
const BROWSE_IDLE_MS = 2500;

/** Chord sounding at time t (binary search), or null. */
function chordAt(chords: ChordSegment[], t: number): string | null {
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
  return found >= 0 && t < chords[found].end ? chords[found].chord : null;
}

function indexAt(starts: number[], t: number) {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

/** One cell per beat; the chord is the one sounding mid-beat, labelled only where it changes. */
function buildCells(analysis: SongAnalysis): Cell[] {
  const { beats, downbeats, chords } = analysis;
  const bars = new Set(downbeats.map((d) => d.toFixed(2)));
  const cells: Cell[] = [];
  let previous: string | null = null;
  beats.forEach((start, i) => {
    const end = beats[i + 1] ?? start + (beats[i] - (beats[i - 1] ?? start - 0.5));
    const chord = chordAt(chords, (start + end) / 2);
    cells.push({ start, end, chord, label: chord !== previous ? chord : null, barStart: bars.has(start.toFixed(2)) });
    previous = chord;
  });
  return cells;
}

/**
 * Chordify-style view: a scrolling strip of beats grouped into bars with the chords,
 * the lyric line being sung, and piano diagrams for the current and upcoming chords.
 */
export function BeatView({
  analysis,
  lines,
  romanizations,
  active,
}: {
  analysis: SongAnalysis;
  lines: KaraokeLine[];
  romanizations?: Record<string, string> | null;
  active: boolean;
}) {
  // Same preference as "Romanised first" in the lyrics view
  const romanizedFirst = useStore(romanizedFirstStore);
  const hasRomanized = !!romanizations && Object.keys(romanizations).length > 0;
  const cells = useMemo(() => buildCells(analysis), [analysis]);
  const starts = useMemo(() => cells.map((c) => c.start), [cells]);
  const [beat, setBeat] = useState(-1);

  // Current beat drives the diagrams and lyric line (a couple of updates a second)
  useEffect(() => {
    if (!active) return;
    let last = -2;
    return player.subscribeTime((t) => {
      const i = indexAt(starts, t);
      if (i !== last) {
        last = i;
        setBeat(i);
      }
    });
  }, [starts, active]);

  const time = beat >= 0 ? cells[beat].start : 0;
  const lineIndex = indexAt(
    lines.map((l) => l.start),
    time + 0.05,
  );
  const inLine = lineIndex >= 0 && time < lines[lineIndex].end + 1.5;
  // Romanised when chosen and this line has one; English lines have none and stay as written
  const line = !inLine
    ? null
    : (hasRomanized && romanizedFirst && romanizations?.[lineIndex]) || lines[lineIndex].line;

  // Current chord and the next three different ones
  const upcoming = useMemo(() => {
    const out: { chord: string; current: boolean }[] = [];
    const from = Math.max(beat, 0);
    const current = cells[from]?.chord;
    if (current) out.push({ chord: current, current: true });
    for (let i = from + 1; i < cells.length && out.length < 4; i++) {
      const c = cells[i].chord;
      if (c && c !== out[out.length - 1]?.chord) out.push({ chord: c, current: false });
    }
    return out;
  }, [beat, cells]);

  const bar = beat >= 0 ? cells.slice(0, beat + 1).filter((c) => c.barStart).length : 0;
  const beatInBar = (() => {
    if (beat < 0) return 0;
    let n = 0;
    for (let i = beat; i >= 0; i--) {
      n++;
      if (cells[i].barStart) break;
    }
    return n;
  })();

  return (
    // Centred while it fits; when it doesn't, it starts at the top and scrolls instead of
    // spilling over the title above and the controls below
    <div className="flex h-full flex-col gap-4 overflow-y-auto py-3 [justify-content:safe_center] sm:gap-6 sm:py-6">
      <div className="shrink-0">
        <div className="mb-2 flex items-baseline justify-between px-1 text-[12px] font-medium text-white/50 tabular-nums">
          <span>
            {analysis.bpm ? `${Math.round(analysis.bpm)} BPM` : ""} · Key {analysis.key}
          </span>
          {beat >= 0 && (
            <span>
              Bar {bar} · beat {beatInBar}
            </span>
          )}
        </div>
        <BeatStrip cells={cells} active={active} />
      </div>

      {/* Phones: the script switch sits under the line instead of squeezing it */}
      <div className="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
        <p className="min-h-[1.4em] min-w-0 flex-1 px-1 text-[clamp(1.25rem,2.2vw,1.75rem)] leading-snug font-bold text-white/90 text-balance">
          {line ?? <span className="text-white/30">♪</span>}
        </p>
        {hasRomanized && (
          <div role="radiogroup" aria-label="Lyrics script" className="flex shrink-0 gap-0.5 self-start rounded-full bg-white/[0.08] p-1">
            {[
              { id: false, label: "Original" },
              { id: true, label: "Romanised" },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                role="radio"
                aria-checked={romanizedFirst === option.id}
                onClick={() => setRomanizedFirst(option.id)}
                className={`pressable h-7 rounded-full px-3 text-[12px] font-semibold ${
                  romanizedFirst === option.id ? "bg-white text-black" : "text-white/60 hover:text-white"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Below desktop width: the current and next chord side by side; desktop: all four */}
      <div className="grid shrink-0 grid-cols-2 gap-3 sm:gap-4 lg:flex lg:flex-wrap">
        {upcoming.map((u, i) => (
          <ChordCard key={`${u.chord}-${i}`} chord={u.chord} current={u.current} className={i >= 2 ? "max-lg:hidden" : ""} />
        ))}
      </div>
    </div>
  );
}

/**
 * The beat strip. React renders the cells once; the highlight and scroll follow the
 * playback clock imperatively.
 */
const BeatStrip = memo(function BeatStrip({ cells, active }: { cells: Cell[]; active: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const viewport = viewportRef.current!;
    const strip = stripRef.current!;
    const els = Array.from(strip.querySelectorAll<HTMLElement>("[data-beat]"));
    const starts = cells.map((c) => c.start);
    let current = -2;
    let offset = 0;
    let browsing = false;
    let browseTimer = 0;

    const place = (instant: boolean) => {
      const el = els[Math.max(current, 0)];
      if (!el) return;
      const target = viewport.clientWidth * FOLLOW_ANCHOR - el.offsetLeft;
      offset = Math.min(0, target);
      strip.style.transition = instant ? "none" : "";
      strip.style.transform = `translate3d(${offset}px, 0, 0)`;
    };

    const onTime = (t: number) => {
      const i = indexAt(starts, t);
      if (i === current) return;
      const first = current === -2;
      if (current >= 0) els[current]?.removeAttribute("data-current");
      // Everything before the current beat is dimmed as played
      for (let k = Math.max(0, Math.min(current, i)); k < Math.max(current, i); k++) {
        if (els[k]) els[k].dataset.played = String(k < i);
      }
      if (first) els.forEach((el, k) => (el.dataset.played = String(k < i)));
      current = i;
      if (i >= 0) els[i]?.setAttribute("data-current", "");
      if (!browsing) place(first);
    };

    // Wheel / trackpad scrolls the strip; following resumes after a pause
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      browsing = true;
      const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      const min = viewport.clientWidth - strip.scrollWidth;
      offset = Math.max(Math.min(0, min), Math.min(0, offset - delta));
      strip.style.transition = "none";
      strip.style.transform = `translate3d(${offset}px, 0, 0)`;
      clearTimeout(browseTimer);
      browseTimer = window.setTimeout(() => {
        browsing = false;
        place(false);
      }, BROWSE_IDLE_MS);
    };

    // Touch (and mouse) drag scrolls the strip too; a drag never counts as a beat tap
    let drag: { id: number; x: number; offset: number; moved: boolean } | null = null;
    let suppressClick = false;
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      drag = { id: e.pointerId, x: e.clientX, offset, moved: false };
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 6) return;
      if (!drag.moved) {
        drag.moved = true;
        viewport.setPointerCapture(e.pointerId);
      }
      browsing = true;
      clearTimeout(browseTimer);
      const min = viewport.clientWidth - strip.scrollWidth;
      offset = Math.max(Math.min(0, min), Math.min(0, drag.offset + dx));
      strip.style.transition = "none";
      strip.style.transform = `translate3d(${offset}px, 0, 0)`;
    };
    const onPointerUp = (e: PointerEvent) => {
      if (!drag || drag.id !== e.pointerId) return;
      if (drag.moved) {
        suppressClick = true;
        browseTimer = window.setTimeout(() => {
          browsing = false;
          place(false);
        }, BROWSE_IDLE_MS);
      }
      drag = null;
    };

    const onClick = (e: MouseEvent) => {
      if (suppressClick) {
        suppressClick = false;
        return;
      }
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-beat]");
      if (!el) return;
      browsing = false;
      clearTimeout(browseTimer);
      player.seek(cells[Number(el.dataset.beat)].start);
      player.resume();
    };

    const ro = new ResizeObserver(() => place(true));
    ro.observe(viewport);
    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerUp);
    strip.addEventListener("click", onClick);
    const unsubscribe = player.subscribeTime(onTime);
    return () => {
      unsubscribe();
      ro.disconnect();
      clearTimeout(browseTimer);
      viewport.removeEventListener("wheel", onWheel);
      viewport.removeEventListener("pointerdown", onPointerDown);
      viewport.removeEventListener("pointermove", onPointerMove);
      viewport.removeEventListener("pointerup", onPointerUp);
      viewport.removeEventListener("pointercancel", onPointerUp);
      strip.removeEventListener("click", onClick);
    };
  }, [cells, active]);

  return (
    <div ref={viewportRef} className="beat-viewport relative overflow-hidden rounded-[18px] bg-black/20 p-2">
      <div ref={stripRef} className="beat-strip flex w-max gap-1">
        {cells.map((cell, i) => (
          <div key={i} className="flex items-stretch">
            {cell.barStart && i > 0 && <span aria-hidden className="mr-1 w-[3px] shrink-0 rounded-full bg-white/35" />}
            <button type="button" data-beat={i} className="beat-cell" aria-label={`Beat ${i + 1}${cell.chord ? `, ${cell.chord}` : ""}`}>
              {cell.label}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
});

// ---------------------------------------------------------------------------
// Piano chord diagram
// ---------------------------------------------------------------------------

const WHITE_KEYS = [0, 2, 4, 5, 7, 9, 11];
const BLACK_KEYS = [1, 3, 6, 8, 10];
const KEY_W = 16;
const KEY_H = 66;
const BLACK_W = 10;
const BLACK_H = 40;

/** x of a black key's left edge, for the given semitone within an octave */
function blackX(semitone: number) {
  const whiteBefore = WHITE_KEYS.filter((w) => w < semitone).length;
  return whiteBefore * KEY_W - BLACK_W / 2;
}

function ChordCard({ chord, current, className = "" }: { chord: string; current: boolean; className?: string }) {
  const voicing = pianoVoicing(chord);
  const pressed = new Set(voicing?.keys ?? []);
  const width = KEY_W * 14;

  return (
    <div
      data-current={current}
      className={`chord-card min-w-0 rounded-[16px] bg-white/[0.07] p-2.5 transition-[opacity,background-color] duration-200 data-[current=true]:bg-white/[0.14] sm:p-3 ${className}`}
    >
      <p className="mb-2 text-[15px] font-bold sm:text-[16px]">{chord}</p>
      {/* Scales down to fit its card on phones */}
      <svg
        viewBox={`0 0 ${width} ${KEY_H}`}
        width={width}
        height={KEY_H}
        role="img"
        aria-label={`Piano: ${chord}`}
        className="h-auto w-full max-w-[280px] lg:w-auto"
      >
        {[0, 1].map((octave) =>
          WHITE_KEYS.map((semitone, i) => {
            const note = octave * 12 + semitone;
            const x = (octave * 7 + i) * KEY_W;
            return (
              <g key={`w${note}`}>
                <rect x={x + 0.5} y={0.5} width={KEY_W - 1} height={KEY_H - 1} rx={2.5} fill="#f4f4f5" />
                {pressed.has(note) && (
                  <circle cx={x + KEY_W / 2} cy={KEY_H - 11} r={4} fill={note === voicing!.root ? "var(--color-accent)" : "#18181b"} />
                )}
              </g>
            );
          }),
        )}
        {[0, 1].map((octave) =>
          BLACK_KEYS.map((semitone) => {
            const note = octave * 12 + semitone;
            const x = octave * 7 * KEY_W + blackX(semitone);
            return (
              <g key={`b${note}`}>
                <rect x={x} y={0} width={BLACK_W} height={BLACK_H} rx={2} fill="#18181b" />
                {pressed.has(note) && (
                  <circle cx={x + BLACK_W / 2} cy={BLACK_H - 8} r={3.5} fill={note === voicing!.root ? "var(--color-accent)" : "#f4f4f5"} />
                )}
              </g>
            );
          }),
        )}
      </svg>
    </div>
  );
}
