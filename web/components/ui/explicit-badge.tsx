/** The small "E" explicit marker, as on Apple Music and Spotify. */
export function ExplicitBadge({ className = "" }: { className?: string }) {
  return (
    <span
      role="img"
      aria-label="Explicit"
      title="Explicit"
      className={`inline-grid size-[15px] shrink-0 place-items-center rounded-[3px] bg-white/55 text-[9.5px] leading-none font-bold text-black ${className}`}
    >
      E
    </span>
  );
}
