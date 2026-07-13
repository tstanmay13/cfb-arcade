// Shareable season recap (quick-wins pass): pure text builder, copied to the
// clipboard from the offseason report. Same spirit as the draft's §10 share.

import type { DynastyState } from "./types.ts";

export const DIFFICULTY_LABELS = ["Normal", "Hard", "Brutal"];

export function buildSeasonRecap(state: DynastyState): string {
  const user = state.teams[state.userTid];
  const honors = state.honors[state.honors.length - 1];
  const games = state.results
    .filter((r) => r.home === state.userTid || r.away === state.userTid)
    .sort((a, b) => a.week - b.week);
  const grid = games
    .map((r) => {
      const won = (r.home === state.userTid && r.hs > r.as) || (r.away === state.userTid && r.as > r.hs);
      const post = r.kind !== "reg";
      return post ? (won ? "🟨" : "🟧") : won ? "🟩" : "🟥";
    })
    .join("");

  const champs = state.cfp?.champion === state.userTid;
  const met = state.mandates.filter((m) => m.met).length;
  const lines = [
    `🏈 CFB-GM · ${user.school} · ${honors?.season ?? state.season} (Year ${state.year}, ${DIFFICULTY_LABELS[state.difficulty] ?? "Normal"})`,
    grid,
    `${honors?.userRecord ?? `${user.rec.w}-${user.rec.l}`}${honors?.userPollRank ? ` · finished #${honors.userPollRank}` : ""}${champs ? " · 🏆 NATIONAL CHAMPIONS" : ""}`,
    `Class #${state.offseason?.classRank ?? "?"} · Boosters: ${met}/${state.mandates.length || 0} mandates met`,
  ];
  return lines.join("\n");
}
