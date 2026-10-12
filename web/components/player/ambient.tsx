"use client";

import { useEffect, useRef, useState } from "react";
import { bakeAmbient, extractBaseColor, loadImage, type RGB } from "@/lib/palette";

type AmbientProps = { src: string | null; paused: boolean };

/** Slowly turning, colour-matched backdrop built from the album artwork. */
export function Ambient({ src, paused }: AmbientProps) {
  const aRef = useRef<HTMLCanvasElement>(null);
  const bRef = useRef<HTMLCanvasElement>(null);
  const [state, setState] = useState<{ src: string; base: RGB | null } | null>(null);

  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    loadImage(src)
      .then((img) => {
        if (cancelled || !aRef.current || !bRef.current) return;
        const base = extractBaseColor(img);
        // Canvas reads fail on artwork served without CORS; fall back to the neutral backdrop.
        if (!base) return setState({ src, base: null });
        bakeAmbient(img, aRef.current);
        bakeAmbient(img, bRef.current);
        setState({ src, base });
      })
      .catch(() => !cancelled && setState({ src, base: null }));
    return () => {
      cancelled = true;
    };
  }, [src]);

  const ready = state?.src === src && state.base !== null;
  const base = ready && state.base ? `rgb(${state.base.join(" ")})` : "#141416";

  return (
    <div
      aria-hidden
      className="absolute inset-0 overflow-hidden"
      style={{ backgroundColor: base, transition: "background-color 900ms ease" }}
    >
      <div className="ambient-backdrop absolute inset-0" data-ready={ready} data-paused={paused}>
        <canvas ref={aRef} className="ambient-layer" data-layer="a" />
        <canvas ref={bRef} className="ambient-layer" data-layer="b" />
      </div>
      {/* Scrim keeps white lyrics readable over bright artwork */}
      <div className="absolute inset-0 bg-black/35" />
    </div>
  );
}
