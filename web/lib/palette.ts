export type RGB = [number, number, number];

/** Load an image with CORS so its pixels can be read from a canvas. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

/**
 * Bake a tiny, pre-blurred copy of the artwork. Scaled up with CSS it becomes a soft
 * ambient backdrop with no runtime blur filter, which keeps animation on the compositor.
 */
export function bakeAmbient(img: HTMLImageElement, canvas: HTMLCanvasElement) {
  const size = 48;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.filter = "blur(5px) saturate(1.6)";
  // Overdraw past the edges so the blur doesn't fade to transparent at the borders.
  ctx.drawImage(img, -8, -8, size + 16, size + 16);
}

/** Dominant colour of the artwork, darkened enough to sit behind white text. */
export function extractBaseColor(img: HTMLImageElement): RGB | null {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  try {
    ctx.drawImage(img, 0, 0, 16, 16);
    const data = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0;
    let g = 0;
    let b = 0;
    let weight = 0;
    for (let i = 0; i < data.length; i += 4) {
      const max = Math.max(data[i], data[i + 1], data[i + 2]);
      const min = Math.min(data[i], data[i + 1], data[i + 2]);
      // Favour saturated pixels so the colour isn't a muddy grey average.
      const w = 1 + ((max - min) / 255) * 4;
      r += data[i] * w;
      g += data[i + 1] * w;
      b += data[i + 2] * w;
      weight += w;
    }
    const scale = 0.32;
    return [(r / weight) * scale, (g / weight) * scale, (b / weight) * scale].map(Math.round) as RGB;
  } catch {
    // Tainted canvas (artwork served without CORS)
    return null;
  }
}
