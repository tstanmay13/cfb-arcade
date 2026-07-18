// The knobs report (`npm run tune`): prints what the CURRENT dials in
// src/engine/tuning.ts actually do — outcome odds by power, the 16-0 bar,
// record tilt, and the spin wheel's landing shares on the real bake — so a
// knob edit can be sanity-checked in seconds. The deep referee for anything
// touching the outcome ramp is still scripts/balance.ts (20k drafts + gates).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameData } from "../src/data/types.ts";
import { outcomeOdds, tiltedLossWeights, OUTCOME_PLAN } from "../src/engine/sim.ts";
import { cellSpinWeight, playerCells } from "../src/engine/spin.ts";
import { MARQUEE_TEAMS, SIM_MATRIX } from "../src/engine/tuning.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const data: GameData = JSON.parse(
  readFileSync(join(HERE, "..", "public", "data.json"), "utf8"),
);

const pct = (x: number, w = 5) => `${(100 * x).toFixed(1)}%`.padStart(w + 1);

console.log("=== OUTCOME DIAL (tuning.ts: RAMP_ANCHORS + SIM_MATRIX) ===");
console.log("power   natty  semis  major  minor   loss");
for (const p of [70, 78, 82, 85, 88, 90, 91, 92, 93, 94, 95, 96, 96.9, SIM_MATRIX.Tier0.min]) {
  const o = outcomeOdds(p);
  console.log(
    String(p).padEnd(6),
    pct(o.natty), pct(o.semis), pct(o.major), pct(o.minor), pct(o.loss),
    p === SIM_MATRIX.Tier0.min ? "  ← Tier0: the 16-0 bar" : "",
  );
}
console.log(
  `\nTier0.min = ${SIM_MATRIX.Tier0.min}: a board at/above it titles ` +
    `${(100 * SIM_MATRIX.Tier0.natty).toFixed(0)}% and a natty rolls ` +
    `${(100 * SIM_MATRIX.Tier0.dynastyChance).toFixed(0)}% dynasty.`,
);

console.log("\n=== RECORD TILT (same outcome, different board) ===");
for (const outcome of ["minor", "major", "semis"] as const) {
  const plan = OUTCOME_PLAN[outcome];
  const line = [80, 86, 91, 95]
    .map((power) => {
      const w = tiltedLossWeights(plan.losses, power);
      const sum = Object.values(w).reduce((a, b) => a + b, 0);
      const best = Object.entries(w).sort((a, b) => b[1] - a[1])[0];
      const wins = plan.games - Number(best[0]);
      return `@${power}: ${wins}-${best[0]} (${((100 * best[1]) / sum).toFixed(0)}%)`;
    })
    .join("   ");
  console.log(`${outcome.padEnd(6)} modal record  ${line}`);
}

console.log("\n=== SPIN WHEEL (tuning.ts: cell weights + marquee) ===");
const cells = playerCells(data);
const weights = cells.map((c) => cellSpinWeight(c, cells));
const total = weights.reduce((a, b) => a + b, 0);
const byEra = new Map<string, number>();
let marqueeShare = 0;
cells.forEach((c, i) => {
  byEra.set(c.era, (byEra.get(c.era) ?? 0) + weights[i]);
  if (MARQUEE_TEAMS.has(c.teamId)) marqueeShare += weights[i];
});
console.log(
  "first-spin landing share by era:",
  [...byEra.entries()]
    .sort()
    .map(([e, w]) => `${e} ${((100 * w) / total).toFixed(1)}%`)
    .join(" · "),
);
console.log(
  `marquee programs (${MARQUEE_TEAMS.size} of ${data.teams.length}): ` +
    `${((100 * marqueeShare) / total).toFixed(1)}% of landings`,
);
const top = cells
  .map((c, i) => ({ key: `${c.era} ${c.teamId}`, p: weights[i] / total }))
  .sort((a, b) => b.p - a.p)
  .slice(0, 10);
console.log("hottest cells:", top.map((t) => `${t.key} ${(100 * t.p).toFixed(2)}%`).join(" · "));

console.log(`
=== PLAYER OVERALLS (bake-time knobs — scripts/lib.ts) ===
OVR_FLOOR / TOP_N / CALIBRATION_BANDS shape who exists and how many 90s+
there are; they require the warehouse + \`npm run build:data\` + committing
the new public/data.json. Current pool: ${data.players.length} players · ` +
  `${data.players.filter((p) => p.hidden_ovr >= 96).length} at 96+ · ` +
  `${data.players.filter((p) => p.hidden_ovr >= 90).length} at 90+.
After ANY outcome-dial change run: node --no-warnings scripts/balance.ts
Gates (ADR-0033): skilled 16-0 in 6-10% · ladder ≥2× and ≥2.2× · fresh table in the ADR.`);
