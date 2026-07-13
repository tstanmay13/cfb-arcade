// The displayed Top 25: Elo core + poll-bias layer (inertia, undefeated
// bonus). Flavor only — CFP selection uses committee rank in postseason.ts.

import type { PollEntry, Team } from "./types.ts";

export function computePoll(teams: Team[], prev: PollEntry[]): PollEntry[] {
  const prevRank = new Map(prev.map((e, i) => [e.tid, i + 1]));
  const scored = teams
    .filter((t) => t.p4)
    .map((t) => {
      const games = t.rec.w + t.rec.l;
      let score = t.elo + 24 * t.rec.w - 15 * t.rec.l;
      if (games >= 3 && t.rec.l === 0) score += 35; // undefeateds don't fall for winning ugly
      const pr = prevRank.get(t.id);
      if (pr) score += (26 - pr) * 2.2; // inertia
      return { tid: t.id, score };
    })
    .sort((x, y) => y.score - x.score)
    .slice(0, 25);
  return scored.map((s) => ({ tid: s.tid, prev: prevRank.get(s.tid) ?? 0 }));
}

/** Committee order for CFP selection: Elo with a nudge for résumé. */
export function committeeOrder(teams: Team[]): number[] {
  return teams
    .filter((t) => t.p4)
    .map((t) => ({ tid: t.id, score: t.elo + 12 * t.rec.w - 10 * t.rec.l }))
    .sort((x, y) => y.score - x.score)
    .map((s) => s.tid);
}
