/**
 * A curated palette so the calendar looks consistent and classy instead of
 * using Google's loud defaults. Each Google calendar color is mapped to the
 * nearest palette color by hue, so "your red calendar" still looks reddish.
 */
export const PALETTE = [
  { name: "blue", hex: "#3b6fe0", hue: 222 },
  { name: "navy", hex: "#1e3a8a", hue: 226 },
  { name: "sky", hex: "#2b8fd6", hue: 205 },
  { name: "teal", hex: "#14958a", hue: 174 },
  { name: "green", hex: "#3a9a5b", hue: 140 },
  { name: "amber", hex: "#c98a14", hue: 40 },
  { name: "orange", hex: "#d9682b", hue: 22 },
  { name: "rose", hex: "#d0475f", hue: 350 },
  { name: "violet", hex: "#7559d6", hue: 256 },
  { name: "slate", hex: "#64748b", hue: -1 },
] as const;

/** Fixed colors for the non-Google sources. */
export const SOURCE_COLORS = {
  ai: "#7559d6", // violet — clearly "machine-found"
  blackbaud: "#c98a14", // amber — assignments / due
  todo: "#d0475f", // rose — urgent to-dos
} as const;

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return { h: h * 60, s, l };
}

/** Map any Google calendar color to our palette. */
export function paletteColorFor(googleHex: string | null | undefined): string {
  const hsl = googleHex ? hexToHsl(googleHex) : null;
  if (!hsl) return PALETTE[0].hex;
  if (hsl.s < 0.18) return "#64748b"; // greys → slate
  let best: (typeof PALETTE)[number] = PALETTE[0];
  let bestDist = Infinity;
  for (const p of PALETTE) {
    if (p.hue < 0) continue;
    const d = Math.min(Math.abs(p.hue - hsl.h), 360 - Math.abs(p.hue - hsl.h));
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best.hex;
}
