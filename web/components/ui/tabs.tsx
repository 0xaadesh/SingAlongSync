"use client";

import { useLayoutEffect, useRef, type KeyboardEvent } from "react";

type Tab = { id: string; label: string };

type TabsProps = {
  tabs: Tab[];
  value: string;
  onChange: (id: string) => void;
  label: string;
  /** Prefix for tab / panel ids (aria-controls). */
  idPrefix: string;
};

/** Pill tabs with a sliding highlight. Arrow keys move between tabs. */
export function Tabs({ tabs, value, onChange, label, idPrefix }: TabsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    const pill = pillRef.current;
    const active = list?.querySelector<HTMLElement>("[aria-selected='true']");
    if (!list || !pill || !active) return;
    const place = () => {
      // First placement jumps; later ones slide
      pill.style.transition = placed.current ? "" : "none";
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      placed.current = true;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
  }, [value]);

  const onKeyDown = (e: KeyboardEvent) => {
    const index = tabs.findIndex((t) => t.id === value);
    const next =
      e.key === "ArrowRight" ? (index + 1) % tabs.length
      : e.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length
      : e.key === "Home" ? 0
      : e.key === "End" ? tabs.length - 1
      : -1;
    if (next < 0) return;
    e.preventDefault();
    onChange(tabs[next].id);
    listRef.current?.querySelectorAll<HTMLElement>("[role=tab]")[next]?.focus();
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="relative flex w-fit max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-white/[0.05] p-1"
    >
      <span
        ref={pillRef}
        aria-hidden
        className="absolute top-1 left-0 h-8 rounded-full bg-white/[0.12] shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-[transform,width] duration-200 ease-[var(--ease-out)]"
      />
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`${idPrefix}-panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={`relative z-10 h-8 shrink-0 rounded-full px-4 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 ${
              selected ? "text-fg" : "text-muted hover:text-fg"
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
