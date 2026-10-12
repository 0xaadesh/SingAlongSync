"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

export const SECTIONS = [
  { href: "/", label: "Songs" },
  { href: "/albums", label: "Albums" },
  { href: "/artists", label: "Artists" },
  { href: "/genres", label: "Genres" },
] as const;

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Section tabs with a pill that slides to the active one. */
export function NavTabs() {
  const pathname = usePathname();
  return <Tabs activeHref={SECTIONS.find((s) => isActive(pathname, s.href))?.href ?? null} />;
}

/** Shown while the pathname isn't known yet (prerendering dynamic pages). */
export function NavTabsFallback() {
  return <Tabs activeHref={null} />;
}

function Tabs({ activeHref }: { activeHref: string | null }) {
  const listRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  const hasPositioned = useRef(false);

  useLayoutEffect(() => {
    const list = listRef.current;
    const pill = pillRef.current;
    if (!list || !pill) return;
    const place = () => {
      const active = list.querySelector<HTMLElement>("[data-active='true']");
      if (!active) {
        pill.style.opacity = "0";
        return;
      }
      // First placement jumps; later ones slide.
      pill.style.transition = hasPositioned.current ? "" : "none";
      pill.style.opacity = "1";
      pill.style.width = `${active.offsetWidth}px`;
      pill.style.transform = `translateX(${active.offsetLeft}px)`;
      hasPositioned.current = true;
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(list);
    return () => ro.disconnect();
  }, [activeHref]);

  return (
    <nav aria-label="Library sections">
      <div ref={listRef} className="relative flex items-center gap-0.5 rounded-full bg-white/[0.05] p-1">
        <span
          ref={pillRef}
          aria-hidden
          className="absolute top-1 left-0 h-8 rounded-full bg-white/[0.12] opacity-0 shadow-[0_1px_2px_rgb(0_0_0/0.3)] transition-[transform,width] duration-200 ease-[var(--ease-out)]"
        />
        {SECTIONS.map((s) => {
          const active = s.href === activeHref;
          return (
            <Link
              key={s.href}
              href={s.href}
              data-active={active}
              aria-current={active ? "page" : undefined}
              className={`relative z-10 flex h-8 items-center rounded-full px-3.5 text-[13px] font-medium transition-colors duration-150 ${
                active ? "text-fg" : "text-muted hover:text-fg"
              }`}
            >
              {s.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
