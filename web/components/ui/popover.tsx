"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

type PopoverProps = {
  /** Renders the trigger; spread `props` onto a button. */
  trigger: (props: { onClick: () => void; "aria-expanded": boolean; "aria-haspopup": "dialog" }, open: boolean) => ReactNode;
  children: (close: () => void) => ReactNode;
  label: string;
  /** Width of the panel in px. */
  width?: number;
  align?: "left" | "right";
};

/** Small anchored panel that scales in from its trigger. Closes on outside click or Escape. */
export function Popover({ trigger, children, label, width = 300, align = "right" }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
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

  return (
    <div ref={rootRef} className="relative">
      {trigger({ onClick: () => setOpen((o) => !o), "aria-expanded": open, "aria-haspopup": "dialog" }, open)}
      {open && (
        <div
          role="dialog"
          aria-label={label}
          className={`card-menu absolute top-12 z-20 rounded-[20px] bg-[#1f1f22]/95 p-2 text-fg shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_24px_56px_-12px_rgb(0_0_0/0.85)] backdrop-blur-xl ${
            align === "right" ? "right-0" : "left-0 [transform-origin:top_left]"
          }`}
          style={{ width: `min(${width}px, calc(100vw - 2rem))` }}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
