// Player creation: compact core attributes (the engine truth), hidden dev
// rating + potential ceiling, and the derived EA-style presentation sheet.
// Core attrs are the ONLY simulation input; the sheet is a pure function of
// them (§12 invariant applied to ratings — derived, never stored).

import type { Rng } from "../../engine/rng.ts";
import type { DevTier, GmPlayerSeed, Player, PosGroup, SeasonStats } from "./types.ts";
import { clamp, rangeInt, stream, subSeed } from "./streams.ts";
import { genName } from "./names.ts";

/** Core attribute keys per position group (CFB_GM_DESIGN "Attributes"). */
export const CORE_ATTRS: Record<PosGroup, string[]> = {
  QB: ["acc", "arm", "mob", "awr"],
  RB: ["run", "pow", "spd", "rec"],
  WR: ["hand", "spd", "rte"],
  TE: ["hand", "spd", "blk"],
  OL: ["pblk", "rblk", "str"],
  DL: ["rush", "stop", "str"],
  LB: ["stop", "blitz", "cov"],
  CB: ["cov", "spd", "ball"],
  S: ["cov", "tkl", "ball"],
  K: ["leg", "kacc"],
  P: ["leg", "kacc"],
};

export function emptyStats(): SeasonStats {
  return {
    gp: 0,
    paYd: 0, paTD: 0, paInt: 0, paAtt: 0, paCmp: 0,
    ruYd: 0, ruTD: 0, ruAtt: 0,
    rec: 0, reYd: 0, reTD: 0,
    tkl: 0, sck: 0, int: 0,
    fgm: 0, fga: 0,
  };
}

/**
 * Synthesize core attrs around an overall: seeded deviations whose mean is
 * zero, so avg(attrs) === ovr and nothing lies about the rating.
 */
export function synthAttrs(g: PosGroup, ovr: number, rng: Rng): Record<string, number> {
  const keys = CORE_ATTRS[g];
  const devs = keys.map(() => (rng() * 2 - 1) * 9);
  const mean = devs.reduce((a, b) => a + b, 0) / devs.length;
  const attrs: Record<string, number> = {};
  keys.forEach((k, i) => {
    attrs[k] = clamp(Math.round(ovr + devs[i] - mean), 40, 99);
  });
  return attrs;
}

/** Hidden dev rating with PRD rarities: 55/30/12/3 across the four tiers. */
export function rollDev(rng: Rng): number {
  const r = rng();
  if (r < 0.03) return rangeInt(rng, 91, 100);
  if (r < 0.15) return rangeInt(rng, 71, 90);
  if (r < 0.45) return rangeInt(rng, 41, 70);
  return rangeInt(rng, 1, 40);
}

export function devTierOf(dev: number): DevTier {
  return dev >= 91 ? 3 : dev >= 71 ? 2 : dev >= 41 ? 1 : 0;
}

/** Potential ceiling from the dev tier (the PRD table, now literally true). */
export function rollCeiling(dev: number, ovr: number, cls: number, rng: Rng): number {
  const tier = devTierOf(dev);
  const band: [number, number] =
    tier === 3 ? [95, 99] : tier === 2 ? [89, 94] : tier === 1 ? [83, 88] : [74, 82];
  const rolled = rangeInt(rng, band[0], band[1]);
  // Never below what the player already is; underclassmen keep some headroom.
  return clamp(Math.max(rolled, ovr + (cls <= 2 ? 3 : 1)), 40, 99);
}

/** Display stars — cosmetic, derived from quality + upside. */
export function starsOf(ovr: number, ceil: number): number {
  if (ovr >= 85 || ceil >= 95) return 5;
  if (ovr >= 75 || ceil >= 89) return 4;
  if (ovr >= 60 || ceil >= 80) return 3;
  return 2;
}

/** Build a runtime Player from a baked real-roster seed. */
export function playerFromSeed(seed: GmPlayerSeed, pid: number, dynastySeed: number): Player {
  const rng = stream(dynastySeed, "import", pid, seed.n);
  const dev = rollDev(rng);
  const ceil = rollCeiling(dev, seed.o, seed.c, rng);
  return {
    id: pid,
    name: seed.n,
    pos: seed.p,
    g: seed.g,
    cls: seed.c,
    ovr: seed.o,
    attrs: synthAttrs(seed.g, seed.o, rng),
    dev,
    devTier: devTierOf(dev),
    ceil,
    stars: starsOf(seed.o, ceil),
    seed: subSeed(dynastySeed, "p", pid),
    inj: 0,
    stats: emptyStats(),
    career: [],
  };
}

/** Generated player (recruit or walk-on filler) at a target overall. */
export function generatePlayer(
  g: PosGroup,
  ovr: number,
  cls: number,
  pid: number,
  rootSeed: number,
  rng: Rng,
): Player {
  const dev = rollDev(rng);
  const ceil = rollCeiling(dev, ovr, cls, rng);
  const pos = g === "CB" || g === "S" ? g : g;
  return {
    id: pid,
    name: genName(rng),
    pos,
    g,
    cls,
    ovr,
    attrs: synthAttrs(g, ovr, rng),
    dev,
    devTier: devTierOf(dev),
    ceil,
    stars: starsOf(ovr, ceil),
    seed: subSeed(rootSeed, "p", pid),
    inj: 0,
    stats: emptyStats(),
    career: [],
  };
}

// ---------------------------------------------------------------------------
// EA-style presentation sheet — pure function of (core attrs, pos, seed).
// Never stored; regenerated on demand so it can't drift from the core.
// ---------------------------------------------------------------------------

export interface SheetEntry {
  label: string;
  value: number;
}

const SHEET_DEFS: Record<PosGroup, [string, string[], number][]> = {
  // label, core attr(s) it leans on, jitter span
  QB: [
    ["Throw Power", ["arm"], 3], ["Short Accuracy", ["acc"], 3], ["Deep Accuracy", ["acc", "arm"], 5],
    ["Throw on Run", ["acc", "mob"], 4], ["Awareness", ["awr"], 2], ["Speed", ["mob"], 4],
    ["Play Action", ["awr", "acc"], 4],
  ],
  RB: [
    ["Speed", ["spd"], 2], ["Acceleration", ["spd"], 4], ["Vision", ["run"], 3],
    ["Break Tackle", ["pow"], 3], ["Carrying", ["run", "pow"], 5], ["Catching", ["rec"], 3],
    ["Juke Move", ["spd", "run"], 5],
  ],
  WR: [
    ["Speed", ["spd"], 2], ["Catching", ["hand"], 3], ["Route Running", ["rte"], 3],
    ["Catch in Traffic", ["hand", "rte"], 5], ["Release", ["rte", "spd"], 4], ["Deep Threat", ["spd", "hand"], 5],
  ],
  TE: [
    ["Catching", ["hand"], 3], ["Speed", ["spd"], 3], ["Run Block", ["blk"], 3],
    ["Catch in Traffic", ["hand"], 4], ["Pass Block", ["blk"], 5],
  ],
  OL: [
    ["Pass Block", ["pblk"], 2], ["Run Block", ["rblk"], 2], ["Strength", ["str"], 3],
    ["Awareness", ["pblk", "rblk"], 4], ["Impact Block", ["str", "rblk"], 5],
  ],
  DL: [
    ["Pass Rush", ["rush"], 2], ["Run Stop", ["stop"], 2], ["Strength", ["str"], 3],
    ["Edge Set", ["stop", "str"], 4], ["Pursuit", ["rush", "stop"], 5],
  ],
  LB: [
    ["Tackle", ["stop"], 2], ["Blitz", ["blitz"], 3], ["Coverage", ["cov"], 3],
    ["Pursuit", ["stop", "blitz"], 4], ["Hit Power", ["stop"], 5],
  ],
  CB: [
    ["Man Coverage", ["cov"], 2], ["Zone Coverage", ["cov"], 4], ["Speed", ["spd"], 2],
    ["Ball Hawk", ["ball"], 3], ["Press", ["cov", "spd"], 5],
  ],
  S: [
    ["Zone Coverage", ["cov"], 3], ["Tackle", ["tkl"], 2], ["Ball Hawk", ["ball"], 3],
    ["Range", ["cov", "tkl"], 4], ["Hit Power", ["tkl"], 5],
  ],
  K: [["Kick Power", ["leg"], 2], ["Kick Accuracy", ["kacc"], 2], ["Clutch", ["kacc"], 6]],
  P: [["Punt Power", ["leg"], 2], ["Punt Placement", ["kacc"], 2], ["Hang Time", ["leg", "kacc"], 4]],
};

/** Expand the presentation sheet. Deterministic per player (seeded jitter). */
export function expandSheet(p: Player): SheetEntry[] {
  const rng = stream(p.seed, "sheet");
  return SHEET_DEFS[p.g].map(([label, keys, span]) => {
    const base = keys.reduce((a, k) => a + (p.attrs[k] ?? p.ovr), 0) / keys.length;
    const jitter = Math.round((rng() * 2 - 1) * span);
    return { label, value: clamp(Math.round(base + jitter), 40, 99) };
  });
}

export const DEV_TIER_LABELS = ["Normal", "Impact", "Star", "Elite"] as const;
export const CLASS_LABELS = ["", "FR", "SO", "JR", "SR"] as const;
