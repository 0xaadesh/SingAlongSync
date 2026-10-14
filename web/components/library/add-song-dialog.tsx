"use client";

import { Check, ListMusic, Minus, Play, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  artworkUrl,
  createJobsBatch,
  fetchPlaylist,
  imageCors,
  parsePlaylistId,
  parseYouTubeId,
  searchSongs,
  watchUrl,
  type Job,
  type PlaylistInfo,
  type PlaylistTrack,
  type SearchResult,
} from "@/lib/api";
import { formatTime } from "@/lib/format";
import { ExplicitBadge } from "@/components/ui/explicit-badge";
import { jobsStore, removeJob, submitJob } from "@/lib/jobs";
import { libraryStore } from "@/lib/library";
import { player } from "@/lib/player";
import { useStore } from "@/lib/store";
import { addDialogStore, closeAddDialog, trackedJobStore } from "@/lib/ui";
import { Elapsed, JobRow, JobSteps, isActiveJob, jobThumb, playJob, retryJob, statusLine } from "./jobs";

type Phase =
  | { kind: "form" }
  | { kind: "job"; id: string }
  | { kind: "exists"; videoId: string }
  | { kind: "playlist"; url: string }
  | { kind: "batch"; ids: string[]; title: string };

/**
 * Add a song: search YouTube Music or paste a link, then the same dialog follows
 * the job step by step.
 * Closing it never stops the job; it keeps going under Downloads.
 */
export function AddSongDialog() {
  const state = useStore(addDialogStore);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [prefill, setPrefill] = useState<string | undefined>();
  // Bumped on every open so the form starts fresh each time.
  const [session, setSession] = useState(0);

  // Sync the native dialog with the store and pick the starting phase.
  useEffect(() => {
    const dialog = dialogRef.current!;
    if (state.open && !dialog.open) {
      setPhase(state.jobId ? { kind: "job", id: state.jobId } : { kind: "form" });
      setPrefill(state.url);
      setSession((n) => n + 1);
      dialog.showModal();
    } else if (state.open && dialog.open && state.jobId) {
      // A row in the album view was clicked: show that song's progress in place
      setPhase({ kind: "job", id: state.jobId });
    } else if (!state.open && dialog.open) {
      dialog.close();
    }
  }, [state]);

  // Tell the library not to toast about the job we're already showing.
  useEffect(() => {
    trackedJobStore.set(state.open && phase.kind === "job" ? phase.id : null);
  }, [state.open, phase]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="add-song-title"
      onCancel={(e) => {
        e.preventDefault();
        closeAddDialog();
      }}
      onClick={(e) => e.target === e.currentTarget && closeAddDialog()}
      className="app-dialog m-auto w-[calc(100%-2rem)] max-w-[520px] rounded-[24px] bg-surface-2 p-0 text-fg shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_24px_64px_-12px_rgb(0_0_0/0.8)]"
    >
      {/* Stays rendered while closing so the exit animation has content */}
      {session > 0 && (
        <div key={`${session}-${phase.kind}`} className="enter-up p-5">
          {phase.kind === "form" && (
            <AddForm
              prefill={prefill}
              onJob={(id) => setPhase({ kind: "job", id })}
              onExists={(videoId) => setPhase({ kind: "exists", videoId })}
              onPlaylist={(url) => setPhase({ kind: "playlist", url })}
            />
          )}
          {phase.kind === "job" && <JobView id={phase.id} onAddAnother={() => setPhase({ kind: "form" })} />}
          {phase.kind === "exists" && (
            <ExistsView videoId={phase.videoId} onAddAnother={() => setPhase({ kind: "form" })} />
          )}
          {phase.kind === "playlist" && (
            <PlaylistView
              url={phase.url}
              onBack={() => setPhase({ kind: "form" })}
              onQueued={(ids, title) => setPhase({ kind: "batch", ids, title })}
            />
          )}
          {phase.kind === "batch" && <BatchView ids={phase.ids} title={phase.title} />}
        </div>
      )}
    </dialog>
  );
}

function DialogHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="min-w-0 flex-1">
        <h2 id="add-song-title" className="text-[17px] font-semibold">
          {title}
        </h2>
        {description && <p className="mt-1 text-[14px] text-muted text-pretty">{description}</p>}
      </div>
      <button
        type="button"
        aria-label="Close"
        onClick={closeAddDialog}
        className="pressable -mt-1 -mr-1 grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-fg"
      >
        <X size={18} strokeWidth={2} />
      </button>
    </div>
  );
}

const secondaryButton =
  "pressable h-9 rounded-full bg-white/10 px-4 text-[14px] font-medium hover:bg-white/15";
const primaryButton =
  "pressable flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-hover disabled:pointer-events-none disabled:opacity-40";

// ---------------------------------------------------------------------------

function AddForm({
  prefill,
  onJob,
  onExists,
  onPlaylist,
}: {
  prefill?: string;
  onJob: (id: string) => void;
  onExists: (videoId: string) => void;
  onPlaylist: (url: string) => void;
}) {
  const [value, setValue] = useState(prefill ?? "");
  const [error, setError] = useState<string | null>(null);
  /** videoId being submitted (a result row or the pasted link) */
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  const autoSubmitted = useRef(false);
  const errorId = useId();
  const listId = useId();

  const query = value.trim();
  const linkId = parseYouTubeId(value);
  const playlistId = parsePlaylistId(value);
  const isSearch = !linkId && !playlistId && query.length >= 2;

  // Search YouTube Music as you type (debounced; stale requests are aborted).
  useEffect(() => {
    if (!isSearch) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const controller = new AbortController();
    const timer = setTimeout(() => {
      searchSongs(query, controller.signal)
        .then((r) => {
          setResults(r);
          setActive(0);
          setError(null);
        })
        .catch((e: Error) => !controller.signal.aborted && setError(e.message))
        .finally(() => !controller.signal.aborted && setLoading(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, isSearch]);

  const submit = async (url: string, videoId: string) => {
    if (submitting) return;
    setSubmitting(videoId);
    setError(null);
    try {
      const result = await submitJob(url);
      if (result.exists) onExists(result.videoId);
      else onJob(result.videoId);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(null);
    }
  };

  const pick = (r: SearchResult) => (r.inLibrary ? onExists(r.videoId) : submit(watchUrl(r.videoId), r.videoId));

  // A link pasted into the library search arrives prefilled: go straight to processing.
  useEffect(() => {
    const id = prefill ? parseYouTubeId(prefill) : null;
    if (prefill && !autoSubmitted.current) {
      autoSubmitted.current = true;
      if (id) submit(prefill, id);
      else if (parsePlaylistId(prefill)) onPlaylist(prefill.trim());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (linkId) submit(value, linkId);
    else if (playlistId) onPlaylist(value.trim());
    else if (results?.[active]) pick(results[active]);
  };

  const move = (delta: number) => {
    if (!results?.length) return;
    const next = (active + delta + results.length) % results.length;
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  const showResults = isSearch && (results !== null || loading);

  return (
    <form onSubmit={onSubmit} noValidate>
      <DialogHeader title="Add a song" description="Search YouTube Music, or paste a song, album or playlist link." />

      <div className="mt-5 flex h-12 items-center gap-3 rounded-[14px] bg-bg px-3.5 shadow-[0_0_0_1px_rgb(255_255_255/0.1)] transition-shadow duration-150 focus-within:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_0_0_4px_rgb(250_45_72/0.25)]">
        {linkId ? (
          <img
            src={`https://i.ytimg.com/vi/${linkId}/mqdefault.jpg`}
            alt=""
            width={28}
            height={28}
            className="image-outline enter-up size-7 shrink-0 rounded-[6px] object-cover"
          />
        ) : playlistId ? (
          <ListMusic size={18} strokeWidth={2} className="enter-up shrink-0 text-accent" aria-hidden />
        ) : (
          <Search size={18} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
        )}
        <input
          type="text"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          role="combobox"
          aria-label="Search songs or paste a YouTube Music link"
          aria-expanded={showResults}
          aria-controls={listId}
          aria-activedescendant={results?.[active] ? `${listId}-${active}` : undefined}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          placeholder="Search songs or paste a link"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              move(1);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              move(-1);
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-subtle"
        />
        {loading && <span aria-hidden className="spin size-4 shrink-0 rounded-full border-2 border-white/15 border-t-white/70" />}
      </div>

      <p id={errorId} role="alert" className={error ? "mt-2 text-[13px] text-danger" : "sr-only"}>
        {error}
      </p>

      {showResults && (
        <div className="-mx-2 mt-3">
          {results === null ? (
            <ResultSkeleton />
          ) : results.length === 0 ? (
            <p className="px-2 py-8 text-center text-[14px] text-muted">No songs found for “{query}”.</p>
          ) : (
            <ul
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label="Search results"
              className="max-h-[min(50vh,360px)] overflow-y-auto"
            >
              {results.map((r, i) => (
                <li key={r.videoId} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={() => pick(r)}
                    onPointerMove={() => i !== active && setActive(i)}
                    disabled={!!submitting}
                    className={`flex w-full items-center gap-3 rounded-[12px] p-2 text-left transition-colors duration-100 disabled:cursor-default ${
                      i === active ? "bg-white/[0.07]" : ""
                    }`}
                  >
                    <img
                      src={r.thumbnail ?? `https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`}
                      alt=""
                      width={44}
                      height={44}
                      loading="lazy"
                      decoding="async"
                      className="image-outline size-11 shrink-0 rounded-[6px] object-cover"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium">{r.title}</span>
                        {r.explicit && <ExplicitBadge />}
                      </span>
                      <span className="block truncate text-[13px] text-muted">
                        {[r.artist, r.album].filter(Boolean).join(" · ")}
                      </span>
                    </span>
                    {submitting === r.videoId ? (
                      <span aria-label="Adding" className="spin size-4 shrink-0 rounded-full border-2 border-white/15 border-t-white/70" />
                    ) : r.inLibrary ? (
                      <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                        In library
                      </span>
                    ) : (
                      r.duration != null && (
                        <span className="shrink-0 pr-1 text-[13px] text-subtle tabular-nums">{formatTime(r.duration)}</span>
                      )
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {!showResults && (
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={closeAddDialog} className={secondaryButton}>
            Cancel
          </button>
          <button type="submit" disabled={(!linkId && !playlistId) || !!submitting} className={primaryButton}>
            {submitting && <span className="spin size-3.5 rounded-full border-2 border-white/40 border-t-white" />}
            {playlistId ? "Show songs" : "Add song"}
          </button>
        </div>
      )}
    </form>
  );
}

function ResultSkeleton() {
  return (
    <div aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-center gap-3 p-2">
          <div className="skeleton size-11 shrink-0 rounded-[6px]" style={{ animationDelay: `${i * 80}ms` }} />
          <div className="flex-1">
            <div className="skeleton h-3.5 w-2/3 rounded" style={{ animationDelay: `${i * 80}ms` }} />
            <div className="skeleton mt-2 h-3 w-1/3 rounded" style={{ animationDelay: `${i * 80}ms` }} />
          </div>
        </div>
      ))}
    </div>
  );
}


// ---------------------------------------------------------------------------

function JobView({ id, onAddAnother }: { id: string; onAddAnother: () => void }) {
  const { jobs } = useStore(jobsStore);
  const job = jobs.find((j) => j.id === id);

  if (!job) {
    return (
      <>
        <DialogHeader title="Song not found" description="This download was dismissed or the server restarted." />
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onAddAnother} className={primaryButton}>
            Add a song
          </button>
        </div>
      </>
    );
  }

  const title =
    job.state === "done"
      ? job.noLyrics
        ? "Ready, without lyrics"
        : "Ready to sing"
      : job.state === "failed"
        ? "Couldn't add this song"
        : job.state === "cancelled"
          ? "Cancelled"
          : "Adding song";

  return (
    <>
      <DialogHeader title={title} />
      <JobHeader job={job} />
      <div className="mt-5 px-0.5">
        <JobSteps job={job} />
      </div>
      <JobFooter job={job} onAddAnother={onAddAnother} />
    </>
  );
}

function JobHeader({ job }: { job: Job }) {
  const thumb = jobThumb(job);
  return (
    <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-white/[0.04] p-2.5">
      <img
        src={thumb}
        alt=""
        width={52}
        height={52}
        decoding="async"
        crossOrigin={imageCors(thumb)}
        className="image-outline size-13 shrink-0 rounded-md object-cover"
      />
      <div className="min-w-0 flex-1">
        {job.title ? (
          <>
            <p className="truncate text-[15px] font-semibold">{job.title}</p>
            <p className="truncate text-[13px] text-muted">{job.artist}</p>
          </>
        ) : isActiveJob(job) ? (
          <>
            <div className="skeleton h-4 w-40 max-w-full rounded" />
            <div className="skeleton mt-2 h-3 w-24 rounded" />
          </>
        ) : (
          <p className="truncate text-[15px] font-semibold text-muted">Unknown song</p>
        )}
      </div>
      <span className="shrink-0 pr-1 text-[13px] text-subtle">
        {job.state === "queued" ? statusLine(job) : <Elapsed job={job} />}
      </span>
    </div>
  );
}

function JobFooter({ job, onAddAnother }: { job: Job; onAddAnother: () => void }) {
  if (isActiveJob(job)) {
    return (
      <div className="mt-6 flex items-center gap-2">
        <p className="mr-auto text-[12px] text-subtle text-pretty">You can close this. It keeps going in Downloads.</p>
        <button type="button" onClick={() => removeJob(job.id).catch(() => {})} className={secondaryButton}>
          Stop
        </button>
        <button
          type="button"
          onClick={closeAddDialog}
          className="pressable h-9 rounded-full bg-white px-4 text-[14px] font-semibold text-black hover:bg-white/85"
        >
          Done
        </button>
      </div>
    );
  }

  return (
    <div className="mt-6 flex justify-end gap-2">
      {job.state === "done" ? (
        <>
          <button type="button" onClick={onAddAnother} className={secondaryButton}>
            Add another
          </button>
          <button type="button" autoFocus onClick={() => playJob(job)} className={primaryButton}>
            <Play size={14} fill="currentColor" strokeWidth={0} />
            Play now
          </button>
        </>
      ) : (
        <>
          <button type="button" onClick={closeAddDialog} className={secondaryButton}>
            Close
          </button>
          <button type="button" onClick={() => retryJob(job)} className={primaryButton}>
            Try again
          </button>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ExistsView({ videoId, onAddAnother }: { videoId: string; onAddAnother: () => void }) {
  const { songs } = useStore(libraryStore);
  const song = songs.find((s) => s.videoId === videoId);
  const art = song ? artworkUrl(song) : `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

  return (
    <>
      <DialogHeader title="Already in your library" />
      <div className="mt-4 flex items-center gap-3 rounded-[16px] bg-white/[0.04] p-2.5">
        <img
          src={art}
          alt=""
          width={52}
          height={52}
          crossOrigin={imageCors(art)}
          className="image-outline size-13 shrink-0 rounded-md object-cover"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{song?.title ?? "This song"}</p>
          {song && <p className="truncate text-[13px] text-muted">{song.artist}</p>}
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onAddAnother} className={secondaryButton}>
          Add another
        </button>
        {song && (
          <button
            type="button"
            autoFocus
            onClick={() => {
              closeAddDialog();
              player.play(song);
            }}
            className={primaryButton}
          >
            <Play size={14} fill="currentColor" strokeWidth={0} />
            Play
          </button>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Albums and playlists
// ---------------------------------------------------------------------------

function Checkbox({ checked, indeterminate = false }: { checked: boolean; indeterminate?: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-[18px] shrink-0 place-items-center rounded-[5px] transition-colors duration-150 ${
        checked || indeterminate ? "bg-accent text-white" : "shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.3)]"
      }`}
    >
      {indeterminate ? <Minus size={12} strokeWidth={3} /> : checked && <Check size={12} strokeWidth={3} />}
    </span>
  );
}

function PlaylistView({
  url,
  onQueued,
  onBack,
}: {
  url: string;
  onQueued: (ids: string[], title: string) => void;
  onBack: () => void;
}) {
  const [info, setInfo] = useState<PlaylistInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchPlaylist(url)
      .then((data) => {
        if (cancelled) return;
        setInfo(data);
        // Everything that can be added starts selected
        setSelected(new Set(data.tracks.filter(canAdd).map((t) => t.videoId)));
      })
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [url]);

  const addable = info?.tracks.filter(canAdd) ?? [];
  const allSelected = addable.length > 0 && addable.every((t) => selected.has(t.videoId));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async () => {
    if (!info || !selected.size) return;
    setSubmitting(true);
    setError(null);
    try {
      const tracks = info.tracks
        .filter((t) => selected.has(t.videoId))
        .map((t) => ({ videoId: t.videoId, title: t.title, artist: t.artist }));
      const result = await createJobsBatch(tracks);
      onQueued(result.queued, info.title);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  if (error && !info) {
    return (
      <>
        <DialogHeader title="Couldn't load that link" description={error} />
        <div className="mt-6 flex justify-end">
          <button type="button" onClick={onBack} className={secondaryButton}>
            Back
          </button>
        </div>
      </>
    );
  }

  if (!info) {
    return (
      <>
        <DialogHeader title="Loading…" />
        <div className="mt-4 flex items-center gap-3" aria-hidden>
          <div className="skeleton size-16 rounded-[10px]" />
          <div className="flex-1">
            <div className="skeleton h-4 w-2/3 rounded" />
            <div className="skeleton mt-2 h-3 w-1/3 rounded" />
          </div>
        </div>
        <ResultSkeleton />
      </>
    );
  }

  const meta = [info.kind === "album" ? "Album" : "Playlist", info.artist, info.year, `${info.tracks.length} songs`]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <DialogHeader title={info.kind === "album" ? "Add album" : "Add playlist"} />
      <div className="mt-4 flex items-center gap-3">
        {info.cover ? (
          <img
            src={info.cover}
            alt=""
            width={64}
            height={64}
            className="image-outline size-16 shrink-0 rounded-[10px] object-cover"
          />
        ) : (
          <span className="grid size-16 shrink-0 place-items-center rounded-[10px] bg-white/[0.06] text-muted">
            <ListMusic size={24} strokeWidth={2} />
          </span>
        )}
        <div className="min-w-0">
          <p className="truncate text-[16px] font-semibold">{info.title}</p>
          <p className="truncate text-[13px] text-muted">{meta}</p>
        </div>
      </div>

      <div className="-mx-2 mt-4">
        <button
          type="button"
          disabled={!addable.length}
          onClick={() => setSelected(allSelected ? new Set() : new Set(addable.map((t) => t.videoId)))}
          className="flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left text-[13px] font-medium text-muted transition-colors duration-100 hover:bg-white/[0.05] disabled:opacity-50"
        >
          <Checkbox checked={allSelected} indeterminate={!allSelected && selected.size > 0} />
          {allSelected ? "Deselect all" : "Select all"}
        </button>
        <ul className="max-h-[min(45vh,340px)] overflow-y-auto" aria-label="Tracks">
          {info.tracks.map((track, i) => {
            const available = canAdd(track);
            const checked = selected.has(track.videoId);
            return (
              <li key={`${track.videoId}-${i}`}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={!available}
                  onClick={() => toggle(track.videoId)}
                  className="flex w-full items-center gap-3 rounded-[12px] px-2.5 py-2 text-left transition-colors duration-100 hover:bg-white/[0.05] disabled:cursor-default disabled:hover:bg-transparent"
                >
                  {available ? <Checkbox checked={checked} /> : <span className="size-[18px] shrink-0" />}
                  <span className="w-5 shrink-0 text-right text-[12px] text-subtle tabular-nums">{i + 1}</span>
                  <span className={`min-w-0 flex-1 ${available ? "" : "opacity-50"}`}>
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[14px] font-medium">{track.title}</span>
                      {track.explicit && <ExplicitBadge />}
                    </span>
                    <span className="block truncate text-[12px] text-muted">{track.artist}</span>
                  </span>
                  {track.inLibrary ? (
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                      In library
                    </span>
                  ) : track.queued ? (
                    <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-muted">
                      Queued
                    </span>
                  ) : !track.available ? (
                    <span className="shrink-0 text-[11px] text-subtle">Unavailable</span>
                  ) : (
                    track.duration != null && (
                      <span className="shrink-0 text-[12px] text-subtle tabular-nums">{formatTime(track.duration)}</span>
                    )
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {error && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-5 flex items-center gap-2">
        <p className="mr-auto text-[12px] text-subtle">Songs are processed one at a time.</p>
        <button type="button" onClick={onBack} className={secondaryButton}>
          Back
        </button>
        <button type="button" onClick={submit} disabled={!selected.size || submitting} className={primaryButton}>
          {submitting && <span className="spin size-3.5 rounded-full border-2 border-white/40 border-t-white" />}
          {selected.size ? `Add ${selected.size} ${selected.size === 1 ? "song" : "songs"}` : "Add songs"}
        </button>
      </div>
    </>
  );
}

const canAdd = (t: PlaylistTrack) => t.available && !t.inLibrary && !t.queued;

function BatchView({ ids, title }: { ids: string[]; title: string }) {
  const { jobs } = useStore(jobsStore);
  const batch = ids.map((id) => jobs.find((j) => j.id === id)).filter((j): j is Job => !!j);
  const done = batch.filter((j) => j.state === "done").length;

  return (
    <>
      <DialogHeader
        title={ids.length ? `Adding ${ids.length} ${ids.length === 1 ? "song" : "songs"}` : "Nothing to add"}
        description={ids.length ? title : "Every song from this link is already in your library or queued."}
      />
      {ids.length > 0 && (
        <>
          <p className="mt-3 text-[13px] text-muted tabular-nums" aria-live="polite">
            {done} of {ids.length} ready
          </p>
          <ul className="-mx-2.5 mt-2 max-h-[min(50vh,380px)] overflow-y-auto">
            {batch.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        </>
      )}
      <div className="mt-5 flex items-center gap-2">
        <p className="mr-auto text-[12px] text-subtle text-pretty">You can close this. Progress stays in Downloads.</p>
        <button
          type="button"
          onClick={closeAddDialog}
          className="pressable h-9 rounded-full bg-white px-4 text-[14px] font-semibold text-black hover:bg-white/85"
        >
          Done
        </button>
      </div>
    </>
  );
}
