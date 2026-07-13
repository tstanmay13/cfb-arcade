// v1.0 recruiting: auto-generated national classes allocated by prestige
// gravity (interactive recruiting arrives in v1.1 per the roadmap). Star
// distribution follows CFB_GM_DESIGN "Recruiting" rescaled to class size.

import type { Rng } from "../../engine/rng.ts";
import type { Player, PosGroup, Team } from "./types.ts";
import { generatePlayer } from "./player.ts";
import { rangeInt } from "./streams.ts";

/** Positional shape of a recruiting class (normalized weights). */
const POS_WEIGHTS: [PosGroup, number][] = [
  ["QB", 0.06], ["RB", 0.09], ["WR", 0.13], ["TE", 0.06], ["OL", 0.17],
  ["DL", 0.15], ["LB", 0.11], ["CB", 0.10], ["S", 0.08], ["K", 0.025], ["P", 0.025],
];

function rollStars(rng: Rng): number {
  const r = rng();
  if (r < 0.021) return 5;
  if (r < 0.21) return 4;
  if (r < 0.85) return 3;
  return 2;
}

function ovrForStars(stars: number, rng: Rng): number {
  if (stars === 5) return rangeInt(rng, 66, 77);
  if (stars === 4) return rangeInt(rng, 60, 70);
  if (stars === 3) return rangeInt(rng, 53, 64);
  return rangeInt(rng, 47, 56);
}

function rollPos(rng: Rng): PosGroup {
  const total = POS_WEIGHTS.reduce((a, [, w]) => a + w, 0);
  let roll = rng() * total;
  for (const [g, w] of POS_WEIGHTS) {
    roll -= w;
    if (roll <= 0) return g;
  }
  return "OL";
}

export interface ClassResult {
  /** tid → signed players (already created, cls 1). */
  byTeam: Map<number, Player[]>;
  /** tid → class ranking points (for the report + Elo nudge). */
  points: Map<number, number>;
}

const STAR_POINTS: Record<number, number> = { 5: 10, 4: 4, 3: 1.5, 2: 0.5 };

/**
 * Generate + allocate the national class. `needs` says how many signees each
 * P4 team takes; recruits pick schools best-first, weighted by prestige.
 */
export function generateClasses(
  teams: Team[],
  needs: Map<number, number>,
  nextPidStart: number,
  rootSeed: number,
  rng: Rng,
): ClassResult {
  const total = [...needs.values()].reduce((a, b) => a + b, 0);
  const recruits: { g: PosGroup; ovr: number; stars: number }[] = [];
  for (let i = 0; i < total; i++) {
    const stars = rollStars(rng);
    recruits.push({ g: rollPos(rng), ovr: ovrForStars(stars, rng), stars });
  }
  recruits.sort((a, b) => b.ovr - a.ovr);

  const remaining = new Map(needs);
  const prestigeOf = new Map(teams.map((t) => [t.id, t.prestige]));
  const byTeam = new Map<number, Player[]>();
  const points = new Map<number, number>();
  let pid = nextPidStart;

  for (const r of recruits) {
    const open = [...remaining.entries()].filter(([, n]) => n > 0);
    if (open.length === 0) break;
    // Prestige gravity: blue bloods pull the board's top far more often.
    const weights = open.map(([tid]) => Math.pow((prestigeOf.get(tid) ?? 1) + 0.5, 2.5));
    const totalW = weights.reduce((a, b) => a + b, 0);
    let roll = rng() * totalW;
    let idx = 0;
    for (; idx < open.length - 1; idx++) {
      roll -= weights[idx];
      if (roll <= 0) break;
    }
    const tid = open[idx][0];
    remaining.set(tid, remaining.get(tid)! - 1);
    const player = generatePlayer(r.g, r.ovr, 1, pid++, rootSeed, rng);
    byTeam.set(tid, [...(byTeam.get(tid) ?? []), player]);
    points.set(tid, (points.get(tid) ?? 0) + STAR_POINTS[r.stars]);
  }

  return { byTeam, points };
}
