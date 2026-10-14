"use client";

import { Check, FileUp, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { countLrcLines, searchLrclib, setSongLyrics, type LrclibResult } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { trackJob } from "@/lib/jobs";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { closeLyricsDialog, lyricsDialogStore, type LyricsTarget } from "@/lib/ui";
import { Tabs } from "@/components/ui/tabs";

type Source = "search" | "paste" | "file";

const TABS = [
  { id: "search", label: "Search LRCLIB" },
  { id: "paste", label: "Paste" },
  { id: "file", label: "File" },
];

const secondaryButton = "pressable h-9 rounded-full bg-white/10 px-4 text-[14px] font-medium hover:bg-white/15";
const primaryButton =
  "pressable flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40";

/**
 * Pick lyrics for a song: search LRCLIB and choose a result, paste LRC text, or open
 * an .lrc file. The server then re-aligns the song in the background.
 */
export function LyricsDialog() {
  const song = useStore(lyricsDialogStore);
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Last song shown, kept while the dialog animates closed
  const [current, setCurrent] = useState<LyricsTarget | null>(null);
  const [session, setSession] = useState(0);

  useEffect(() => {
    const dialog = dialogRef.current!;
    if (song && !dialog.open) {
      setCurrent(song);
      setSession((n) => n + 1);
      dialog.showModal();
    } else if (!song && dialog.open) {
      dialog.close();
    }
  }, [song]);

  return (
    <dialog
      ref={dialogRef}
      aria-label="Find lyrics"
      onCancel={(e) => {
        e.preventDefault();
        closeLyricsDialog();
      }}
      onClick={(e) => e.target === e.currentTarget && closeLyricsDialog()}
      className="app-dialog m-auto w-[calc(100%-2rem)] max-w-[560px] rounded-[24px] bg-surface-2 p-0 text-fg shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_24px_64px_-12px_rgb(0_0_0/0.8)]"
    >
      {current && <LyricsPicker key={session} song={current} />}
    </dialog>
  );
}

/** Same rule as the server's automatic match: within 2 seconds of the song's length. */
function durationMatches(lrclib: number, song: number) {
  return Math.abs(lrclib - song) <= 2;
}

function LyricsPicker({ song }: { song: LyricsTarget }) {
  const [source, setSource] = useState<Source>("search");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (body: { lrclibId: number } | { lrc: string }) => {
    setSubmitting(true);
    setError(null);
    try {
      const { job } = await setSongLyrics(song.videoId, body);
      // The player shows this job's progress in place of the old lyrics
      trackJob(job);
      closeLyricsDialog();
      toast({ title: "Syncing the new lyrics", description: "Follow the progress in the player. About a minute." });
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="p-5">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-semibold">Find lyrics</h2>
          <p className="mt-0.5 truncate text-[14px] text-muted">
            {song.title} · {song.artist}
          </p>
        </div>
        <button
          type="button"
          aria-label="Close"
          onClick={closeLyricsDialog}
          className="pressable -mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-fg"
        >
          <X size={18} strokeWidth={2} />
        </button>
      </div>

      <div className="mt-4">
        <Tabs tabs={TABS} value={source} onChange={(id) => setSource(id as Source)} label="Lyrics source" idPrefix="lyrics" />
      </div>

      <div role="tabpanel" id={`lyrics-panel-${source}`} aria-labelledby={`lyrics-tab-${source}`} className="mt-4">
        {source === "search" && <SearchSource song={song} submitting={submitting} onUse={(id) => submit({ lrclibId: id })} />}
        {source === "paste" && <PasteSource submitting={submitting} onUse={(lrc) => submit({ lrc })} />}
        {source === "file" && <FileSource submitting={submitting} onUse={(lrc) => submit({ lrc })} />}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

function Footer({ hint, children }: { hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-5 flex items-center gap-2">
      <p className="mr-auto text-[12px] text-subtle text-pretty">{hint}</p>
      <button type="button" onClick={closeLyricsDialog} className={secondaryButton}>
        Cancel
      </button>
      {children}
    </div>
  );
}

const Spinner = () => <span className="spin size-3.5 rounded-full border-2 border-white/40 border-t-white" />;

// ---------------------------------------------------------------------------

function SearchSource({
  song,
  submitting,
  onUse,
}: {
  song: LyricsTarget;
  submitting: boolean;
  onUse: (lrclibId: number) => void;
}) {
  const [query, setQuery] = useState(`${song.title.replace(/\s*[(\[].*?[)\]]/g, "")} ${song.artists[0] ?? ""}`.trim());
  const [results, setResults] = useState<LrclibResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);

  // Debounced search; stale requests are aborted.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchLrclib(q, controller.signal)
        .then((r) => {
          setResults(r);
          setError(null);
          // Preselect the first synced result whose length matches the song
          const best = r.find((x) => x.synced && x.duration != null && durationMatches(x.duration, song.duration));
          setSelected(best?.id ?? null);
        })
        .catch((e: Error) => !controller.signal.aborted && setError(e.message))
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, song.duration]);

  return (
    <>
      <div className="flex h-11 items-center gap-2.5 rounded-[14px] bg-bg px-3.5 shadow-[0_0_0_1px_rgb(255_255_255/0.1)] transition-shadow duration-150 focus-within:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_0_0_4px_rgb(250_45_72/0.25)]">
        <input
          type="text"
          autoFocus
          aria-label="Search LRCLIB"
          placeholder="Song title and artist"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
        />
        {loading && <span aria-hidden className="spin size-4 shrink-0 rounded-full border-2 border-white/15 border-t-white/70" />}
      </div>

      <div className="-mx-2 mt-3 h-[min(48vh,360px)] overflow-y-auto">
        {error ? (
          <p className="px-2 py-8 text-center text-[13px] text-danger">{error}</p>
        ) : results === null ? (
          <p className="px-2 py-8 text-center text-[13px] text-subtle">{loading ? "Searching…" : "Type to search LRCLIB."}</p>
        ) : results.length === 0 ? (
          <p className="px-2 py-8 text-center text-[13px] text-muted">No lyrics found. Try a shorter search, or paste them.</p>
        ) : (
          <ul role="radiogroup" aria-label="LRCLIB results">
            {results.map((r) => {
              const isSelected = r.id === selected;
              const diff = r.duration != null ? Math.round(r.duration - song.duration) : null;
              const close = r.duration != null && durationMatches(r.duration, song.duration);
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    disabled={!r.synced}
                    onClick={() => setSelected(r.id)}
                    className={`w-full rounded-[12px] px-2.5 py-2.5 text-left transition-colors duration-100 disabled:cursor-default disabled:opacity-45 ${
                      isSelected ? "bg-white/[0.08] shadow-[inset_0_0_0_1.5px_var(--color-accent)]" : "hover:bg-white/[0.05]"
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-medium">{r.trackName}</span>
                        <span className="block truncate text-[12px] text-muted">
                          {[r.artistName, r.albumName].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      {!r.synced ? (
                        <span className="shrink-0 text-[11px] text-subtle">{r.instrumental ? "Instrumental" : "Not synced"}</span>
                      ) : (
                        r.duration != null && (
                          <span className={`shrink-0 text-[12px] tabular-nums ${close ? "text-success" : "text-subtle"}`}>
                            {formatTime(r.duration)}
                            {diff !== null && diff !== 0 && ` (${diff > 0 ? "+" : ""}${diff}s)`}
                          </span>
                        )
                      )}
                      {isSelected && <Check size={16} strokeWidth={2.5} className="shrink-0 text-accent" aria-hidden />}
                    </span>
                    {isSelected && r.preview.length > 0 && (
                      <span className="enter-up mt-2 block border-l-2 border-white/15 pl-2.5 text-[12px] leading-relaxed text-muted italic">
                        {r.preview.map((line, i) => (
                          <span key={i} className="block truncate">
                            {line}
                          </span>
                        ))}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <Footer hint="Green durations match the song within 2 seconds.">
        <button
          type="button"
          disabled={selected === null || submitting}
          onClick={() => selected !== null && onUse(selected)}
          className={primaryButton}
        >
          {submitting && <Spinner />}
          Use these lyrics
        </button>
      </Footer>
    </>
  );
}

// ---------------------------------------------------------------------------

function PasteSource({ submitting, onUse }: { submitting: boolean; onUse: (lrc: string) => void }) {
  const [text, setText] = useState("");
  const lines = countLrcLines(text);

  return (
    <>
      <textarea
        autoFocus
        spellCheck={false}
        aria-label="LRC lyrics"
        placeholder={"[00:12.34] First line of the song\n[00:15.80] Second line…"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="h-[min(48vh,360px)] w-full resize-none rounded-[14px] bg-bg p-3.5 font-mono text-[12.5px] leading-relaxed shadow-[0_0_0_1px_rgb(255_255_255/0.1)] outline-none placeholder:text-subtle focus:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_0_0_4px_rgb(250_45_72/0.25)]"
      />
      <Footer
        hint={
          text.trim()
            ? lines
              ? `${lines} timed lines`
              : "No timed lines yet. Each line needs a [mm:ss.xx] timestamp."
            : "Paste synced lyrics in LRC format."
        }
      >
        <button type="button" disabled={!lines || submitting} onClick={() => onUse(text)} className={primaryButton}>
          {submitting && <Spinner />}
          Use these lyrics
        </button>
      </Footer>
    </>
  );
}

// ---------------------------------------------------------------------------

function FileSource({ submitting, onUse }: { submitting: boolean; onUse: (lrc: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const lines = file ? countLrcLines(file.text) : 0;
  const preview = file
    ? file.text
        .split(/\r?\n/)
        .filter((l) => /^\s*\[\d+:\d+/.test(l))
        .slice(0, 4)
    : [];

  const read = async (f: File | undefined) => {
    if (!f) return;
    setFile({ name: f.name, text: await f.text() });
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    read(e.dataTransfer.files[0]);
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".lrc,.txt,text/plain"
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => read(e.target.files?.[0])}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        data-dragging={dragging}
        className="flex h-[min(48vh,360px)] w-full flex-col items-center justify-center gap-3 rounded-[14px] bg-bg p-6 text-center shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.12)] transition-[background-color,box-shadow] duration-150 hover:bg-white/[0.03] data-[dragging=true]:bg-accent/10 data-[dragging=true]:shadow-[inset_0_0_0_1.5px_var(--color-accent)]"
      >
        {file ? (
          <>
            <span className="font-mono text-[13px] text-fg">{file.name}</span>
            <span className={`text-[13px] ${lines ? "text-success" : "text-danger"}`}>
              {lines ? `${lines} timed lines` : "No timed lines found in this file"}
            </span>
            {preview.length > 0 && (
              <span className="max-w-full text-left font-mono text-[12px] leading-relaxed text-muted">
                {preview.map((l, i) => (
                  <span key={i} className="block truncate">
                    {l}
                  </span>
                ))}
              </span>
            )}
            <span className="text-[12px] text-subtle">Click to choose a different file</span>
          </>
        ) : (
          <>
            <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.06] text-muted">
              <FileUp size={22} strokeWidth={2} />
            </span>
            <span className="text-[14px] font-medium">Choose an .lrc file</span>
            <span className="text-[12px] text-subtle">or drop it here</span>
          </>
        )}
      </button>
      <Footer>
        <button type="button" disabled={!lines || submitting} onClick={() => file && onUse(file.text)} className={primaryButton}>
          {submitting && <Spinner />}
          Use these lyrics
        </button>
      </Footer>
    </>
  );
}
