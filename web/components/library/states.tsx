"use client";

import { Mic2, Plus, RotateCw, SearchX, ServerOff } from "lucide-react";
import type { ReactNode } from "react";
import { refreshLibrary } from "@/lib/library";
import { openAddDialog, searchStore } from "@/lib/ui";

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-3xl px-6 py-16 text-center shadow-[inset_0_0_0_1px_rgb(255_255_255/0.06)]">
      <span className="grid size-12 place-items-center rounded-2xl bg-white/6 text-muted">{icon}</span>
      <p className="mt-4 text-[15px] font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-[14px] text-muted text-pretty">{body}</p>
      {action}
    </div>
  );
}

export function OfflineState() {
  return (
    <EmptyState
      icon={<ServerOff size={22} strokeWidth={2} />}
      title="Can't reach the server"
      body={
        <>
          Start it from the <code className="font-mono text-fg">server</code> folder with{" "}
          <code className="rounded-md bg-white/8 px-1.5 py-0.5 font-mono text-[13px] text-fg">uv run app.py</code>
        </>
      }
      action={
        <button
          type="button"
          onClick={() => refreshLibrary()}
          className="pressable mt-5 flex h-9 items-center gap-2 rounded-full bg-white/10 px-4 text-[13px] font-medium hover:bg-white/15"
        >
          <RotateCw size={14} strokeWidth={2} />
          Try again
        </button>
      }
    />
  );
}

export function EmptyLibraryState() {
  return (
    <EmptyState
      icon={<Mic2 size={22} strokeWidth={2} />}
      title="Your library is empty"
      body="Add a song from YouTube Music and it'll be ready to sing along word by word."
      action={
        <button
          type="button"
          onClick={() => openAddDialog()}
          className="pressable mt-5 flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[14px] font-semibold text-white hover:bg-accent-hover"
        >
          <Plus size={16} strokeWidth={2.25} />
          Add song
        </button>
      }
    />
  );
}

export function NoMatchesState({ query, noun }: { query: string; noun: string }) {
  return (
    <EmptyState
      icon={<SearchX size={22} strokeWidth={2} />}
      title="No matches"
      body={<>No {noun} match “{query.trim()}”.</>}
      action={
        <button
          type="button"
          onClick={() => searchStore.set("")}
          className="pressable mt-5 h-9 rounded-full bg-white/10 px-4 text-[13px] font-medium hover:bg-white/15"
        >
          Clear search
        </button>
      }
    />
  );
}

/** Page title row with a live count on the right. */
export function PageHeading({ title, count }: { title: string; count?: string }) {
  return (
    <div className="mt-8 mb-5 flex items-baseline justify-between gap-4">
      <h1 className="text-3xl font-bold tracking-[-0.025em]">{title}</h1>
      {count && (
        <span className="shrink-0 text-[13px] text-subtle tabular-nums" aria-live="polite">
          {count}
        </span>
      )}
    </div>
  );
}

export const plural = (n: number, word: string) => `${n} ${n === 1 ? word : `${word}s`}`;

/** "3 of 12 albums" while searching, "12 albums" otherwise. */
export function countLabel(shown: number, total: number, word: string, searching: boolean) {
  if (!total) return undefined;
  return searching ? `${shown} of ${plural(total, word)}` : plural(total, word);
}
