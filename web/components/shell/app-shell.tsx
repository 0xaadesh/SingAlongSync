"use client";

import { Mic2, Plus, Settings } from "lucide-react";
import Link from "next/link";
import { Suspense, useEffect, type ReactNode } from "react";
import { fetchSong } from "@/lib/api";
import { onJobFinished } from "@/lib/jobs";
import { useLibrary } from "@/lib/library";
import { player, playerStore, usePlayer } from "@/lib/player";
import { toast } from "@/lib/toast";
import { openAddDialog, trackedJobStore } from "@/lib/ui";
import { AddSongDialog } from "@/components/library/add-song-dialog";
import { DownloadsMenu } from "@/components/library/downloads-menu";
import { SearchField } from "@/components/library/search-field";
import { MiniPlayer } from "@/components/player/mini-player";
import { PlayerHost } from "@/components/player/player-host";
import { LyricsDialog } from "@/components/player/lyrics-dialog";
import { PlayerSheet } from "@/components/player/player-sheet";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Toaster } from "@/components/ui/toaster";
import { NavTabs, NavTabsFallback } from "./nav-tabs";

/**
 * Everything that survives page navigation: header, audio, player, dialogs.
 * Lives in the root layout so playback never stops when switching sections.
 */
export function AppShell({ children }: { children: ReactNode }) {
  useLibrary();
  const { song } = usePlayer();

  useEffect(
    () =>
      onJobFinished(({ job }) => {
        // The add dialog is already showing this job's result.
        // Lyrics were added or replaced for the song that's open: show the new timings
        if (job.state === "done" && playerStore.get().song?.videoId === job.id) player.refreshDetail().catch(() => {});
        if (trackedJobStore.get() === job.id) return;
        if (job.state === "done") {
          toast({
            title: "Ready to sing",
            description: job.title ?? undefined,
            action: { label: "Play", onClick: () => fetchSong(job.id).then((s) => player.play(s)) },
          });
        } else {
          toast({ title: "Couldn't process song", description: job.error ?? job.title ?? undefined, tone: "error" });
        }
      }),
    [],
  );

  return (
    <>
      <PlayerHost />
      <header className="sticky top-0 z-30 bg-bg/80 pt-[env(safe-area-inset-top)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-3 px-5 sm:gap-4 sm:px-8 lg:px-12">
          <Link href="/" aria-label="SingAlongSync home" className="flex shrink-0 items-center gap-2.5 rounded-[10px]">
            <span className="grid size-8 place-items-center rounded-[10px] bg-accent text-white shadow-[0_4px_14px_-4px_rgb(250_45_72/0.6)]">
              <Mic2 size={17} strokeWidth={2.25} />
            </span>
            <span className="hidden text-[15px] font-semibold tracking-tight xl:inline">SingAlongSync</span>
          </Link>
          <div className="hidden md:block">
            <Suspense fallback={<NavTabsFallback />}>
              <NavTabs />
            </Suspense>
          </div>
          <div className="mx-auto w-full min-w-0 max-w-md flex-1">
            <SearchField />
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <DownloadsMenu />
            <Link
              href="/settings"
              aria-label="Settings"
              title="Settings"
              className="pressable grid size-10 place-items-center rounded-full text-muted hover:bg-white/8 hover:text-fg"
            >
              <Settings size={18} strokeWidth={2} />
            </Link>
            <button
              type="button"
              onClick={() => openAddDialog()}
              aria-label="Add song"
              className="pressable flex h-10 items-center gap-1.5 rounded-full bg-accent px-3 text-[14px] font-semibold text-white shadow-[0_4px_14px_-6px_rgb(250_45_72/0.7)] hover:bg-accent-hover sm:pr-4 sm:pl-3"
            >
              <Plus size={18} strokeWidth={2.25} />
              <span className="hidden sm:inline">Add song</span>
            </button>
          </div>
        </div>
        {/* Small screens: sections get their own scrollable row */}
        <div className="overflow-x-auto px-5 pb-2.5 sm:px-8 md:hidden">
          <Suspense fallback={<NavTabsFallback />}>
            <NavTabs />
          </Suspense>
        </div>
      </header>

      <main className={`mx-auto max-w-[1400px] px-5 sm:px-8 lg:px-12 ${song ? "pb-28" : "pb-16"}`}>{children}</main>

      <MiniPlayer />
      <PlayerSheet />
      <AddSongDialog />
      <ConfirmDialog />
      <LyricsDialog />
      <Toaster />
    </>
  );
}
