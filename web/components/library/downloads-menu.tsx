"use client";

import { ArrowDownToLine } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { removeJob, useJobs } from "@/lib/jobs";
import { isActiveJob, jobFraction, JobRow } from "./jobs";

const RING = 2 * Math.PI * 16;

/** Navbar button with an overall progress ring; opens the list of downloads. */
export function DownloadsMenu() {
  const { jobs } = useJobs();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const active = jobs.filter(isActiveJob);
  const running = jobs.find((j) => j.state === "running");
  const finished = jobs.filter((j) => !isActiveJob(j));

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      // Ignore clicks inside open dialogs (e.g. the progress view opened from this menu)
      if ((e.target as HTMLElement).closest("dialog")) return;
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("dialog[open]")) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!jobs.length) return null;

  const label = active.length ? `Downloads, ${active.length} in progress` : "Downloads";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="enter-up pressable relative grid size-10 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-fg data-[open=true]:bg-white/8 data-[open=true]:text-fg"
        data-open={open}
      >
        <ArrowDownToLine size={17} strokeWidth={2} />
        {active.length > 0 && (
          <svg aria-hidden viewBox="0 0 36 36" className="absolute inset-0.5 -rotate-90">
            <circle cx="18" cy="18" r="16" fill="none" stroke="rgb(255 255 255 / 0.1)" strokeWidth="2" />
            {running ? (
              <circle
                className="progress-ring"
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={RING}
                strokeDashoffset={RING * (1 - Math.max(jobFraction(running), 0.03))}
              />
            ) : (
              <circle
                className="spin origin-center [transform-box:fill-box]"
                cx="18"
                cy="18"
                r="16"
                fill="none"
                stroke="var(--color-accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeDasharray={`${RING * 0.2} ${RING}`}
              />
            )}
          </svg>
        )}
        {active.length > 1 && (
          <span className="absolute -top-0.5 -right-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white tabular-nums">
            {active.length}
          </span>
        )}
      </button>

      {open && (
        <div className="card-menu absolute top-12 right-0 z-40 w-[min(380px,calc(100vw-2rem))] rounded-[24px] bg-surface-2 p-2 shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_24px_56px_-12px_rgb(0_0_0/0.85)]">
          <div className="flex items-center justify-between px-2.5 pt-1.5 pb-2">
            <p className="text-[13px] font-semibold text-muted">Downloads</p>
            {finished.length > 0 && (
              <button
                type="button"
                onClick={() => finished.forEach((j) => removeJob(j.id).catch(() => {}))}
                className="rounded-md text-[12px] font-medium text-subtle transition-colors duration-150 hover:text-fg"
              >
                Clear finished
              </button>
            )}
          </div>
          <ul className="max-h-[min(60vh,480px)] overflow-y-auto">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
