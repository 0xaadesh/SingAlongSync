"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

export type ComboOption = { id: string; label: string; description?: string; icon?: ReactNode; trailing?: ReactNode };

type ComboboxProps = {
  label: string;
  value: string | null;
  options: ComboOption[] | null; // null while loading
  onChange: (id: string) => void;
  placeholder: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  /** Offer "Use <typed text>" when it matches nothing (free-form ids). */
  allowCustom?: boolean;
  /** Shown in place of the list (e.g. a load error with a retry). */
  status?: ReactNode;
  /** Shown in the trigger instead of the matching option's label. */
  display?: ReactNode;
  /** id for the trigger button (focus target). */
  id?: string;
};

/** Button that opens a searchable list. Keyboard: arrows, Enter, Escape. */
export function Combobox({
  label,
  value,
  options,
  onChange,
  placeholder,
  searchPlaceholder = "Search",
  disabled,
  allowCustom,
  status,
  display,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const selected = options?.find((o) => o.id === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!options) return [];
    return q
      ? options.filter((o) => o.label.toLowerCase().includes(q) || o.id.toLowerCase().includes(q) || o.description?.toLowerCase().includes(q))
      : options;
  }, [options, query]);

  const custom = query.trim();
  const showCustom = !!(allowCustom && custom && !options?.some((o) => o.id === custom));
  const items: ComboOption[] = showCustom ? [{ id: custom, label: `Use “${custom}”` }, ...filtered] : filtered;

  // Open on the selected option, with an empty search.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    const index = options?.findIndex((o) => o.id === value) ?? -1;
    setActive(Math.max(index, 0));
    requestAnimationFrame(() => {
      listRef.current?.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "nearest" });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  const choose = (id: string) => {
    onChange(id);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const move = (delta: number) => {
    if (!items.length) return;
    const next = (active + delta + items.length) % items.length;
    setActive(next);
    listRef.current?.children[next]?.scrollIntoView({ block: "nearest" });
  };

  return (
    <div ref={rootRef} className="relative w-full">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={label}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-[12px] bg-bg pr-2.5 pl-3 text-left text-[14px] shadow-[0_0_0_1px_rgb(255_255_255/0.1)] transition-[box-shadow,opacity] duration-150 hover:shadow-[0_0_0_1px_rgb(255_255_255/0.18)] disabled:cursor-not-allowed disabled:opacity-40 data-[open=true]:shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_0_0_4px_rgb(250_45_72/0.25)]"
        data-open={open}
      >
        {selected?.icon && !display && <span className="shrink-0">{selected.icon}</span>}
        <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-subtle"}`}>
          {display ?? selected?.label ?? value ?? placeholder}
        </span>
        <ChevronsUpDown size={15} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
      </button>

      {open && (
        <div className="card-menu absolute top-12 right-0 left-0 z-40 overflow-hidden rounded-[16px] bg-surface-2 shadow-[0_0_0_1px_rgb(255_255_255/0.1),0_24px_56px_-12px_rgb(0_0_0/0.85)] [transform-origin:top]">
          <div className="flex h-11 items-center gap-2.5 px-3.5 shadow-[0_1px_0_rgb(255_255_255/0.07)]">
            <Search size={15} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
            <input
              autoFocus
              type="text"
              role="combobox"
              aria-label={`Search ${label.toLowerCase()}`}
              aria-controls={listId}
              aria-expanded
              aria-activedescendant={items[active] ? `${listId}-${active}` : undefined}
              placeholder={searchPlaceholder}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  move(1);
                } else if (e.key === "ArrowUp") {
                  e.preventDefault();
                  move(-1);
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  if (items[active]) choose(items[active].id);
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpen(false);
                  triggerRef.current?.focus();
                }
              }}
              className="h-full min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-subtle"
            />
          </div>

          {status ? (
            <div className="p-3">{status}</div>
          ) : (
            <ul ref={listRef} id={listId} role="listbox" aria-label={label} className="max-h-64 overflow-y-auto p-1.5">
              {options === null &&
                [0, 1, 2, 3].map((i) => (
                  <li key={i} aria-hidden className="px-2.5 py-2.5">
                    <div className="skeleton h-3.5 rounded" style={{ width: `${70 - i * 10}%` }} />
                  </li>
                ))}
              {items.map((o, i) => {
                const isSelected = o.id === value;
                return (
                  <li
                    key={`${o.id}-${i}`}
                    id={`${listId}-${i}`}
                    role="option"
                    aria-selected={isSelected}
                    onPointerMove={() => i !== active && setActive(i)}
                    onClick={() => choose(o.id)}
                    className={`flex cursor-pointer items-center gap-3 rounded-[10px] px-2.5 py-2 ${
                      i === active ? "bg-white/[0.07]" : ""
                    }`}
                  >
                    {o.icon && <span className="shrink-0">{o.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px]">{o.label}</span>
                      {o.description && <span className="block truncate text-[12px] text-subtle">{o.description}</span>}
                    </span>
                    {o.trailing}
                    <Check
                      size={15}
                      strokeWidth={2.5}
                      className={`shrink-0 text-accent ${isSelected ? "" : "invisible"}`}
                      aria-hidden
                    />
                  </li>
                );
              })}
              {options !== null && !items.length && (
                <li className="px-2.5 py-6 text-center text-[13px] text-muted">No results</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
