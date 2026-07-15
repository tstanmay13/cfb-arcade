// TeamMark — the arcade-wide identity primitive (V1 identity pass, shared).
// A generated monogram badge: primary fill, secondary ring, Graduate letters.
// Cabinet-agnostic: takes raw school name + brand hexes, so the draft
// (Team.mainHex/accentHex), Guess the Season, and CFB-GM (GmTeam.color/
// altColor via src/gm/ui.tsx) all render the same badge. No licensed marks —
// everything is derived from the baked brand colors, contrast-safe.
import type { ReactNode } from "react";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string | null | undefined): Rgb | null {
  if (!hex) return null;
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (h.length !== 6 || /[^0-9a-fA-F]/.test(h)) return null;
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function channelLum(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(rgb: Rgb): number {
  return 0.2126 * channelLum(rgb.r) + 0.7152 * channelLum(rgb.g) + 0.0722 * channelLum(rgb.b);
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return { r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t };
}

const BLACK: Rgb = { r: 0, g: 0, b: 0 };
const WHITE: Rgb = { r: 255, g: 255, b: 255 };
const INK: Rgb = { r: 0x1b, g: 0x2a, b: 0x41 };

// Neutral identity for shells that carry no brand color (FCS/buy games).
const FALLBACK_PRIMARY = "#454b57";

/**
 * Two-letter monogram for a TeamMark badge. Multi-word schools take their
 * initials ("Ohio State" → OS); leading acronyms keep themselves
 * ("NC State" → NC); one-word acronyms take their first pair ("UCLA" → UC);
 * everything else is a single letter ("Georgia" → G).
 */
export function monogram(school: string): string {
  const words = school.trim().split(/\s+/);
  if (words.length >= 2) {
    if (/^[A-Z]{2,3}$/.test(words[0])) return words[0].slice(0, 2);
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const w = words[0] ?? "?";
  if (/^[A-Z]{2,}$/.test(w)) return w.slice(0, 2);
  return w[0].toUpperCase();
}

export interface MarkColors {
  bg: string;
  fg: string;
  ring: string;
}

/**
 * Colors for a TeamMark: primary fill, letters in the secondary when it reads
 * on the primary (Iowa gold-on-black), otherwise white/ink, and a ring that
 * separates the badge from any surface. Near-white secondaries fall back to a
 * darkened primary, matching the GM design system's accent rule.
 */
export function markColors(primaryHex: string | null | undefined, secondaryHex: string | null | undefined): MarkColors {
  const primary = parseHex(primaryHex) ?? parseHex(FALLBACK_PRIMARY)!;
  let secondary = parseHex(secondaryHex);
  if (secondary == null || contrast(secondary, WHITE) < 1.6) {
    secondary = mix(primary, BLACK, 0.28);
  }
  const secondaryReads = contrast(secondary, primary) >= 3;
  const bestOnPrimary = contrast(WHITE, primary) >= contrast(INK, primary) ? "#ffffff" : toHex(INK);
  return {
    bg: parseHex(primaryHex) ? primaryHex! : FALLBACK_PRIMARY,
    fg: secondaryReads ? toHex(secondary) : bestOnPrimary,
    ring: contrast(secondary, primary) >= 1.6 ? toHex(secondary) : "rgba(255,255,255,0.85)",
  };
}

/**
 * A softened ("not too deep") team-color slab + the text color that reads on
 * it. `lighten` mixes the primary toward white (0 = full color, 1 = white).
 * For colored section headers that want real brand color without the weight of
 * a full-saturation fill. Same brand-hex input as the team selector / TeamMark.
 */
export function softTeamFill(
  primaryHex: string | null | undefined,
  lighten = 0.22,
): { bg: string; fg: string } {
  const primary = parseHex(primaryHex) ?? parseHex(FALLBACK_PRIMARY)!;
  const soft = mix(primary, WHITE, lighten);
  const fg = contrast(WHITE, soft) >= contrast(INK, soft) ? "#ffffff" : toHex(INK);
  return { bg: toHex(soft), fg };
}

export type MarkSize = "xs" | "s" | "m" | "l" | "xl";

const MARK_SIZE: Record<MarkSize, { box: string; font: string; ring: number }> = {
  xs: { box: "h-4 w-4", font: "text-[7px]", ring: 1 },
  s: { box: "h-5 w-5", font: "text-[8px]", ring: 1.5 },
  m: { box: "h-8 w-8", font: "text-[11px]", ring: 2 },
  l: { box: "h-10 w-10", font: "text-sm", ring: 2.5 },
  xl: { box: "h-16 w-16", font: "text-2xl", ring: 3.5 },
};

/**
 * The badge itself. `inverse` flips to a light badge for placement ON a
 * primary-colored slab (broadcast scoreboards, result chips). Decorative
 * next to a written name.
 */
export default function TeamMark({
  school,
  primary,
  secondary,
  size = "m",
  inverse = false,
  className = "",
}: {
  school: string | null | undefined;
  primary: string | null | undefined;
  secondary: string | null | undefined;
  size?: MarkSize;
  inverse?: boolean;
  className?: string;
}): ReactNode {
  const s = MARK_SIZE[size];
  const mk = markColors(primary, secondary);
  const solidPrimary = parseHex(primary) ? primary! : FALLBACK_PRIMARY;
  const bg = inverse ? "#fffdf6" : mk.bg;
  const fg = inverse ? solidPrimary : mk.fg;
  const ring = inverse ? solidPrimary : mk.ring;
  return (
    <span
      aria-hidden
      title={school ?? undefined}
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-display leading-none ${s.box} ${s.font} ${className}`}
      style={{
        background: bg,
        color: fg,
        boxShadow: `inset 0 0 0 ${s.ring}px ${ring}, 0 1px 2px rgba(27, 42, 65, 0.25)`,
      }}
    >
      {monogram(school ?? "?")}
    </span>
  );
}
