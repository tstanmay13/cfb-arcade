// Offseason player movement: ceiling-based progression (no league OVR
// inflation by construction), graduation, and NFL draft departures.

import type { Rng } from "../../engine/rng.ts";
import type { Player } from "./types.ts";
import { clamp } from "./streams.ts";

/** Facility/program multiplier from prestige (1★ 0.95 … 6★ 1.20). */
export function facilityMult(prestige: number): number {
  return 0.9 + prestige * 0.05;
}

/**
 * Grow a player toward their hidden ceiling. Gains are big early and taper
 * as the gap closes; dev rating scales the fraction of the gap claimed.
 * Mutates ovr + attrs coherently (attrs shift by the same delta).
 */
export function progressPlayer(p: Player, facMult: number, rng: Rng): number {
  const gap = Math.max(0, p.ceil - p.ovr);
  const raw = gap * (0.22 + p.dev / 240) * facMult + (rng() * 2.5 - 1);
  const gain = clamp(Math.round(raw), 0, gap);
  if (gain > 0) {
    p.ovr += gain;
    for (const k of Object.keys(p.attrs)) {
      p.attrs[k] = clamp(p.attrs[k] + gain, 40, 99);
    }
  }
  return gain;
}

/**
 * NFL draft declarations among draft-eligible underclassmen (cls 3). Seniors
 * graduate unconditionally. `nationalRank` is the player's ovr rank among all
 * draft-eligible players (cls >= 3), 1-based.
 */
export function declaresForDraft(nationalRank: number, rng: Rng): boolean {
  const p = nationalRank <= 32 ? 0.92 : nationalRank <= 100 ? 0.55 : nationalRank <= 224 ? 0.25 : 0.04;
  return rng() < p;
}
