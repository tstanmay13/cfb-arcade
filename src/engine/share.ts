// Copy-pasteable, Wordle-style text summary of a finished run (§10 companion to
// the rasterized share card). Pure and deterministic from the resolved season —
// no React/DOM dependency — so it lives in the engine and is unit-tested.
import type { Resolved } from "./resolve.ts";
import type { Outcome, ScheduledGame } from "./sim.ts";

/** Compact outcome labels for the text share (the image card keeps its own,
    longer ones). */
const BANNER: Record<Outcome, string> = {
  natty: "NATIONAL CHAMPIONS 🏆",
  semis: "NATIONAL SEMIFINALISTS",
  major: "PLAYOFF QUARTERFINALISTS",
  minor: "WON THE BOWL",
  loss: "REBUILDING YEAR",
};

/** The "Wordle grid": one square per game, in order.
    🟩 regular-season win · 🟨 postseason win · 🟥 loss (anywhere). */
export function gameGrid(schedule: ScheduledGame[]): string {
  return schedule
    .map((g) => (g.result === "LOSS" ? "🟥" : g.phase === "REG" ? "🟩" : "🟨"))
    .join("");
}

export interface ShareTextOpts {
  /** Program the player is repping (their favorite team). */
  teamName: string;
  /** Scout mode + a Tier 0/1 finish — earns the "called it" badge. */
  scoutVerified: boolean;
}

/**
 * Build the multi-line text a player copies to the clipboard. Spoiler-light and
 * self-contained (no URL, à la Wordle) so it pastes cleanly into any DM/post.
 */
export function buildShareText(resolved: Resolved, opts: ShareTextOpts): string {
  const lines: string[] = [
    "🏈 THE 16-0 DRAFT",
    opts.teamName,
    `${resolved.record} · ${BANNER[resolved.outcome]}`,
    gameGrid(resolved.schedule),
  ];

  const stats = [`Team OVR ${Math.round(resolved.power)}`];
  if (resolved.heisman) stats.push(`Heisman: ${resolved.heisman.name}`);
  const aa = resolved.allAmericans.length;
  if (aa > 0) stats.push(`${aa} All-American${aa === 1 ? "" : "s"}`);
  lines.push(stats.join(" · "));

  if (resolved.isDynasty) lines.push("★ DYNASTY ★");
  if (opts.scoutVerified) lines.push("🔍 Scout Verified");

  return lines.join("\n");
}
