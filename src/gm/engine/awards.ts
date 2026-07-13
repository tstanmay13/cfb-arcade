// Player of the Year — raw stats × team success × brand exposure × the PRD's
// silent user bonus. Cosmetic layer; harness-owned constants.

import type { DynastyState, Player, SeasonStats } from "./types.ts";

function rawValue(s: SeasonStats): number {
  return (
    s.paYd * 0.04 + s.paTD * 6 - s.paInt * 4 +
    s.ruYd * 0.09 + s.ruTD * 6 +
    s.reYd * 0.09 + s.reTD * 6 +
    s.sck * 7 + s.int * 8
  );
}

export interface PoyCandidate {
  player: Player;
  tid: number;
  line: string;
  score: number;
}

function lineFor(p: Player): string {
  const s = p.stats;
  const bits: string[] = [];
  if (s.paYd > 0) bits.push(`${s.paYd} pass yds, ${s.paTD} TD`);
  if (s.ruYd > 200) bits.push(`${s.ruYd} rush yds, ${s.ruTD} TD`);
  if (s.reYd > 200) bits.push(`${s.reYd} rec yds, ${s.reTD} TD`);
  if (s.sck > 3) bits.push(`${s.sck} sacks`);
  if (s.int > 2) bits.push(`${s.int} INT`);
  return bits.join(" · ") || "dominant season";
}

/** Ranked POY race (Heisman-watch news + the award itself). */
export function poyTop(state: DynastyState, n: number): PoyCandidate[] {
  const all: PoyCandidate[] = [];
  for (const team of state.teams) {
    if (!team.p4) continue;
    const winsMult = 1 + team.rec.w / 15;
    const prestigeMult = 1 + (team.prestige - 3) * 0.03;
    const userMult = team.id === state.userTid ? 1.05 : 1;
    for (const pid of team.roster) {
      const p = state.players[pid];
      if (!p) continue;
      const score = rawValue(p.stats) * winsMult * prestigeMult * userMult;
      all.push({ player: p, tid: team.id, line: lineFor(p), score });
    }
  }
  return all.sort((a, b) => b.score - a.score).slice(0, n);
}

export function playerOfTheYear(state: DynastyState): { player: Player; tid: number; line: string } | null {
  return poyTop(state, 1)[0] ?? null;
}
