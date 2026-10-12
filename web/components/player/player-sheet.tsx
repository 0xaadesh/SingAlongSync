"use client";

import { ChevronDown, Search } from "lucide-react";
import { useEffect, useRef, type PointerEvent } from "react";
import { artworkUrl, imageCors, type SongDetail } from "@/lib/api";
import { player, usePlayer } from "@/lib/player";
import { useStore } from "@/lib/store";
import {
  openLyricsDialog,
  romanizedFirstStore,
  initPlayerView,
  playerViewStore,
  setPlayerView,
  showChordsStore,
  showRomanizationsStore,
  showTranslationsStore,
  type PlayerView,
} from "@/lib/ui";
import { Marquee } from "@/components/ui/marquee";
import { Ambient } from "./ambient";
import { TransportControls, VolumeControl } from "./controls";
import { Lyrics } from "./lyrics";
import { Progress } from "./progress";
import { KaraokeMenu, LyricsMenu, QueueMenu } from "./player-menus";
import { SongFacts } from "./song-facts";
import { BeatView } from "./beat-view";
import { Tabs } from "@/components/ui/tabs";

const VIEW_TABS = [
  { id: "lyrics", label: "Lyrics" },
  { id: "beats", label: "Beats" },
];

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 0.11; // px per ms: a quick flick is enough

/** Full-screen "Now Playing" view with synced lyrics. Slides up over the library. */
export function PlayerSheet() {
  const { song, detail, detailError, playing, sheetOpen, lyricsOffset } = usePlayer();
  const showTranslations = useStore(showTranslationsStore);
  const showRomanizations = useStore(showRomanizationsStore);
  const romanizedFirst = useStore(romanizedFirstStore);
  const showChords = useStore(showChordsStore);
  const view = useStore(playerViewStore);
  useEffect(() => initPlayerView(), []);
  const sheetRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useRef<{ id: number; startY: number; startTime: number; dy: number } | null>(null);

  // Lock page scroll and move focus into the sheet while it's open.
  useEffect(() => {
    if (!sheetOpen) return;
    const root = document.documentElement;
    const previousFocus = document.activeElement as HTMLElement | null;
    root.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      root.style.overflow = "";
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, [sheetOpen]);

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    // Only drag from empty header space, never from controls or the open menus
    const target = e.target as HTMLElement;
    if (e.button !== 0 || drag.current || target.closest("button, a, input, [role=slider], [role=dialog]")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id: e.pointerId, startY: e.clientY, startTime: performance.now(), dy: 0 };
    sheetRef.current!.dataset.dragging = "true";
  };

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const raw = e.clientY - d.startY;
    // Dragging up past the top meets increasing resistance instead of a hard stop.
    d.dy = raw > 0 ? raw : raw * 0.15;
    sheetRef.current!.style.translate = `0 ${d.dy}px`;
  };

  const onPointerUp = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const sheet = sheetRef.current!;
    delete sheet.dataset.dragging;
    sheet.style.translate = "";
    const velocity = d.dy / (performance.now() - d.startTime);
    if (d.dy > DISMISS_DISTANCE || (d.dy > 10 && velocity > DISMISS_VELOCITY)) player.closeSheet();
  };

  const art = song ? artworkUrl(song) : null;

  return (
    <div
      ref={sheetRef}
      role="dialog"
      aria-modal="true"
      aria-label="Now playing"
      data-open={sheetOpen}
      inert={!sheetOpen}
      className="player-sheet fixed inset-0 z-50 overflow-hidden text-white"
    >
      <Ambient src={art} paused={!playing || !sheetOpen} />

      <div className="relative flex h-full flex-col">
        <header
          className="relative z-10 flex h-16 shrink-0 cursor-grab touch-none items-center justify-between gap-4 px-4 active:cursor-grabbing sm:px-6"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <button
            ref={closeRef}
            type="button"
            aria-label="Close player"
            onClick={() => player.closeSheet()}
            className="pressable grid size-10 place-items-center rounded-full bg-white/10 text-white/90 hover:bg-white/20"
          >
            <ChevronDown size={22} strokeWidth={2} />
          </button>
          {/* Grab handle; the view switch takes its place once a song is loaded */}
          {!detail && <div aria-hidden className="mx-auto h-1.5 w-10 rounded-full bg-white/25 lg:hidden" />}
          {detail && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
              <Tabs
                tabs={VIEW_TABS}
                value={view}
                onChange={(id) => setPlayerView(id as PlayerView)}
                label="Player view"
                idPrefix="view"
              />
            </div>
          )}
          {detail ? (
            <div className="flex items-center gap-2">
              <KaraokeMenu detail={detail} />
              <LyricsMenu key={detail.videoId} detail={detail} />
              <QueueMenu />
            </div>
          ) : (
            <div aria-hidden className="size-10" />
          )}
        </header>

        <main
          className="grid min-h-0 flex-1 gap-x-16 px-6 pb-6 [grid-template-areas:'meta'_'lyrics'_'controls'] grid-rows-[auto_1fr_auto] sm:px-10 lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)] lg:grid-rows-[1fr_auto_auto_auto_1fr] lg:px-16 lg:pb-10 lg:[grid-template-areas:'._lyrics'_'art_lyrics'_'meta_lyrics'_'controls_lyrics'_'._lyrics'] xl:gap-x-24"
        >
          {song && (
            <>
              <div className="hidden [grid-area:art] lg:block">
                <img
                  src={art!}
                  alt=""
                  width={420}
                  height={420}
                  decoding="async"
                  crossOrigin={imageCors(art!)}
                  data-paused={!playing}
                  className="player-artwork image-outline aspect-square w-full rounded-xl object-cover shadow-[0_24px_60px_-12px_rgb(0_0_0/0.55)]"
                />
              </div>

              <div className="flex min-w-0 items-center gap-4 pb-4 [grid-area:meta] lg:block lg:pt-7 lg:pb-5">
                <img
                  src={art!}
                  alt=""
                  width={56}
                  height={56}
                  decoding="async"
                  crossOrigin={imageCors(art!)}
                  className="image-outline size-14 shrink-0 rounded-md object-cover lg:hidden"
                />
                <div className="min-w-0">
                  <h2 className="truncate text-lg leading-tight font-semibold lg:text-xl">{song.title}</h2>
                  <Marquee key={song.videoId} className="text-[15px] text-white/60 lg:text-base">{song.artist}</Marquee>
                  {detail && detail.videoId === song.videoId && <SongFacts detail={detail} />}
                </div>
              </div>

              <div className="pt-4 [grid-area:controls] lg:pt-0">
                <Progress />
                <div className="mt-3">
                  <TransportControls />
                </div>
                {/* Shown at every width; centred and narrower on small screens */}
                <div className="mx-auto mt-4 max-w-xs lg:mx-0 lg:mt-5 lg:max-w-none">
                  <VolumeControl />
                </div>
              </div>

              <div className="relative min-h-0 [grid-area:lyrics] lg:-my-10">
                {detail && view === "beats" ? (
                  <div id="view-panel-beats" role="tabpanel" aria-labelledby="view-tab-beats" className="h-full">
                    {detail.analysis?.beats?.length ? (
                      <BeatView
                        analysis={detail.analysis}
                        lines={detail.lines}
                        romanizations={showRomanizations ? detail.romanizations : null}
                        active={sheetOpen}
                      />
                    ) : (
                      <LyricsMessage>
                        {detail.analysisStatus === "pending"
                          ? "Finding the beat and chords…"
                          : "The beat view isn't ready for this song yet."}
                      </LyricsMessage>
                    )}
                  </div>
                ) : detail ? (
                  detail.lines.length ? (
                    <Lyrics
                      lines={detail.lines}
                      active={sheetOpen}
                      translations={detail.translations}
                      showTranslations={showTranslations}
                      romanizations={detail.romanizations}
                      showRomanizations={showRomanizations}
                      romanizedFirst={romanizedFirst}
                      chords={detail.analysis?.chords}
                      showChords={showChords}
                      offset={lyricsOffset}
                    />
                  ) : (
                    <NoLyrics detail={detail} />
                  )
                ) : detailError ? (
                  <LyricsMessage>{detailError}</LyricsMessage>
                ) : (
                  <LyricsSkeleton />
                )}
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  );
}

/** Songs saved without lyrics: offer to find them. */
function NoLyrics({ detail }: { detail: SongDetail }) {
  return (
    <div className="flex h-full flex-col items-start justify-center gap-4">
      <p className="text-2xl font-semibold text-white/60">No lyrics for this song yet.</p>
      <p className="max-w-sm text-[15px] text-white/50 text-pretty">
        Search LRCLIB for synced lyrics, or use your own .lrc file. The song re-syncs in about a minute.
      </p>
      <button
        type="button"
        onClick={() =>
          openLyricsDialog({
            videoId: detail.videoId,
            title: detail.title,
            artist: detail.artist,
            artists: detail.artists,
            duration: detail.duration,
          })
        }
        className="pressable flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-black hover:bg-white/85"
      >
        <Search size={17} strokeWidth={2.25} />
        Find lyrics
      </button>
    </div>
  );
}

function LyricsMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center">
      <p className="text-2xl font-semibold text-white/50">{children}</p>
    </div>
  );
}

function LyricsSkeleton() {
  return (
    <div aria-hidden className="flex h-full flex-col justify-start gap-5 pt-[24vh]">
      {[78, 62, 84, 55].map((w, i) => (
        <div key={i} className="skeleton h-9 rounded-lg" style={{ width: `${w}%`, animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}
