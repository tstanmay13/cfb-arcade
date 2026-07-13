// Depth chart selection + the six macro-trait pairs (CFB_GM_DESIGN "Sim
// engine spec"). Traits are the only thing the drive engine reads; P4 teams
// derive them from starters' core attrs, shells from a flat Elo-derived value.

import type { Player, PosGroup } from "./types.ts";
import { clamp } from "./streams.ts";

// QB carries the backup too (watch-mode spark swap); only QB1 "plays" unless
// the swap fires — see GameSim.rollInjuries.
export const LINEUP_COUNTS: [PosGroup, number][] = [
  ["QB", 2], ["RB", 2], ["WR", 3], ["TE", 1], ["OL", 5],
  ["DL", 4], ["LB", 3], ["CB", 2], ["S", 2], ["K", 1], ["P", 1],
];

export type Lineup = Partial<Record<PosGroup, Player[]>>;

/** Healthy best-available starters per group; user pins take priority. */
export function selectLineup(roster: Player[], pins?: number[]): Lineup {
  const healthy = roster.filter((p) => p.inj === 0);
  const pinned = new Set(pins ?? []);
  const lineup: Lineup = {};
  for (const [g, n] of LINEUP_COUNTS) {
    lineup[g] = healthy
      .filter((p) => p.g === g)
      .sort(
        (a, b) =>
          Number(pinned.has(b.id)) - Number(pinned.has(a.id)) || b.ovr - a.ovr,
      )
      .slice(0, n);
  }
  return lineup;
}

export interface Traits {
  airO: number;
  gndO: number;
  prot: number;
  sec: number;
  rzO: number;
  st: number;
  airD: number;
  gndD: number;
  havoc: number;
  hunt: number;
  rzD: number;
  /** Display team overall (starter average). */
  ovr: number;
}

function avg(players: Player[] | undefined, f: (p: Player) => number, fallback: number): number {
  if (!players || players.length === 0) return fallback;
  return players.reduce((a, p) => a + f(p), 0) / players.length;
}

const a = (p: Player, k: string) => p.attrs[k] ?? p.ovr;

/** Macro traits from a P4 depth chart. */
export function traitsFromLineup(lu: Lineup): Traits {
  const FB = 45; // emergency fallback when a slot is empty
  const qb = lu.QB?.[0];
  const qbc = qb ? a(qb, "acc") * 0.4 + a(qb, "arm") * 0.25 + a(qb, "awr") * 0.2 + a(qb, "mob") * 0.15 : FB;
  const wrc = avg(lu.WR, (p) => a(p, "hand") * 0.5 + a(p, "spd") * 0.3 + a(p, "rte") * 0.2, FB);
  const tec = avg(lu.TE, (p) => a(p, "hand") * 0.6 + a(p, "blk") * 0.4, FB);
  const rb = lu.RB?.[0];
  const rbc = rb ? a(rb, "run") * 0.5 + a(rb, "pow") * 0.25 + a(rb, "spd") * 0.25 : FB;
  const olPass = avg(lu.OL, (p) => a(p, "pblk"), FB);
  const olRun = avg(lu.OL, (p) => a(p, "rblk"), FB);
  const dlRush = avg(lu.DL, (p) => a(p, "rush"), FB);
  const dlStop = avg(lu.DL, (p) => a(p, "stop"), FB);
  const lbStop = avg(lu.LB, (p) => a(p, "stop"), FB);
  const lbBlitz = avg(lu.LB, (p) => a(p, "blitz"), FB);
  const lbCov = avg(lu.LB, (p) => a(p, "cov"), FB);
  const cbCov = avg(lu.CB, (p) => a(p, "cov"), FB);
  const sCov = avg(lu.S, (p) => a(p, "cov") * 0.6 + a(p, "ball") * 0.4, FB);
  const sTkl = avg(lu.S, (p) => a(p, "tkl"), FB);
  const dbBall = avg([...(lu.CB ?? []), ...(lu.S ?? [])], (p) => a(p, "ball"), FB);
  const k = lu.K?.[0];
  const kc = k ? a(k, "kacc") * 0.6 + a(k, "leg") * 0.4 : FB;
  const retSpd = Math.max(
    avg(lu.WR?.slice(0, 1), (p) => a(p, "spd"), FB),
    avg(lu.RB?.slice(1, 2), (p) => a(p, "spd"), FB),
  );

  const starters = ([] as Player[]).concat(...LINEUP_COUNTS.map(([g]) => lu[g] ?? []));
  const ovr = avg(starters, (p) => p.ovr, FB);

  return {
    airO: 0.4 * qbc + 0.32 * wrc + 0.08 * tec + 0.2 * olPass,
    gndO: 0.45 * rbc + 0.45 * olRun + 0.1 * qbc,
    prot: olPass,
    sec: qb ? 0.6 * a(qb, "awr") + 0.4 * rbc : FB,
    rzO: 0.45 * qbc + 0.3 * rbc + 0.25 * tec,
    st: 0.65 * kc + 0.35 * retSpd,
    airD: 0.5 * cbCov + 0.32 * sCov + 0.18 * lbCov,
    gndD: 0.5 * dlStop + 0.38 * lbStop + 0.12 * sTkl,
    havoc: 0.62 * dlRush + 0.38 * lbBlitz,
    hunt: 0.6 * dbBall + 0.25 * lbCov + 0.15 * dlRush,
    rzD: 0.5 * dlStop + 0.3 * lbStop + 0.2 * sCov,
    ovr: Math.round(ovr),
  };
}

/** Flat trait vector for shell opponents, from Elo alone. */
export function traitsFromElo(elo: number): Traits {
  const v = clamp((elo - 950) / 9, 25, 92);
  return {
    airO: v, gndO: v, prot: v, sec: v, rzO: v, st: v,
    airD: v, gndD: v, havoc: v, hunt: v, rzD: v,
    ovr: Math.round(v),
  };
}
