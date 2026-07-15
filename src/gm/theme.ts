// CFB-GM color system (V0, ADR-0023 visual pass). Pure, no React. Turns a
// program's baked brand colors into a small, contrast-safe palette the portal,
// recruiting, ranking, and depth-chart surfaces render school identity with.
//
// Design-system rule: raw brand hexes and the neutral fallbacks live HERE (and
// the semantic tokens live in index.css). Component files ask for colors
// through getTeamColors — they never hardcode a hex.

import type { GmTeam } from "./engine/types.ts";

export interface TeamColors {
  /** Raw baked primary/secondary (fallback slate for color-less shells). */
  primary: string;
  secondary: string;
  /** Primary nudged dark enough to read as text on the cream paper bg. */
  ink: string;
  /** Readable text (white or dark) to place ON a primary-filled surface. */
  onPrimary: string;
  /** Readable text to place ON a secondary-filled surface. */
  onSecondary: string;
}

// Neutral identity for FCS/buy-game shells that carry no brand color.
const FALLBACK_PRIMARY = "#454b57";
const FALLBACK_SECONDARY = "#aeb4c0";
// The surface school names sit on (matches --paper / --surface tokens).
const PAPER = "#faf6ec";
const INK = "#1b2a41";

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseHex(hex: string): Rgb | null {
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

/** Darken `color` toward black until it clears `min` contrast on `bg`. */
function darkenUntilReadable(color: Rgb, bg: Rgb, min: number): Rgb {
  let out = color;
  for (let t = 0; t <= 1.0001 && contrast(out, bg) < min; t += 0.1) {
    out = mix(color, BLACK, t);
  }
  return out;
}

/** Pick whichever of white/ink reads best on `bg`. */
function bestTextOn(bg: Rgb): string {
  const ink = parseHex(INK)!;
  return contrast(WHITE, bg) >= contrast(ink, bg) ? "#ffffff" : INK;
}

const paperRgb = parseHex(PAPER)!;

/**
 * Two-letter monogram for a TeamMark badge (V1 identity pass). Multi-word
 * schools take their initials ("Ohio State" → OS); leading acronyms keep
 * themselves ("NC State" → NC); one-word acronyms take their first pair
 * ("UCLA" → UC); everything else is a single letter ("Georgia" → G).
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
 * on the primary (Iowa gold-on-black), otherwise the safe onPrimary text, and
 * a ring that separates the badge from any surface it sits on.
 */
export function getMarkColors(team: GmTeam | null | undefined): MarkColors {
  const c = getTeamColors(team);
  const primary = parseHex(c.primary) ?? parseHex(FALLBACK_PRIMARY)!;
  const secondary = parseHex(c.secondary);
  const secondaryReads = secondary != null && contrast(secondary, primary) >= 3;
  return {
    bg: c.primary,
    fg: secondaryReads ? c.secondary : c.onPrimary,
    ring: secondary != null && contrast(secondary, primary) >= 1.6 ? c.secondary : "rgba(255,255,255,0.85)",
  };
}

/**
 * Brand palette for a team, contrast-corrected for our cream surfaces.
 * Always returns valid colors — color-less shells get the neutral fallback.
 * Accepts a team (from state.teams[tid]) or null/undefined.
 */
export function getTeamColors(team: GmTeam | null | undefined): TeamColors {
  const primaryHex = team?.color ?? FALLBACK_PRIMARY;
  let secondaryHex = team?.altColor ?? FALLBACK_SECONDARY;
  const primary = parseHex(primaryHex) ?? parseHex(FALLBACK_PRIMARY)!;
  let secondary = parseHex(secondaryHex) ?? parseHex(FALLBACK_SECONDARY)!;

  // Some schools bake white as the secondary — useless as a standalone accent.
  // Fall back to a darkened primary so there's always a usable second tone.
  if (contrast(secondary, WHITE) < 1.6) {
    secondary = mix(primary, BLACK, 0.28);
    secondaryHex = toHex(secondary);
  }

  return {
    primary: primaryHex,
    secondary: secondaryHex,
    ink: toHex(darkenUntilReadable(primary, paperRgb, 4.5)),
    onPrimary: bestTextOn(primary),
    onSecondary: bestTextOn(secondary),
  };
}
