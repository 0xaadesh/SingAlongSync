"use client";

import { Languages, ListMusic, Mic2, Minus, Plus, RotateCcw, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { artworkUrl, imageCors, translateSong, type SongDetail } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { libraryStore } from "@/lib/library";
import { PITCH_RANGE, player, queuePosition, usePlayer } from "@/lib/player";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import {
  initShowChords,
  initShowRomanizations,
  initShowSongFacts,
  openLyricsDialog,
  initShowTranslations,
  romanizedFirstStore,
  setRomanizedFirst,
  setShowChords,
  setShowRomanizations,
  setShowSongFacts,
  setShowTranslations,
  showChordsStore,
  showRomanizationsStore,
  showSongFactsStore,
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
      className={`pressable relative grid size-9 place-items-center rounded-full sm:size-10 ${
        active ? "bg-white text-black hover:bg-white/85" : "bg-white/10 text-white/90 hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}

/** Icon over a label, for the player's bottom bar on phones and tablets. */
export function BarButton({
  label,
  active,
  children,
  ...props
}: { label: string; active?: boolean; children: ReactNode } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`pressable flex h-14 w-full flex-col items-center justify-center gap-1 rounded-[14px] text-[11px] font-medium transition-colors duration-150 ${
        active ? "text-white" : "text-white/55 hover:text-white/85"
      }`}
    >
      {children}
      <span className="relative">
        {label}
        {/* Marks a feature that's switched on */}
        {active && <span aria-hidden className="absolute -top-0.5 -right-2 size-1.5 rounded-full bg-accent" />}
      </span>
    </button>
  );
}

/** Where a menu's trigger lives: the desktop header, or the bottom bar below desktop width. */
export type MenuVariant = "header" | "bar";

function MenuTrigger({
  variant,
  label,
  barLabel,
  active,
  icon,
  ...props
}: {
  variant: MenuVariant;
  label: string;
  barLabel: string;
  active?: boolean;
  icon: ReactNode;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return variant === "bar" ? (
    <BarButton label={barLabel} aria-label={label} active={active} {...props}>
      {icon}
    </BarButton>
  ) : (
    <HeaderButton label={label} active={active} {...props}>
      {icon}
    </HeaderButton>
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

export function KaraokeMenu({ detail, variant = "header" }: { detail: SongDetail; variant?: MenuVariant }) {
  const { karaoke, vocalLevel, vocalsOnly, pitch } = usePlayer();
  const available = !!detail.stems;
  const pitchLabel = pitch === 0 ? "Original" : `${pitch > 0 ? "+" : ""}${pitch}`;

  return (
    <Popover
      label="Karaoke"
      width={300}
      className={variant === "bar" ? "flex-1" : ""}
      trigger={(props) => (
        <MenuTrigger
          variant={variant}
          label="Karaoke"
          barLabel="Karaoke"
          active={((karaoke || vocalsOnly) && available) || pitch !== 0}
          icon={<Mic2 size={variant === "bar" ? 20 : 18} strokeWidth={2} />}
          {...props}
        />
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
          {available && (
            <MenuRow
              title="Vocals only"
              hint="Plays just the singer, without the music."
              control={<Switch label="Vocals only" checked={vocalsOnly} onChange={(on) => player.setVocalsOnly(on)} />}
            />
          )}

          <div className="mx-3 my-1 h-px bg-white/[0.07]" />

          <div className="px-3 pt-2 pb-2.5">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-[14px] font-medium">Pitch</p>
                <p className="text-[12px] text-subtle">
                  {detail.analysis ? `Key ${detail.analysis.key} · chords follow` : "Move the song to suit your voice"}
                </p>
              </div>
              {pitch !== 0 && (
                <button
                  type="button"
                  aria-label="Reset pitch"
                  title="Reset"
                  onClick={() => player.setPitch(0)}
                  className="pressable grid size-8 place-items-center rounded-full text-subtle hover:bg-white/10 hover:text-fg"
                >
                  <RotateCcw size={14} strokeWidth={2} />
                </button>
              )}
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <button
                type="button"
                aria-label="Lower by a semitone"
                disabled={pitch <= -PITCH_RANGE}
                onClick={() => player.setPitch(pitch - 1)}
                className="pressable flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 text-[13px] font-medium hover:bg-white/15 disabled:opacity-40"
              >
                <Minus size={14} strokeWidth={2.25} /> Lower
              </button>
              <span className="w-16 text-center text-[13px] font-semibold tabular-nums" aria-live="polite">
                {pitchLabel}
              </span>
              <button
                type="button"
                aria-label="Raise by a semitone"
                disabled={pitch >= PITCH_RANGE}
                onClick={() => player.setPitch(pitch + 1)}
                className="pressable flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full bg-white/10 text-[13px] font-medium hover:bg-white/15 disabled:opacity-40"
              >
                <Plus size={14} strokeWidth={2.25} /> Higher
              </button>
            </div>
            <p className="mt-2 text-[12px] text-subtle">In semitones, saved for this song.</p>
          </div>
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

export function LyricsMenu({ detail, variant = "header" }: { detail: SongDetail; variant?: MenuVariant }) {
  const { lyricsOffset } = usePlayer();
  const showTranslations = useStore(showTranslationsStore);
  const showRomanizations = useStore(showRomanizationsStore);
  const romanizedFirst = useStore(romanizedFirstStore);
  const showChords = useStore(showChordsStore);
  const showSongFacts = useStore(showSongFactsStore);
  const hasSongFacts = detail.analysisStatus === "pending" || detail.analysisStatus === "ready";
  const chordCount = detail.analysis?.chords.length ?? 0;
  const [translating, setTranslating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    initShowTranslations();
    initShowRomanizations();
    initShowChords();
    initShowSongFacts();
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
      className={variant === "bar" ? "flex-1" : ""}
      trigger={(props) => (
        <MenuTrigger
          variant={variant}
          label="Lyrics options"
          barLabel="Options"
          active={(showTranslations && translationCount > 0) || lyricsOffset !== 0}
          icon={<Languages size={variant === "bar" ? 20 : 18} strokeWidth={2} />}
          {...props}
        />
      )}
    >
      {(close) => (
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
          {chordCount > 0 && (
            <MenuRow
              title="Chords"
              hint={`Above the lyrics · key ${detail.analysis?.key}`}
              control={<Switch label="Chords" checked={showChords} onChange={setShowChords} />}
            />
          )}
          {hasSongFacts && (
            <MenuRow
              title="Key & chord readout"
              hint="Under the cover"
              control={<Switch label="Key & chord readout" checked={showSongFacts} onChange={setShowSongFacts} />}
            />
          )}
          {romanizationCount > 0 && showRomanizations && (
            <MenuRow
              title="Romanised first"
              hint="Big line in English letters, original script below"
              control={<Switch label="Romanised first" checked={romanizedFirst} onChange={setRomanizedFirst} />}
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

          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={() => {
                close();
                openLyricsDialog({
                  videoId: detail.videoId,
                  title: detail.title,
                  artist: detail.artist,
                  artists: detail.artists,
                  duration: detail.duration,
                });
              }}
              className="pressable flex h-9 w-full items-center justify-center gap-2 rounded-full bg-white/10 text-[13px] font-medium hover:bg-white/15"
            >
              <Search size={14} strokeWidth={2.25} />
              Find different lyrics
            </button>
          </div>

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

export function QueueMenu({ variant = "header" }: { variant?: MenuVariant }) {
  const state = usePlayer();
  const library = useStore(libraryStore).songs;
  const { songs, index } = queuePosition(state, library);
  const upNext = index >= 0 ? songs.slice(index + 1) : [];

  return (
    <Popover
      label="Up next"
      width={340}
      className={variant === "bar" ? "flex-1" : ""}
      trigger={(props) => (
        <MenuTrigger
          variant={variant}
          label="Up next"
          barLabel="Up next"
          icon={<ListMusic size={variant === "bar" ? 20 : 18} strokeWidth={2} />}
          {...props}
        />
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
