"use client";

import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { usePlayer } from "@/lib/player";
import { useStore } from "@/lib/store";
import { dismissToast, toastStore, type Toast } from "@/lib/toast";

const DURATION = 5000;

export function Toaster() {
  const toasts = useStore(toastStore);
  const { song, sheetOpen } = usePlayer();
  // Sit above the mini player when it's showing.
  const lifted = !!song && !sheetOpen;

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-6 z-[60] flex flex-col items-center gap-2 px-3 transition-[translate] duration-300 ease-[var(--ease-out)]"
      style={{ translate: `0 ${lifted ? -80 : 0}px` }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastItem({ toast }: { toast: Toast }) {
  const [hovered, setHovered] = useState(false);
  const remaining = useRef(DURATION);

  // Timer pauses on hover and while the tab is hidden, so nothing expires unseen.
  useEffect(() => {
    if (hovered) return;
    let started = performance.now();
    let timer = 0;
    const start = () => {
      started = performance.now();
      timer = window.setTimeout(() => dismissToast(toast.id), remaining.current);
    };
    const stop = () => {
      clearTimeout(timer);
      remaining.current -= performance.now() - started;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      if (!document.hidden) stop();
    };
  }, [hovered, toast.id]);

  return (
    <div
      role={toast.tone === "error" ? "alert" : "status"}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      className="enter-up pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl bg-[#232326]/95 py-3 pr-2 pl-4 text-sm shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_16px_40px_-12px_rgb(0_0_0/0.8)] backdrop-blur-xl"
    >
      <span
        aria-hidden
        className={`size-2 shrink-0 rounded-full ${toast.tone === "error" ? "bg-danger" : "bg-success"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{toast.title}</p>
        {toast.description && <p className="truncate text-[13px] text-muted">{toast.description}</p>}
      </div>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action!.onClick();
            dismissToast(toast.id);
          }}
          className="pressable shrink-0 rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-black hover:bg-white/85"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => dismissToast(toast.id)}
        className="pressable grid size-8 shrink-0 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
      >
        <X size={16} strokeWidth={2} />
      </button>
    </div>
  );
}
