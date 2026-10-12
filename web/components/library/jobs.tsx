"use client";

import { Check, Play, RotateCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { assetUrl, fetchSong, imageCors, type Job, type StepKey, type StepStatus } from "@/lib/api";
import { formatTime } from "@/lib/format";
import { removeJob, submitJob } from "@/lib/jobs";
import { player } from "@/lib/player";
import { toast } from "@/lib/toast";
import { closeAddDialog, openAddDialog } from "@/lib/ui";

export const STEP_LABELS: Record<StepKey, { title: string; long: string; detail: string }> = {
  download: { title: "Download", long: "Downloading audio", detail: "Fetching the track from YouTube" },
  lyrics: { title: "Lyrics", long: "Finding synced lyrics", detail: "Matching timed lyrics on LRCLIB" },
  separate: { title: "Vocals", long: "Isolating vocals", detail: "Splitting voice from music. Usually the longest step" },
  align: { title: "Word sync", long: "Syncing every word", detail: "Timing each word with WhisperX" },
  translate: { title: "Translation", long: "Translating lyrics", detail: "English for any non-English lines" },
};

/** Step states as they should display: a stopped job has nothing "active". */
export function displaySteps(job: Job): { key: StepKey; status: StepStatus }[] {
  return job.steps.map((s) => ({
    key: s.key,
    status: job.state === "done" ? "done" : job.state !== "running" && s.status === "active" ? "pending" : s.status,
  }));
}

/** Overall completion (0-1): finished steps plus progress through the current one. */
export function jobFraction(job: Job) {
  if (job.state === "done") return 1;
  const steps = displaySteps(job);
  const done = steps.filter((s) => s.status === "done").length;
  const active = steps.some((s) => s.status === "active") ? (job.stepProgress ?? 0) : 0;
  return (done + active) / steps.length;
}

export const isActiveJob = (job: Job) => job.state === "queued" || job.state === "running";

/** Wall-clock seconds, ticking once a second only while `active`. */
export function useNow(active: boolean) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now() / 1000);
    if (!active) return;
    const id = setInterval(() => setNow(Date.now() / 1000), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

export function statusLine(job: Job) {
  switch (job.state) {
    case "queued":
      return "Waiting in queue";
    case "done":
      return "Ready to sing";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return job.error ?? "Something went wrong";
    case "running": {
      const active = job.steps.find((s) => s.status === "active");
      if (!active) return "Starting…";
      const pct = job.stepProgress != null ? ` · ${Math.round(job.stepProgress * 100)}%` : "";
      return `${STEP_LABELS[active.key].long}${pct}`;
    }
  }
}

export function jobThumb(job: Job) {
  return assetUrl(job.artwork) ?? `https://i.ytimg.com/vi/${job.id}/mqdefault.jpg`;
}

export function playJob(job: Job) {
  fetchSong(job.id)
    .then((song) => {
      closeAddDialog();
      player.play(song);
    })
    .catch(() => toast({ title: "Couldn't open that song", tone: "error" }));
}

export function retryJob(job: Job) {
  return submitJob(job.url).catch((e: Error) => toast({ title: e.message, tone: "error" }));
}

// ---------------------------------------------------------------------------
// Compact row (downloads menu)
// ---------------------------------------------------------------------------

export function JobRow({ job }: { job: Job }) {
  const thumb = jobThumb(job);
  const steps = displaySteps(job);
  const finished = !isActiveJob(job);

  return (
    <li className="group/row relative flex items-center gap-3 rounded-[16px] p-2.5 transition-colors duration-150 hover:bg-white/[0.05]">
      {/* Whole row opens the detailed progress view */}
      <button
        type="button"
        onClick={() => openAddDialog({ jobId: job.id })}
        aria-label={`Show progress for ${job.title ?? "this song"}`}
        className="absolute inset-0 rounded-[16px]"
      />
      <img
        src={thumb}
        alt=""
        width={44}
        height={44}
        decoding="async"
        crossOrigin={imageCors(thumb)}
        className="image-outline pointer-events-none relative size-11 shrink-0 rounded-md object-cover"
      />
      <div className="pointer-events-none relative min-w-0 flex-1">
        <p className={`truncate text-[14px] font-medium ${job.title ? "" : "text-muted"}`}>
          {job.title ?? (finished ? "Unknown song" : "Fetching details…")}
        </p>
        <p className={`truncate text-[12px] tabular-nums ${job.state === "failed" ? "text-danger" : "text-muted"}`}>
          {statusLine(job)}
        </p>
        {/* Four segments, one per step; the active one fills with its progress */}
        {!finished && (
          <div className="mt-1.5 flex gap-1" aria-hidden>
            {steps.map((s) => (
              <span key={s.key} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
                <span
                  className="step-connector-fill block h-full bg-accent"
                  style={{
                    scale: `${s.status === "done" ? 1 : s.status === "active" ? Math.max(job.stepProgress ?? 0.06, 0.06) : 0} 1`,
                  }}
                />
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="relative flex shrink-0 items-center gap-0.5">
        {job.state === "done" && (
          <button
            type="button"
            onClick={() => playJob(job)}
            className="pressable flex h-7 items-center gap-1 rounded-full bg-white px-2.5 text-[12px] font-semibold text-black hover:bg-white/85"
          >
            <Play size={11} fill="currentColor" strokeWidth={0} />
            Play
          </button>
        )}
        {(job.state === "failed" || job.state === "cancelled") && (
          <button
            type="button"
            onClick={() => retryJob(job)}
            aria-label="Retry"
            title="Retry"
            className="pressable grid size-7 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-fg"
          >
            <RotateCw size={14} strokeWidth={2} />
          </button>
        )}
        <button
          type="button"
          onClick={() => removeJob(job.id).catch(() => {})}
          aria-label={finished ? "Dismiss" : "Cancel"}
          title={finished ? "Dismiss" : "Cancel"}
          className="pressable grid size-7 place-items-center rounded-full text-muted hover:bg-white/10 hover:text-fg"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Vertical stepper (add-song dialog)
// ---------------------------------------------------------------------------

export function JobSteps({ job }: { job: Job }) {
  const steps = displaySteps(job);
  return (
    <ol aria-label="Progress" className="grid">
      {steps.map((step, i) => {
        const label = STEP_LABELS[step.key];
        const isLast = i === steps.length - 1;
        const detail =
          step.status !== "failed"
            ? label.detail
            : step.key === "translate"
              ? `Skipped: ${job.translationError ?? "translation failed"}. The song is still ready.`
              : (job.error ?? "This step failed");
        return (
          <li
            key={step.key}
            aria-current={step.status === "active" ? "step" : undefined}
            className={`relative flex gap-3.5 ${isLast ? "" : "pb-5"}`}
          >
            {!isLast && (
              <span aria-hidden className="absolute top-8 bottom-1.5 left-[11px] w-[2px] overflow-hidden rounded-full bg-white/10">
                <span
                  className="block h-full origin-top bg-accent transition-[scale] duration-500 ease-[var(--ease-out)]"
                  style={{ scale: `1 ${step.status === "done" ? 1 : 0}` }}
                />
              </span>
            )}
            <span className="pt-0.5">
              <StepNode status={step.status} progress={step.status === "active" ? job.stepProgress : null} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <p
                  className={`text-[15px] font-medium transition-colors duration-150 ${
                    step.status === "pending" ? "text-subtle" : step.status === "failed" ? "text-danger" : "text-fg"
                  }`}
                >
                  {step.status === "active" ? label.long : label.title}
                </p>
                {step.status === "active" && job.stepProgress != null && (
                  <span className="text-[13px] text-muted tabular-nums">{Math.round(job.stepProgress * 100)}%</span>
                )}
              </div>
              <p
                className={`mt-0.5 text-[13px] text-pretty ${
                  step.status === "failed" ? "text-danger/80" : step.status === "pending" ? "text-subtle" : "text-muted"
                }`}
              >
                {detail}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function Elapsed({ job }: { job: Job }) {
  const now = useNow(job.state === "running");
  if (!job.startedAt || now === null) return null;
  return <span className="tabular-nums">{formatTime((job.finishedAt ?? now) - job.startedAt)}</span>;
}

const RING = 2 * Math.PI * 9;

export function StepNode({ status, progress }: { status: StepStatus; progress: number | null }) {
  return (
    <span className="icon-swap size-6">
      {/* Pending */}
      <span
        data-hidden={status !== "pending"}
        className="grid size-6 place-items-center rounded-full shadow-[inset_0_0_0_1.5px_rgb(255_255_255/0.16)]"
      >
        <span className="size-1.5 rounded-full bg-white/25" />
      </span>

      {/* Active: determinate ring when progress is known, spinning arc otherwise */}
      <svg data-hidden={status !== "active"} viewBox="0 0 24 24" className="size-6 -rotate-90">
        <circle cx="12" cy="12" r="9" fill="none" stroke="rgb(255 255 255 / 0.14)" strokeWidth="2.5" />
        {progress != null ? (
          <circle
            className="progress-ring"
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={RING}
            strokeDashoffset={RING * (1 - Math.max(progress, 0.02))}
          />
        ) : (
          <circle
            className="spin origin-center [transform-box:fill-box]"
            cx="12"
            cy="12"
            r="9"
            fill="none"
            stroke="var(--color-accent)"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeDasharray={`${RING * 0.28} ${RING}`}
          />
        )}
      </svg>

      {/* Done */}
      <span data-hidden={status !== "done"} className="grid size-6 place-items-center rounded-full bg-accent text-white">
        <Check size={14} strokeWidth={3} />
      </span>

      {/* Failed */}
      <span data-hidden={status !== "failed"} className="grid size-6 place-items-center rounded-full bg-danger text-white">
        <X size={14} strokeWidth={3} />
      </span>
    </span>
  );
}
