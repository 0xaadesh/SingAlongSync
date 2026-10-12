"use client";

import { useEffect, useRef } from "react";
import { player, playerStore } from "@/lib/player";

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** Owns the app's single <audio> element, global shortcuts and the tab title. */
export function PlayerHost() {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => player.attach(audioRef.current!), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const { song, sheetOpen } = playerStore.get();
      if (!song) return;
      // Leave Space alone on focused controls so it still activates them.
      const onControl = (e.target as HTMLElement).closest("button, [role=slider], a");
      switch (e.key) {
        case " ":
          if (onControl) return;
          e.preventDefault();
          player.toggle();
          break;
        case "ArrowLeft":
          if (!sheetOpen || onControl) return;
          e.preventDefault();
          player.skip(-5);
          break;
        case "ArrowRight":
          if (!sheetOpen || onControl) return;
          e.preventDefault();
          player.skip(5);
          break;
        case "Escape":
          if (sheetOpen) player.closeSheet();
          break;
        case "m":
        case "M":
          player.toggleMute();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    // While playing, the tab shows the song; otherwise the page's own title.
    let pageTitle: string | null = null;
    return playerStore.subscribe(() => {
      const { song, playing } = playerStore.get();
      if (song && playing) {
        pageTitle ??= document.title;
        document.title = `${song.title} · ${song.artist}`;
      } else if (pageTitle !== null) {
        document.title = pageTitle;
        pageTitle = null;
      }
    });
  }, []);

  return <audio ref={audioRef} preload="auto" hidden />;
}
