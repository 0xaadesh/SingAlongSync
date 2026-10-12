"use client";

import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from "react";

type SliderProps = {
  label: string;
  /** Controlled position (0-1). Omit and use `bind` for values that change every frame. */
  value?: number;
  /** Imperative feed: receives a setter to push positions without re-rendering. */
  bind?: (set: (fraction: number) => void) => () => void;
  valueText: (fraction: number) => string;
  /** Fires while dragging. */
  onScrub?: (fraction: number) => void;
  /** Fires on release and on keyboard changes. */
  onCommit: (fraction: number) => void;
  keyboardStep: number;
  className?: string;
};

const clamp = (n: number) => Math.min(1, Math.max(0, n));

export function Slider({
  label,
  value,
  bind,
  valueText,
  onScrub,
  onCommit,
  keyboardStep,
  className = "",
}: SliderProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const fractionRef = useRef(value ?? 0);
  const draggingRef = useRef(false);
  const lastAriaRef = useRef(-1);

  const paint = (f: number) => {
    fractionRef.current = f;
    if (fillRef.current) fillRef.current.style.transform = `scaleX(${f})`;
    // Screen readers don't need 60 updates a second; write ARIA on whole-percent changes.
    const percent = Math.round(f * 100);
    if (percent !== lastAriaRef.current && rootRef.current) {
      lastAriaRef.current = percent;
      rootRef.current.setAttribute("aria-valuenow", String(percent));
      rootRef.current.setAttribute("aria-valuetext", valueText(f));
    }
  };

  useEffect(() => {
    if (value !== undefined && !draggingRef.current) paint(value);
  });

  useEffect(() => {
    if (!bind) return;
    return bind((f) => {
      if (!draggingRef.current) paint(clamp(f));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bind]);

  const fractionAt = (clientX: number) => {
    const rect = rootRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    rootRef.current!.dataset.dragging = "true";
    const f = fractionAt(e.clientX);
    paint(f);
    onScrub?.(f);
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    const f = fractionAt(e.clientX);
    paint(f);
    onScrub?.(f);
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    delete rootRef.current!.dataset.dragging;
    const f = fractionAt(e.clientX);
    paint(f);
    onCommit(f);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const deltas: Record<string, number> = {
      ArrowRight: keyboardStep,
      ArrowUp: keyboardStep,
      ArrowLeft: -keyboardStep,
      ArrowDown: -keyboardStep,
      PageUp: keyboardStep * 5,
      PageDown: -keyboardStep * 5,
    };
    let next: number | null = null;
    if (e.key in deltas) next = clamp(fractionRef.current + deltas[e.key]);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = 1;
    if (next === null) return;
    e.preventDefault();
    e.stopPropagation();
    paint(next);
    onCommit(next);
  };

  return (
    <div
      ref={rootRef}
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`slider group relative flex h-5 cursor-pointer touch-none items-center select-none ${className}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
    >
      <div className="slider-track relative h-1.5 w-full overflow-hidden rounded-full bg-white/20">
        <div
          ref={fillRef}
          className="slider-fill absolute inset-0 bg-white/90"
          style={{ transform: `scaleX(${value ?? 0})` }}
        />
      </div>
    </div>
  );
}
