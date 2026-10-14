"use client";

import { ChevronDown, RotateCw, Search, TextQuote } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { analyzeSong, artworkUrl, imageCors, type Job, type SongDetail } from "@/lib/api";
import { useJobs } from "@/lib/jobs";
import { player, usePlayer } from "@/lib/player";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import {
  openLyricsDialog,
  romanizedFirstStore,
  initPlayerView,
  playerViewStore,
  setPlayerView,
  showChordsStore,
  showRomanizationsStore,
  showSongFactsStore,
  showTranslationsStore,
  type PlayerView,
} from "@/lib/ui";
import { isActiveJob, JobSteps, jobFraction, statusLine } from "@/components/library/jobs";
import { Marquee } from "@/components/ui/marquee";
import { Ambient } from "./ambient";
import { TransportControls, VolumeControl } from "./controls";
import { Lyrics } from "./lyrics";
import { Progress } from "./progress";
import { BarButton, KaraokeMenu, LyricsMenu, QueueMenu } from "./player-menus";
import { SongFacts } from "./song-facts";
import { BeatView } from "./beat-view";
import { Tabs } from "@/components/ui/tabs";

const VIEW_TABS = [
  { id: "song", label: "Song" },
  { id: "lyrics", label: "Lyrics" },
  { id: "beats", label: "Beats" },
];

// Below desktop width Lyrics has its own button in the bottom bar
const COMPACT_VIEW_TABS = VIEW_TABS.filter((t) => t.id !== "lyrics");

const DISMISS_DISTANCE = 140;
const DISMISS_VELOCITY = 0.11; // px per ms: a quick flick is enough

/** Full-screen "Now Playing" view: the song, its synced lyrics, or its beats. Slides up over the library. */
export function PlayerSheet() {
  const { song, detail, detailError, playing, sheetOpen, lyricsOffset } = usePlayer();
  const showTranslations = useStore(showTranslationsStore);
  const showRomanizations = useStore(showRomanizationsStore);
  const romanizedFirst = useStore(romanizedFirstStore);
  const showChords = useStore(showChordsStore);
  const showSongFacts = useStore(showSongFactsStore);
  const view = useStore(playerViewStore);
  // A job on the open song (new lyrics being synced) replaces the lyrics until it's done
  const { jobs } = useJobs();
  const syncing = jobs.find((j) => j.id === song?.videoId && isActiveJob(j)) ?? null;
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
    // (only within the header: the sheet itself is a role=dialog ancestor of everything)
    const control = (e.target as HTMLElement).closest("button, a, input, [role=slider], [role=dialog]");
    if (e.button !== 0 || drag.current || (control && e.currentTarget.contains(control))) return;
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

  // Title, artist and the key/chord chips: under the cover in the song view, beside it otherwise
  const meta = song && (
    <>
      <h2 className="truncate text-lg leading-tight font-semibold lg:text-xl">{song.title}</h2>
      <Marquee key={song.videoId} className="text-[15px] text-white/60 lg:text-base">
        {song.artist}
      </Marquee>
      {showSongFacts && detail && detail.videoId === song.videoId && <SongFacts detail={detail} />}
    </>
  );

  const controls = (
    <div className="pt-2 sm:pt-3 lg:pt-0">
      {/* Below desktop width the view switch sits right above the seek bar, within thumb reach */}
      {detail && (
        <div className="mb-3 flex justify-center lg:hidden">
          <Tabs tabs={COMPACT_VIEW_TABS} value={view} onChange={(id) => setPlayerView(id as PlayerView)} label="Player view" idPrefix="view-compact" />
        </div>
      )}
      <Progress />
      <div className="mt-2 sm:mt-3">
        <TransportControls />
      </div>
      {/* Phones use their hardware volume buttons; centred and narrower on tablets */}
      <div className="mx-auto mt-4 hidden max-w-xs sm:block lg:mx-0 lg:mt-5 lg:max-w-none">
        <VolumeControl />
      </div>
    </div>
  );

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
          className="relative z-10 box-content flex h-14 shrink-0 cursor-grab touch-none items-center justify-between gap-2 px-3 pt-[env(safe-area-inset-top)] active:cursor-grabbing sm:h-16 sm:gap-4 sm:px-6"
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
            className="pressable grid size-9 shrink-0 place-items-center rounded-full bg-white/10 text-white/90 hover:bg-white/20 sm:size-10"
          >
            <ChevronDown size={22} strokeWidth={2} />
          </button>
          {/* Grab handle; on desktop the view switch takes its place once a song is loaded */}
          <div aria-hidden className={`mx-auto h-1.5 w-10 rounded-full bg-white/25 ${detail ? "lg:hidden" : ""}`} />
          {detail && (
            <div className="absolute top-1/2 left-1/2 hidden -translate-x-1/2 -translate-y-1/2 lg:block">
              <Tabs tabs={VIEW_TABS} value={view} onChange={(id) => setPlayerView(id as PlayerView)} label="Player view" idPrefix="view" />
            </div>
          )}
          {/* Below desktop width these live in the bottom bar */}
          {detail && (
            <div className="hidden shrink-0 items-center gap-2 lg:flex">
              <KaraokeMenu detail={detail} />
              <LyricsMenu key={detail.videoId} detail={detail} />
              <QueueMenu />
            </div>
          )}
          <div aria-hidden className={`size-9 sm:size-10 ${detail ? "lg:hidden" : ""}`} />
        </header>

        <main className="flex min-h-0 flex-1 flex-col px-5 pb-[max(env(safe-area-inset-bottom),0.5rem)] sm:px-10 lg:px-16 lg:pb-10">
          {song && view === "song" && (
            // Song: the cover, as big as fits, over the title and controls
            <div
              id="view-panel-song"
              role="tabpanel"
              aria-labelledby="view-tab-song"
              className="mx-auto flex min-h-0 w-full max-w-[460px] flex-1 flex-col"
            >
              <div className="grid min-h-0 flex-1 place-items-center py-3 [container-type:size] sm:py-5">
                <img
                  src={art!}
                  alt=""
                  width={460}
                  height={460}
                  decoding="async"
                  crossOrigin={imageCors(art!)}
                  data-paused={!playing}
                  className="player-artwork image-outline size-[min(100cqw,100cqh)] rounded-xl object-cover shadow-[0_24px_60px_-12px_rgb(0_0_0/0.55)]"
                />
              </div>
              <div className="min-w-0 pt-2 pb-1">{meta}</div>
              {controls}
            </div>
          )}

          {song && view !== "song" && (
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] gap-x-16 [grid-template-areas:'meta'_'lyrics'_'controls'] grid-rows-[auto_1fr_auto] lg:grid-cols-[minmax(300px,420px)_minmax(0,1fr)] lg:grid-rows-[1fr_auto_auto_auto_1fr] lg:[grid-template-areas:'._lyrics'_'art_lyrics'_'meta_lyrics'_'controls_lyrics'_'._lyrics'] xl:gap-x-24">
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

              <div className="flex min-w-0 items-center gap-3.5 pb-3 [grid-area:meta] sm:gap-4 sm:pb-4 lg:block lg:pt-7 lg:pb-5">
                <img
                  src={art!}
                  alt=""
                  width={56}
                  height={56}
                  decoding="async"
                  crossOrigin={imageCors(art!)}
                  className="image-outline size-14 shrink-0 rounded-md object-cover lg:hidden"
                />
                <div className="min-w-0">{meta}</div>
              </div>

              <div className="[grid-area:controls]">{controls}</div>

              <div className="relative min-h-0 min-w-0 [grid-area:lyrics] lg:-my-10">
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
                      <BeatsUnavailable detail={detail} />
                    )}
                  </div>
                ) : detail ? (
                  <div id="view-panel-lyrics" role="tabpanel" aria-labelledby="view-tab-lyrics" className="h-full">
                    {syncing ? (
                      <LyricsSyncing job={syncing} />
                    ) : detail.lines.length ? (
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
                    )}
                  </div>
                ) : detailError ? (
                  <LyricsMessage>{detailError}</LyricsMessage>
                ) : (
                  <LyricsSkeleton />
                )}
              </div>
            </div>
          )}

          {/* Phones and tablets: the menus and the lyrics switch, within thumb reach */}
          {detail && (
            <nav aria-label="Player" className="-mx-2 mt-2 flex items-stretch lg:hidden">
              <QueueMenu variant="bar" />
              <div className="flex-1">
                <BarButton
                  label="Lyrics"
                  active={view === "lyrics"}
                  aria-pressed={view === "lyrics"}
                  onClick={() => setPlayerView(view === "lyrics" ? "song" : "lyrics")}
                >
                  <TextQuote size={20} strokeWidth={2} />
                </BarButton>
              </div>
              <KaraokeMenu detail={detail} variant="bar" />
              <LyricsMenu key={detail.videoId} detail={detail} variant="bar" />
            </nav>
          )}
        </main>
      </div>
    </div>
  );
}

/** New lyrics being synced: a skeleton behind the job's progress and steps. */
function LyricsSyncing({ job }: { job: Job }) {
  return (
    <div className="relative h-full" aria-live="polite">
      <div className="opacity-40">
        <LyricsSkeleton />
      </div>
      <div className="absolute inset-0 flex items-center justify-center p-1">
        <div className="enter-up w-full max-w-sm rounded-[22px] bg-black/40 p-5 shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_24px_56px_-16px_rgb(0_0_0/0.7)] backdrop-blur-xl">
          <p className="text-[16px] font-semibold">Syncing the new lyrics</p>
          <p className="mt-0.5 truncate text-[13px] text-white/60 tabular-nums">{statusLine(job)}</p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
            <div
              className="h-full origin-left bg-accent transition-[scale] duration-500 ease-[var(--ease-out)]"
              style={{ scale: `${Math.max(jobFraction(job), 0.04)} 1` }}
            />
          </div>
          <div className="mt-5">
            <JobSteps job={job} />
          </div>
        </div>
      </div>
    </div>
  );
}

const ANALYSIS_POLL_MS = 3000;

/** No beats yet: still being found (refetched until they land), or failed with a retry. */
function BeatsUnavailable({ detail }: { detail: SongDetail }) {
  const pending = detail.analysisStatus === "pending";
  const failed = detail.analysisStatus === "failed";
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pending) return;
    const id = setInterval(() => player.refreshDetail().catch(() => {}), ANALYSIS_POLL_MS);
    return () => clearInterval(id);
  }, [pending, detail.videoId]);

  if (pending) return <LyricsMessage>Finding the beat and chords…</LyricsMessage>;

  const retry = async () => {
    setBusy(true);
    try {
      await analyzeSong(detail.videoId);
      await player.refreshDetail();
    } catch (e) {
      toast({ title: "Couldn't start the analysis", description: (e as Error).message, tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col items-start justify-center gap-4">
      <p className="text-2xl font-semibold text-white/60">
        {failed ? "Couldn't find the beat for this song." : "The beat view isn't ready for this song yet."}
      </p>
      {failed && detail.analysisError && (
        <p className="line-clamp-3 max-w-md text-[13px] text-white/45 break-words">{detail.analysisError}</p>
      )}
      <button
        type="button"
        onClick={retry}
        disabled={busy}
        className="pressable flex h-11 items-center gap-2 rounded-full bg-white px-5 text-[15px] font-semibold text-black hover:bg-white/85 disabled:opacity-60"
      >
        <RotateCw size={16} strokeWidth={2.25} className={busy ? "spin" : ""} />
        {failed ? "Try again" : "Find the beat"}
      </button>
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
