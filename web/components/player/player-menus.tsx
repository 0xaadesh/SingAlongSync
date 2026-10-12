"use client";

import { Languages, ListMusic, Mic2, Minus, Plus, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { artworkUrl, imageCors, translateSong, type SongDetail } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { libraryStore } from "@/lib/library";
import { player, queuePosition, usePlayer } from "@/lib/player";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import {
  initShowRomanizations,
  initShowTranslations,
  setShowRomanizations,
  setShowTranslations,
  showRomanizationsStore,
  showTranslationsStore,
} from "@/lib/ui";
import { ExplicitBadge } from "@/components/ui/explicit-badge";
import { Popover } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "./slider";

/** Round header button; filled white while its feature is on. */
function HeaderButton({
  label,
  active,
  children,
  ...props
}: { label: string; active?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...props}
      className={`pressable relative grid size-10 place-items-center rounded-full ${
        active ? "bg-white text-black hover:bg-white/85" : "bg-white/10 text-white/90 hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

function MenuRow({ title, hint, control }: { title: string; hint?: string; control: ReactNode }) {
  return (
    <div className="flex items-center gap-3 rounded-[12px] px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">{title}</p>
        {hint && <p className="text-[12px] text-subtle text-pretty">{hint}</p>}
      </div>
      {control}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Karaoke
// ---------------------------------------------------------------------------

export function KaraokeMenu({ detail }: { detail: SongDetail }) {
  const { karaoke, vocalLevel } = usePlayer();
  const available = !!detail.stems;

  return (
    <Popover
      label="Karaoke"
      width={300}
      trigger={(props) => (
        <HeaderButton label="Karaoke" active={karaoke && available} {...props}>
          <Mic2 size={18} strokeWidth={2} />
        </HeaderButton>
      )}
    >
      {() => (
        <>
          <MenuRow
            title="Karaoke mode"
            hint={available ? "Plays the music without the singer, so you take the vocals." : "Not ready for this song yet. Its stems are still being prepared."}
            control={
              <Switch label="Karaoke mode" checked={karaoke} disabled={!available} onChange={(on) => player.setKaraoke(on)} />
            }
          />
          {karaoke && available && (
            <div className="enter-up px-3 pt-1 pb-3">
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-[13px] font-medium">Guide vocals</p>
                <span className="text-[12px] text-subtle tabular-nums">
                  {vocalLevel === 0 ? "Off" : `${Math.round(vocalLevel * 100)}%`}
                </span>
              </div>
              <Slider
                label="Guide vocals"
                value={vocalLevel}
                keyboardStep={0.05}
                valueText={(f) => (f === 0 ? "Off" : `${Math.round(f * 100)}%`)}
                onScrub={(f) => player.setVocalLevel(f)}
                onCommit={(f) => player.setVocalLevel(f)}
              />
              <p className="mt-2 text-[12px] text-subtle">Keep a little of the singer to stay on track. Press K to toggle.</p>
            </div>
          )}
        </>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Lyrics: translation, pronunciation and timing
// ---------------------------------------------------------------------------

const POLL_MS = 3000;
const POLL_LIMIT_MS = 120_000;

function hasNonLatin(text: string) {
  return /[^\u0000-ɏ\s\d\p{P}\p{S}]/u.test(text);
}

export function LyricsMenu({ detail }: { detail: SongDetail }) {
  const { lyricsOffset } = usePlayer();
  const showTranslations = useStore(showTranslationsStore);
  const showRomanizations = useStore(showRomanizationsStore);
  const [translating, setTranslating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    initShowTranslations();
    initShowRomanizations();
  }, []);

  // While a translation runs on the server, refetch until it lands.
  useEffect(() => {
    if (!translating) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      // The server removes the old file when re-translating, so any translations mean the new ones
      const fresh = await player.refreshDetail().catch(() => null);
      const landed = !!fresh?.translations;
      if (landed || Date.now() - started > POLL_LIMIT_MS) {
        setTranslating(false);
        if (!landed) toast({ title: "Translation is taking a while", description: "Check Settings for errors." });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [translating, detail.videoId]);

  const translationCount = detail.translations ? Object.keys(detail.translations).length : 0;
  const romanizationCount = detail.romanizations ? Object.keys(detail.romanizations).length : 0;
  const nonLatin = detail.lines.some((l) => hasNonLatin(l.line));
  // Untranslated, or translated before pronunciations existed for a song that needs them
  const canTranslate = detail.translations === null || (nonLatin && detail.romanizations === null);

  const translate = async () => {
    try {
      await translateSong(detail.videoId);
      setTranslating(true);
    } catch (e) {
      toast({
        title: "Couldn't translate",
        description: (e as Error).message,
        tone: "error",
        action: {
          label: "Settings",
          onClick: () => {
            player.closeSheet();
            router.push("/settings");
          },
        },
      });
    }
  };

  const nudge = (delta: number) => player.setLyricsOffset(lyricsOffset + delta);
  const offsetLabel = lyricsOffset === 0 ? "In sync" : `${lyricsOffset > 0 ? "+" : ""}${lyricsOffset.toFixed(1)}s`;

  return (
    <Popover
      label="Lyrics options"
      width={320}
      trigger={(props) => (
        <HeaderButton label="Lyrics options" active={(showTranslations && translationCount > 0) || lyricsOffset !== 0} {...props}>
          <Languages size={18} strokeWidth={2} />
        </HeaderButton>
      )}
    >
      {() => (
        <>
          {translationCount > 0 && (
            <MenuRow
              title="Translation"
              hint="English under non-English lines"
              control={<Switch label="Translation" checked={showTranslations} onChange={setShowTranslations} />}
            />
          )}
          {romanizationCount > 0 && (
            <MenuRow
              title="Pronunciation"
              hint="Lines in English letters, to sing along"
              control={<Switch label="Pronunciation" checked={showRomanizations} onChange={setShowRomanizations} />}
            />
          )}
          {detail.translations !== null && translationCount === 0 && !canTranslate && (
            <p className="px-3 py-2.5 text-[13px] text-subtle">This song is entirely in English.</p>
          )}
          {canTranslate && (
            <div className="px-3 py-2.5">
              <button
                type="button"
                disabled={translating}
                onClick={translate}
                className="pressable flex h-9 w-full items-center justify-center gap-2 rounded-full bg-white/10 text-[13px] font-semibold hover:bg-white/15 disabled:opacity-70"
              >
                {translating ? (
                  <span className="spin size-3.5 rounded-full border-2 border-white/25 border-t-white" />
                ) : (
                  <Languages size={15} strokeWidth={2} />
                )}
                {translating
                  ? "Translating…"
                  : detail.translations === null
                    ? "Translate lyrics"
                    : "Add pronunciation"}
              </button>
            </div>
          )}

          <div className="mx-3 my-1 h-px bg-white/[0.07]" />

          <div className="px-3 pt-2 pb-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">Lyrics timing</p>
                <p className="text-[12px] text-subtle">If lines feel early or late</p>
              </div>
              {lyricsOffset !== 0 && (
                <button
                  type="button"
                  aria-label="Reset timing"
                  title="Reset"
                  onClick={() => player.setLyricsOffset(0)}
                  className="pressable grid size-8 place-items-center rounded-full text-subtle hover:bg-white/10 hover:text-fg"
                >
                  <RotateCcw size={14} strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => nudge(-0.1)}
                className="pressable flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 text-[13px] font-medium hover:bg-white/15"
              >
                <Minus size={14} strokeWidth={2.25} /> Later
              </button>
              <span className="w-16 text-center text-[13px] font-semibold tabular-nums" aria-live="polite">
                {offsetLabel}
              </span>
              <button
                type="button"
                onClick={() => nudge(0.1)}
                className="pressable flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 text-[13px] font-medium hover:bg-white/15"
              >
                <Plus size={14} strokeWidth={2.25} /> Earlier
              </button>
            </div>
            <p className="mt-2 text-[12px] text-subtle">Saved for this song. Shortcuts: [ and ].</p>
          </div>
        </>
      )}
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// Up next
// ---------------------------------------------------------------------------

export function QueueMenu() {
  const state = usePlayer();
  const library = useStore(libraryStore).songs;
  const { songs, index } = queuePosition(state, library);
  const upNext = index >= 0 ? songs.slice(index + 1) : [];

  return (
    <Popover
      label="Up next"
      width={340}
      trigger={(props) => (
        <HeaderButton label="Up next" {...props}>
          <ListMusic size={18} strokeWidth={2} />
        </HeaderButton>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-baseline justify-between px-3 pt-1.5 pb-2">
            <p className="text-[13px] font-semibold text-muted">Up next</p>
            <p className="text-[12px] text-subtle">{state.queue ? "From this collection" : "From your library"}</p>
          </div>
          {upNext.length === 0 ? (
            <p className="px-3 pt-2 pb-4 text-[13px] text-subtle">Nothing after this song.</p>
          ) : (
            <ul className="max-h-[min(60vh,420px)] overflow-y-auto">
              {upNext.map((song) => {
                const art = artworkUrl(song);
                return (
                  <li key={song.videoId}>
                    <button
                      type="button"
                      onClick={() => {
                        player.play(song, { queue: state.queue });
                        close();
                      }}
                      className="flex w-full items-center gap-3 rounded-[12px] p-2 text-left transition-colors duration-150 hover:bg-white/[0.06]"
                    >
                      <img
                        src={art}
                        alt=""
                        width={40}
                        height={40}
                        loading="lazy"
                        crossOrigin={imageCors(art)}
                        className="image-outline size-10 shrink-0 rounded-[6px] object-cover"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <span className="truncate text-[14px] font-medium">{song.title}</span>
                          {song.explicit && <ExplicitBadge />}
                        </span>
                        <span className="block truncate text-[12px] text-muted">{song.artist}</span>
                      </span>
                      <span className="shrink-0 pr-1 text-[12px] text-subtle tabular-nums">{formatTime(song.duration)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </Popover>
  );
}
