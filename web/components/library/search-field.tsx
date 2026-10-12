"use client";

import { CornerDownLeft, ListMusic, Search, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { parsePlaylistId, parseYouTubeId } from "@/lib/api";
import { useStore } from "@/lib/store";
import { openAddDialog, searchStore } from "@/lib/ui";

/** Filters the library. Pasting a YouTube link offers to add it instead. */
export function SearchField() {
  const query = useStore(searchStore);
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const linkVideoId = parseYouTubeId(query);
  const isPlaylist = parsePlaylistId(query) !== null;
  const isLink = linkVideoId !== null || isPlaylist;

  // "/" jumps to search from anywhere, like most apps.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.key !== "/" || e.metaKey || e.ctrlKey || el.isContentEditable || /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
      if (document.querySelector("dialog[open]")) return;
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const addFromLink = () => {
    openAddDialog({ url: query.trim() });
    searchStore.set("");
    inputRef.current?.blur();
  };

  return (
    <div className="relative w-full">
      <div className="flex h-10 items-center gap-2.5 rounded-[14px] bg-surface pr-1.5 pl-3 shadow-[0_0_0_1px_rgb(255_255_255/0.08)] transition-shadow duration-150 focus-within:shadow-[0_0_0_1px_rgb(255_255_255/0.14),0_0_0_4px_rgb(255_255_255/0.06)]">
        <Search size={16} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
        <input
          ref={inputRef}
          type="search"
          role="searchbox"
          aria-label="Search your library"
          placeholder="Search songs, albums, artists"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(e) => searchStore.set(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              if (query) searchStore.set("");
              else inputRef.current?.blur();
            } else if (e.key === "Enter" && isLink) {
              e.preventDefault();
              addFromLink();
            }
          }}
          className="h-full min-w-0 flex-1 bg-transparent text-[14px] text-fg outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              searchStore.set("");
              inputRef.current?.focus();
            }}
            className="pressable grid size-7 shrink-0 place-items-center rounded-[8px] text-subtle hover:bg-white/8 hover:text-fg"
          >
            <X size={15} strokeWidth={2} />
          </button>
        ) : (
          !focused && (
            <kbd
              aria-hidden
              className="hidden h-6 min-w-6 place-items-center rounded-md px-1.5 font-sans text-[12px] text-subtle shadow-[inset_0_0_0_1px_rgb(255_255_255/0.1)] sm:grid"
            >
              /
            </kbd>
          )
        )}
      </div>

      {isLink && (
        <button
          type="button"
          // Keep focus in the field until the click lands
          onMouseDown={(e) => e.preventDefault()}
          onClick={addFromLink}
          className="enter-up absolute inset-x-0 top-full mt-2 flex items-center gap-3 rounded-[14px] bg-surface-2 p-2 pr-3 text-left shadow-[0_0_0_1px_rgb(255_255_255/0.08),0_16px_40px_-8px_rgb(0_0_0/0.8)] transition-colors duration-150 hover:bg-[#232326]"
        >
          {linkVideoId ? (
            <img
              src={`https://i.ytimg.com/vi/${linkVideoId}/mqdefault.jpg`}
              alt=""
              width={40}
              height={40}
              className="image-outline size-10 shrink-0 rounded-md object-cover"
            />
          ) : (
            <span className="grid size-10 shrink-0 place-items-center rounded-md bg-white/[0.06] text-accent">
              <ListMusic size={18} strokeWidth={2} />
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-medium">{isPlaylist ? "Add songs from this album or playlist" : "Add this song"}</span>
            <span className="block truncate text-[12px] text-muted">{query.trim()}</span>
          </span>
          <CornerDownLeft size={15} strokeWidth={2} className="shrink-0 text-subtle" aria-hidden />
        </button>
      )}
    </div>
  );
}
