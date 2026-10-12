"use client";

import { AudioLines } from "lucide-react";
import type { AlignmentMode, Settings, SettingsUpdate } from "@/lib/api";

type Save = (update: SettingsUpdate, optimistic?: Partial<Settings>) => Promise<boolean>;

const MODES: { id: AlignmentMode; label: string; detail: string }[] = [
  {
    id: "auto",
    label: "Auto",
    detail:
      "Hindi, Telugu and Malayalam use their own alignment model. Punjabi, Tamil, Kannada, Bengali, Gujarati and Odia are romanised first, since they have no model of their own.",
  },
  {
    id: "native",
    label: "Native script",
    detail: "Always align the lyrics as written. Scripts without their own model fall back to the English one.",
  },
  {
    id: "romanized",
    label: "Romanised",
    detail: "Always convert non-Latin lines to English letters and align them with the English model.",
  },
];

/** How WhisperX matches lyrics to the vocals. Applies to songs processed after the change. */
export function AlignmentCard({ settings, save }: { settings: Settings; save: Save }) {
  const current = MODES.find((m) => m.id === settings.alignmentMode) ?? MODES[0];

  return (
    <section className="surface rounded-[20px] p-5">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/[0.07] text-fg">
          <AudioLines size={20} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold">Lyrics alignment</h2>
          <p className="mt-0.5 text-[13px] text-muted text-pretty">
            How word timings are found for lyrics in non-Latin scripts. Romanised lines come from AI translation when
            it&rsquo;s on, otherwise from built-in transliteration. Applies to newly added songs.
          </p>
        </div>
      </div>

      {/* Segmented control: a radio group styled as one pill */}
      <div role="radiogroup" aria-label="Alignment mode" className="mt-4 grid grid-cols-3 gap-1 rounded-[14px] bg-bg p-1 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.08)]">
        {MODES.map((mode) => {
          const selected = mode.id === current.id;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => !selected && save({ alignmentMode: mode.id }, { alignmentMode: mode.id })}
              className={`pressable h-9 rounded-[10px] text-[13px] font-medium ${
                selected ? "bg-white/[0.12] text-fg shadow-[0_1px_2px_rgb(0_0_0/0.3)]" : "text-muted hover:text-fg"
              }`}
            >
              {mode.label}
            </button>
          );
        })}
      </div>
      <p key={current.id} className="enter-up mt-3 text-[13px] text-muted text-pretty" aria-live="polite">
        {current.detail}
      </p>
    </section>
  );
}
