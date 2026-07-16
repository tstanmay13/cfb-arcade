// Scheme & scheme-fit layer (M1.2). Team identity is set by the coordinators:
// the OC's offensive scheme and DC's defensive scheme reshape the six macro
// traits (CFB_GM_DESIGN "Sim engine spec"). Schemes are stylistic REALLOCATION
// (roughly zero-sum, so league scoring stays calibrated), and per-position
// scheme fit — how a roster's attribute shape matches its scheme's emphasis —
// adds a small, zero-centered execution bonus. Pure; no React, no RNG.

import type { PosGroup } from "./types.ts";
import type { Lineup, Traits } from "./lineup.ts";
import { clamp } from "./streams.ts";

export type OffScheme = "pro" | "airraid" | "spread" | "ground" | "westcoast";
export type DefScheme = "base43" | "multiple34" | "blitz" | "nickel";

export const OFF_SCHEMES: OffScheme[] = ["pro", "airraid", "spread", "ground", "westcoast"];
export const DEF_SCHEMES: DefScheme[] = ["base43", "multiple34", "blitz", "nickel"];

export const OFF_LABELS: Record<OffScheme, string> = {
  pro: "Pro Style",
  airraid: "Air Raid",
  spread: "Spread Option",
  ground: "Ground & Pound",
  westcoast: "West Coast",
};
export const DEF_LABELS: Record<DefScheme, string> = {
  base43: "4-3 Base",
  multiple34: "3-4 Multiple",
  blitz: "Aggressive Blitz",
  nickel: "4-2-5 Nickel",
};

type TraitKey = keyof Traits;

// Reallocation multipliers, centered on 1.0 — each scheme trades emphasis
// between traits rather than adding raw power (keeps scoring bands stable).
const OFF_MULT: Record<OffScheme, Partial<Record<TraitKey, number>>> = {
  pro: {},
  airraid: { airO: 1.08, gndO: 0.9, prot: 1.02, rzO: 0.98 },
  spread: { gndO: 1.06, airO: 0.96, sec: 1.02 },
  ground: { gndO: 1.1, airO: 0.88, prot: 1.03, rzO: 1.02 },
  westcoast: { airO: 1.03, sec: 1.04, gndO: 0.97 },
};
const DEF_MULT: Record<DefScheme, Partial<Record<TraitKey, number>>> = {
  base43: {},
  multiple34: { havoc: 1.05, gndD: 1.02, airD: 0.97 },
  blitz: { havoc: 1.1, airD: 0.92, hunt: 1.03 },
  nickel: { airD: 1.07, havoc: 0.98, gndD: 0.95 },
};

// Which (position, attribute) a scheme leans on — a roster whose starters carry
// those attrs ABOVE their overall "fits", and executes a touch better.
const OFF_FIT: Record<OffScheme, { g: PosGroup; k: string }[]> = {
  pro: [{ g: "QB", k: "awr" }, { g: "OL", k: "pblk" }],
  airraid: [{ g: "WR", k: "spd" }, { g: "QB", k: "arm" }],
  spread: [{ g: "QB", k: "mob" }, { g: "RB", k: "spd" }],
  ground: [{ g: "OL", k: "rblk" }, { g: "RB", k: "pow" }],
  westcoast: [{ g: "WR", k: "rte" }, { g: "QB", k: "acc" }],
};
const DEF_FIT: Record<DefScheme, { g: PosGroup; k: string }[]> = {
  base43: [{ g: "DL", k: "stop" }, { g: "LB", k: "stop" }],
  multiple34: [{ g: "LB", k: "blitz" }, { g: "DL", k: "rush" }],
  blitz: [{ g: "LB", k: "blitz" }, { g: "S", k: "cov" }],
  nickel: [{ g: "CB", k: "cov" }, { g: "S", k: "cov" }],
};

/**
 * One player's fit for a scheme pair, -1..1 (M1.2 player detail). Neutral (0)
 * when the player's position isn't one the scheme leans on.
 */
export function playerSchemeFit(
  p: { g: PosGroup; ovr: number; attrs: Record<string, number> },
  off: OffScheme,
  def: DefScheme,
): number {
  const keys = [...OFF_FIT[off], ...DEF_FIT[def]].filter((e) => e.g === p.g);
  if (keys.length === 0) return 0;
  const sum = keys.reduce((a, { k }) => a + ((p.attrs[k] ?? p.ovr) - p.ovr), 0);
  return clamp(sum / keys.length / 15, -1, 1);
}

/** -1..1: how far the starters' scheme-key attrs sit above (or below) their OVR. */
export function schemeFit(lu: Lineup, keys: { g: PosGroup; k: string }[]): number {
  let sum = 0;
  let n = 0;
  for (const { g, k } of keys) {
    for (const p of lu[g] ?? []) {
      sum += (p.attrs[k] ?? p.ovr) - p.ovr;
      n++;
    }
  }
  if (n === 0) return 0;
  return clamp(sum / n / 15, -1, 1);
}

/**
 * Apply a team's schemes to its macro traits: reallocation (zero-sum-ish) +
 * a small zero-centered fit bonus. The fit magnitude is deliberately tiny so
 * that, league-wide, well-fit and poorly-fit rosters wash out and the scoring
 * calibration is preserved — but an individual matchup can tilt on it.
 */
export function applySchemes(t: Traits, off: OffScheme, def: DefScheme, lu: Lineup): Traits {
  const out = { ...t };
  for (const [k, m] of Object.entries(OFF_MULT[off])) out[k as TraitKey] *= m;
  for (const [k, m] of Object.entries(DEF_MULT[def])) out[k as TraitKey] *= m;
  const offFit = schemeFit(lu, OFF_FIT[off]);
  const defFit = schemeFit(lu, DEF_FIT[def]);
  out.airO += offFit * 1.0;
  out.gndO += offFit * 1.0;
  out.airD += defFit * 1.0;
  out.havoc += defFit * 1.0;
  return out;
}
