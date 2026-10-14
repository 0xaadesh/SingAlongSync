"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type PopoverProps = {
  /** Renders the trigger; spread `props` onto a button. */
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "dialog" }, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  label: string;
  /** Width of the panel in px. */
  width?: number;
  align?: "left" | "right";
  /** Classes for the wrapper around the trigger (e.g. to stretch it in a row). */
  className?: string;
};

// Below the desktop layout the player's menus sit in a bottom bar, so they open as sheets
const PHONE_QUERY = "(max-width: 1023px)";

function subscribePhone(onChange: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** True below desktop width, where popovers become bottom sheets. */
function useIsPhone() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}

/**
 * Small anchored panel that scales in from its trigger. Closes on outside click or Escape.
 * On phones and tablets it's a bottom sheet instead, rendered at the document root so it can't be
 * clipped or pushed off-screen by its trigger's position.
 */
export function Popover({ trigger, children, label, width = 300, align = "right", className = "" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const phone = useIsPhone();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!rootRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close the popover, not the player underneath
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const close = () => setOpen(false);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "dialog" }, open)}
      {open &&
        (phone ? (
          createPortal(
            <BottomSheet label={label} panelRef={panelRef} onClose={close}>
              {children(close)}
            </BottomSheet>,
            document.body,
          )
        ) : (
          <div
            ref={panelRef}
            role="dialog"
            aria-label={label}
            className={`card-menu absolute top-12 z-20 rounded-[20px] bg-[#1f1f22]/95 p-2 text-fg shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_24px_56px_-12px_rgb(0_0_0/0.85)] backdrop-blur-xl ${
              align === "right" ? "right-0" : "left-0 [transform-origin:top_left]"
            }`}
            style={{ width: `min(${width}px, calc(100vw - 2rem))` }}
          >
            {children(close)}
          </div>
        ))}
    </div>
  );
}

const DISMISS_DISTANCE = 80;
const DISMISS_VELOCITY = 0.5; // px per ms

/**
 * Bottom sheet that can be dragged down to close: from the grip anywhere, or from the
 * content while it's scrolled to the top (and not from a control like a slider or switch).
 */
function BottomSheet({
  label,
  panelRef,
  onClose,
  children,
}: {
  label: string;
  panelRef: RefObject<HTMLDivElement | null>;
  onClose: () => void;
  children: ReactNode;
}) {
  const drag = useRef<{ id: number; y: number; time: number; dy: number; captured: boolean } | null>(null);

  // Content that doesn't scroll hands every vertical swipe to the drag; scrolling content keeps
  // its native scroll, and the grip (always touch-action: none) still drags
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const update = () => {
      panel.style.touchAction = panel.scrollHeight > panel.clientHeight + 1 ? "pan-y" : "none";
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(panel);
    return () => ro.disconnect();
  }, [panelRef]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const panel = panelRef.current!;
    const target = e.target as HTMLElement;
    const onGrip = !!target.closest("[data-sheet-grip]");
    if (e.button !== 0) return;
    if (!onGrip && (panel.scrollTop > 0 || target.closest("button, a, input, textarea, select, [role=slider], [role=switch]"))) return;
    drag.current = { id: e.pointerId, y: e.clientY, time: performance.now(), dy: 0, captured: false };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const raw = e.clientY - d.y;
    // Upward drags meet resistance instead of moving freely
    d.dy = raw > 0 ? raw : raw * 0.2;
    if (!d.captured && Math.abs(raw) > 4) {
      d.captured = true;
      panelRef.current!.setPointerCapture(e.pointerId);
    }
    if (!d.captured) return;
    const panel = panelRef.current!;
    panel.style.transition = "none";
    panel.style.translate = `0 ${d.dy}px`;
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    const panel = panelRef.current!;
    panel.style.transition = "";
    const velocity = d.dy / (performance.now() - d.time);
    if (d.dy > DISMISS_DISTANCE || (d.dy > 10 && velocity > DISMISS_VELOCITY)) onClose();
    else panel.style.translate = "";
  };

  return (
    <div className="fixed inset-0 z-[60]">
      <div aria-hidden className="sheet-backdrop absolute inset-0 bg-black/50" />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="sheet-panel absolute inset-x-2 bottom-2 mx-auto max-h-[75dvh] max-w-md overflow-y-auto overscroll-contain rounded-[24px] bg-[#1f1f22]/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] text-fg shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_-12px_48px_-12px_rgb(0_0_0/0.85)] backdrop-blur-xl"
      >
        {/* Grip: a generous strip so a thumb finds it */}
        <div data-sheet-grip aria-hidden className="-mx-2 flex cursor-grab touch-none justify-center pt-2.5 pb-3 active:cursor-grabbing">
          <span className="h-1 w-9 rounded-full bg-white/25" />
        </div>
        {children}
      </div>
    </div>
  );
}
