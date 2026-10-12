"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import type { ChordSegment, KaraokeLine, Word } from "@/lib/api";
import { player } from "@/lib/player";

type Item =
  | {
      kind: "line";
      start: number;
      end: number;
      words: Word[];
      /** Pronunciation words with timings borrowed from the original words, if any. */
      romanized: Word[] | null;
      /** Timing for every fillable element in DOM order: original words, then romanised. */
      parts: Word[];
      /** Chord name to show above each word (lead-sheet style), if any. */
      chordMarks: (string | undefined)[];
      romanizedChordMarks: (string | undefined)[];
      lineIndex: number;
    }
  | { kind: "gap"; start: number; end: number };

const INTRO_GAP = 3;
const BREAK_GAP = 6;
const BROWSE_IDLE_MS = 2500;
const ANCHOR = 0.3; // active line sits 30% down the viewport

/**
 * Words WhisperX couldn't time are dropped from `words`, so rebuild the line from its
 * full text and borrow neighbouring timings for any token without its own.
 */
function timedTokens(line: KaraokeLine): Word[] {
  const tokens = line.line.split(/\s+/).filter(Boolean);
  if (!line.words.length) return [{ word: line.line, start: line.start, end: line.end }];
  const out: Word[] = [];
  let j = 0;
  for (const token of tokens) {
    const w = line.words[j];
    if (w && w.word === token) {
      out.push(w);
      j++;
    } else {
      const prevEnd = out.at(-1)?.end ?? line.start;
      const nextStart = line.words[j]?.start ?? line.end;
      out.push({ word: token, start: prevEnd, end: Math.max(prevEnd, nextStart) });
    }
  }
  return out;
}

/**
 * Give each pronunciation word the timing of the original word it stands for. Same word
 * count pairs them one to one; otherwise each romanised word covers its share of the
 * line's words by position.
 */
function romanizedTokens(text: string, words: Word[]): Word[] {
  const parts = text.split(/\s+/).filter(Boolean);
  if (!parts.length || !words.length) return [];
  if (parts.length === words.length) return parts.map((word, i) => ({ word, start: words[i].start, end: words[i].end }));
  return parts.map((word, i) => {
    const first = words[Math.min(Math.floor((i / parts.length) * words.length), words.length - 1)];
    const last = words[Math.min(Math.ceil(((i + 1) / parts.length) * words.length) - 1, words.length - 1)];
    return { word, start: first.start, end: Math.max(last.end, first.start) };
  });
}

/**
 * Lead-sheet placement: each chord that starts during the line goes above the word being
 * sung at that moment, and the line's first word shows the chord already sounding.
 * Chords that start in an instrumental break are left to the live chord readout.
 */
function chordMarks(words: Word[], chords: ChordSegment[], from: number, to: number) {
  const marks: (string | undefined)[] = new Array(words.length).fill(undefined);
  if (!chords.length || !words.length) return marks;
  let sounding: string | undefined;
  for (const c of chords) {
    if (c.start <= from + 0.05) {
      if (c.end > from) sounding = c.chord;
      continue;
    }
    if (c.start >= to) break;
    let k = 0;
    for (let i = 0; i < words.length; i++) if (words[i].start <= c.start + 0.15) k = i;
    marks[k] = c.chord;
  }
  if (!marks[0] && sounding) marks[0] = sounding;
  // Only show changes: drop a mark that repeats the previous one in this line
  let previous: string | undefined;
  return marks.map((m) => {
    if (!m) return m;
    const keep = m !== previous;
    previous = m;
    return keep ? m : undefined;
  });
}

function buildItems(
  lines: KaraokeLine[],
  romanizations?: Record<string, string> | null,
  chords: ChordSegment[] = [],
): Item[] {
  const items: Item[] = [];
  lines.forEach((line, i) => {
    const prevEnd = i === 0 ? 0 : lines[i - 1].end;
    if (line.start - prevEnd >= (i === 0 ? INTRO_GAP : BREAK_GAP)) {
      items.push({ kind: "gap", start: i === 0 ? 0 : prevEnd + 0.3, end: line.start - 0.2 });
    }
    const words = timedTokens(line);
    const text = romanizations?.[i];
    const romanized = text ? romanizedTokens(text, words) : null;
    const nextStart = lines[i + 1]?.start ?? Infinity;
    const windowEnd = Math.min(nextStart, line.end + 0.5);
    items.push({
      kind: "line",
      start: line.start,
      end: line.end,
      words,
      romanized,
      parts: romanized ? [...words, ...romanized] : words,
      chordMarks: chordMarks(words, chords, line.start, windowEnd),
      romanizedChordMarks: romanized ? chordMarks(romanized, chords, line.start, windowEnd) : [],
      lineIndex: i,
    });
  });
  return items;
}

/** Index of the last item that has started, or -1 before the first. */
function findActive(items: Item[], t: number) {
  let lo = 0;
  let hi = items.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (items[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

type LyricsProps = {
  lines: KaraokeLine[];
  active: boolean;
  /** English for non-English lines, keyed by line index. */
  translations?: Record<string, string> | null;
  showTranslations?: boolean;
  /** Latin-letter pronunciation for non-Latin-script lines, keyed by line index. */
  romanizations?: Record<string, string> | null;
  showRomanizations?: boolean;
  /** Show the pronunciation as the main line and the original script underneath. */
  romanizedFirst?: boolean;
  /** Detected chords, shown above the words. */
  chords?: ChordSegment[] | null;
  showChords?: boolean;
  /** Seconds to shift the lyrics by (positive = lyrics earlier). */
  offset?: number;
};

/**
 * React renders the lines once. Everything per-frame (active line, word fill, scroll
 * position) is applied imperatively from the playback clock.
 */
export const Lyrics = memo(function Lyrics({
  lines,
  active,
  translations,
  showTranslations = true,
  romanizations,
  showRomanizations = true,
  romanizedFirst = false,
  chords,
  showChords = true,
  offset = 0,
}: LyricsProps) {
  const items = useMemo(() => buildItems(lines, romanizations, chords ?? []), [lines, romanizations, chords]);
  const viewportRef = useRef<HTMLDivElement>(null);
  // Read by the clock callback, so changing the offset doesn't rebuild the engine
  const offsetRef = useRef(offset);
  offsetRef.current = offset;

  // Re-place the lyrics right away when the offset changes, even while paused.
  useEffect(() => {
    if (active) player.resync();
  }, [offset, active]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!active) return;
    const viewport = viewportRef.current!;
    const list = listRef.current!;
    const els = Array.from(list.children) as HTMLElement[];
    const parts = els.map((el) => Array.from(el.querySelectorAll<HTMLElement>("[data-part]")));

    let tops: number[] = [];
    let current = -2;
    let lastY: number | null = null;
    let partProgress: number[] = [];
    let browsing = false;
    let manual = 0;
    let browseTimer = 0;

    const measure = () => {
      tops = els.map((el) => el.offsetTop);
    };

    const layout = (instant: boolean) => {
      const focus = Math.max(current, 0);
      const anchor = viewport.clientHeight * ANCHOR;
      const y = anchor - (tops[focus] ?? 0);
      const reach = viewport.clientHeight * 1.2;
      els.forEach((el, i) => {
        const before = lastY === null ? Infinity : Math.abs(tops[i] + lastY - anchor);
        const after = Math.abs(tops[i] + y - anchor);
        // Only lines on screen animate; the rest jump so off-screen work stays at zero.
        const skip = instant || (before > reach && after > reach);
        el.dataset.instant = String(skip);
        // Lines below the active one follow with a small cascade.
        el.style.transitionDelay = skip ? "" : `${Math.min(Math.max(i - focus + 1, 0), 8) * 38}ms, 0ms, 0ms`;
        el.style.transform = `translate3d(0, ${y}px, 0)`;
        const d = current < 0 ? 3 : Math.min(Math.abs(i - focus), 3);
        el.dataset.d = String(d);
      });
      lastY = y;
    };

    const resetParts = (index: number) => {
      parts[index]?.forEach((p) => {
        p.style.setProperty("--p", "0");
        p.classList.remove("is-sung");
      });
    };

    const setActive = (next: number, instant: boolean) => {
      if (next === current) return;
      if (current >= 0) {
        els[current].classList.remove("is-active");
        resetParts(current);
      }
      current = next;
      if (current >= 0) {
        resetParts(current);
        els[current].classList.add("is-active");
      }
      partProgress = new Array(parts[current]?.length ?? 0).fill(0);
      if (!browsing) layout(instant);
    };

    const paintActive = (t: number) => {
      const item = items[current];
      const nodes = parts[current];
      if (!item || !nodes) return;
      for (let k = 0; k < nodes.length; k++) {
        let p: number;
        if (item.kind === "line") {
          const w = item.parts[k];
          p = clamp01((t - w.start) / Math.max(w.end - w.start, 0.05));
        } else {
          // Three breathing dots fill one after another across the break.
          p = clamp01(((t - item.start) / (item.end - item.start)) * 3 - k);
        }
        const last = partProgress[k];
        if (Math.abs(p - last) > 0.004 || ((p === 0 || p === 1) && p !== last)) {
          partProgress[k] = p;
          nodes[k].style.setProperty("--p", p.toFixed(3));
          if (p > 0 && last === 0) nodes[k].classList.add("is-sung");
        }
      }
    };

    let first = true;
    const onTime = (playback: number) => {
      const t = playback + offsetRef.current;
      setActive(findActive(items, t), first);
      first = false;
      if (current >= 0) paintActive(t);
    };

    // ---- Manual browsing (wheel / touch), auto-follow resumes after a pause ----

    const bounds = () => {
      const focus = Math.max(current, 0);
      return { min: -((tops.at(-1) ?? 0) - tops[focus]), max: tops[focus] - (tops[0] ?? 0) };
    };

    const setManual = (value: number) => {
      const { min, max } = bounds();
      manual = Math.min(max, Math.max(min, value));
      list.style.translate = `0 ${manual}px`;
    };

    const endBrowse = () => {
      clearTimeout(browseTimer);
      if (!browsing) return;
      browsing = false;
      delete viewport.dataset.browsing;
      manual = 0;
      list.style.translate = "0 0";
      layout(false);
    };

    const scheduleEnd = () => {
      clearTimeout(browseTimer);
      browseTimer = window.setTimeout(endBrowse, BROWSE_IDLE_MS);
    };

    const startBrowse = () => {
      if (browsing) return;
      browsing = true;
      viewport.dataset.browsing = "true";
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      startBrowse();
      const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      setManual(manual - delta);
      scheduleEnd();
    };

    let touchStartY = 0;
    let touchStartManual = 0;
    let dragged = false;
    let touchId: number | null = null;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || touchId !== null) return;
      touchId = e.pointerId;
      touchStartY = e.clientY;
      touchStartManual = manual;
      dragged = false;
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== touchId) return;
      const dy = e.clientY - touchStartY;
      if (!dragged && Math.abs(dy) < 6) return;
      if (!dragged) {
        dragged = true;
        startBrowse();
        clearTimeout(browseTimer);
      }
      setManual(touchStartManual + dy);
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId !== touchId) return;
      touchId = null;
      if (dragged) scheduleEnd();
    };

    const onClick = (e: MouseEvent) => {
      if (dragged) {
        dragged = false;
        return;
      }
      const el = (e.target as HTMLElement).closest<HTMLElement>("[data-index]");
      if (!el) return;
      const item = items[Number(el.dataset.index)];
      if (item.kind !== "line") return;
      endBrowse();
      player.seek(item.start - offsetRef.current);
      player.resume();
    };

    measure();
    const ro = new ResizeObserver(() => {
      measure();
      layout(true);
    });
    ro.observe(list);
    ro.observe(viewport);

    viewport.addEventListener("wheel", onWheel, { passive: false });
    viewport.addEventListener("pointerdown", onPointerDown);
    viewport.addEventListener("pointermove", onPointerMove);
    viewport.addEventListener("pointerup", onPointerUp);
    viewport.addEventListener("pointercancel", onPointerUp);
    list.addEventListener("click", onClick);
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
      list.removeEventListener("click", onClick);
      delete viewport.dataset.browsing;
      list.style.translate = "";
    };
  }, [items, active]);

  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label="Lyrics"
      data-translations={showTranslations}
      data-romanizations={showRomanizations}
      data-swap={romanizedFirst}
      data-chords={showChords && !!chords?.length}
      className="lyrics-viewport relative h-full overflow-hidden"
    >
      <div ref={listRef} className="lyrics-list">
        {items.map((item, i) =>
          item.kind === "line" ? (
            <p
              key={i}
              data-index={i}
              data-has-chords={item.chordMarks.some(Boolean) || item.romanizedChordMarks.some(Boolean) || undefined}
              className="lyric-item lyric-line origin-left cursor-pointer py-[0.32em] text-[clamp(1.75rem,3.3vw,2.75rem)] leading-[1.18] font-bold tracking-[-0.015em] text-balance"
            >
              {/* Original words stay first in the DOM (fill order); CSS can swap their position */}
              <span className="lyric-original">
                {item.words.map((w, k) => (
                  <span key={k} className="relative">
                    {item.chordMarks[k] && (
                      <span aria-hidden className="lyric-chord">
                        {item.chordMarks[k]}
                      </span>
                    )}
                    <span data-part className="lyric-word">
                      {w.word}
                    </span>{" "}
                  </span>
                ))}
              </span>
              {item.romanized && (
                <span lang="en" className="lyric-romanized leading-snug font-semibold tracking-normal">
                  {item.romanized.map((w, k) => (
                    <span key={k} className="relative">
                      {item.romanizedChordMarks[k] && (
                        <span aria-hidden className="lyric-chord">
                          {item.romanizedChordMarks[k]}
                        </span>
                      )}
                      <span data-part className="lyric-word lyric-rword">
                        {w.word}
                      </span>{" "}
                    </span>
                  ))}
                </span>
              )}
              {translations?.[item.lineIndex] && (
                <span lang="en" className="lyric-translation block pt-[0.3em] text-[0.52em] leading-snug font-semibold tracking-normal">
                  {translations[item.lineIndex]}
                </span>
              )}
            </p>
          ) : (
            <div
              key={i}
              data-index={i}
              aria-hidden
              className="lyric-item lyric-gap box-content flex h-[1.18em] items-center gap-[0.22em] py-[0.32em] pl-[0.08em] text-[clamp(1.75rem,3.3vw,2.75rem)]"
            >
              {[0, 1, 2].map((k) => (
                <span key={k} data-part className="gap-dot size-[0.32em] rounded-full bg-white" />
              ))}
            </div>
          ),
        )}
      </div>
    </div>
  );
});
