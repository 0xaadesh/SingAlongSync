"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const GAP = 32; // px between the end of the text and its repeat
const SPEED = 30; // px per second

/**
 * Single line of text that scrolls only when it doesn't fit. Pauses on hover
 * (of itself or an enclosing `.group`). Pure CSS transform animation, so it
 * stays on the compositor.
 */
export function Marquee({ children, className = "" }: { children: ReactNode; className?: string }) {
  const outerRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [width, setWidth] = useState(0); // text width when it overflows, else 0

  useEffect(() => {
    const outer = outerRef.current!;
    const text = textRef.current!;
    const measure = () => {
      const overflow = text.scrollWidth > outer.clientWidth + 1;
      setWidth(overflow ? text.scrollWidth : 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(outer);
    ro.observe(text);
    return () => ro.disconnect();
  }, []);

  const distance = width + GAP;
  // The keyframes rest for the first 20% of each loop, then scroll for the remaining 80%.
  const duration = distance / SPEED / 0.8;

  return (
    <span ref={outerRef} className={`marquee block overflow-hidden whitespace-nowrap ${className}`} data-overflow={width > 0}>
      <span
        className="marquee-track inline-flex"
        style={
          width
            ? ({
                "--marquee-distance": `${distance}px`,
                animationDuration: `${duration}s`,
              } as React.CSSProperties)
            : undefined
        }
      >
        <span ref={textRef}>{children}</span>
        {width > 0 && (
          <span aria-hidden style={{ paddingLeft: GAP }}>
            {children}
          </span>
        )}
      </span>
    </span>
  );
}
