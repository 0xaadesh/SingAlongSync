"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { translateSong, type SongDetail } from "@/lib/api";
import { player } from "@/lib/player";
import { useStore } from "@/lib/store";
import { toast } from "@/lib/toast";
import { initShowTranslations, setShowTranslations, showTranslationsStore } from "@/lib/ui";

const POLL_MS = 3000;
const POLL_LIMIT_MS = 120_000;

/**
 * Player header control. Toggles English lines when the song has translations;
 * offers to translate it when it has none yet. Hidden for all-English songs.
 */
export function TranslationButton({ detail }: { detail: SongDetail }) {
  const show = useStore(showTranslationsStore);
  const [translating, setTranslating] = useState(false);
  const router = useRouter();

  useEffect(() => initShowTranslations(), []);

  // While a translation runs on the server, refetch until it lands.
  useEffect(() => {
    if (!translating) return;
    const started = Date.now();
    const timer = setInterval(async () => {
      const fresh = await player.refreshDetail().catch(() => null);
      if (fresh?.translations || Date.now() - started > POLL_LIMIT_MS) {
        setTranslating(false);
        if (!fresh?.translations) toast({ title: "Translation is taking a while", description: "Check Settings for errors." });
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [translating, detail.videoId]);

  const count = detail.translations ? Object.keys(detail.translations).length : null;
  const base = "pressable flex h-10 items-center gap-2 rounded-full px-3.5 text-[13px] font-semibold";

  // Translated, nothing needed it: the song is all English.
  if (count === 0) return <div aria-hidden className="size-10" />;

  if (count === null) {
    return (
      <button
        type="button"
        disabled={translating}
        onClick={async () => {
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
        }}
        className={`${base} bg-white/10 text-white/90 hover:bg-white/20 disabled:opacity-70`}
      >
        {translating ? (
          <span className="spin size-4 rounded-full border-2 border-white/25 border-t-white" />
        ) : (
          <Languages size={17} strokeWidth={2} />
        )}
        <span className="hidden sm:inline">{translating ? "Translating…" : "Translate"}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      aria-pressed={show}
      aria-label={show ? "Hide translation" : "Show translation"}
      title={show ? "Hide translation" : "Show translation"}
      onClick={() => setShowTranslations(!show)}
      className={`${base} ${show ? "bg-white text-black hover:bg-white/85" : "bg-white/10 text-white/90 hover:bg-white/20"}`}
    >
      <Languages size={17} strokeWidth={2} />
      <span className="hidden sm:inline">Translation</span>
    </button>
  );
}
