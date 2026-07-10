// Balance harness (§12): Monte Carlo over full drafts using the REAL engines
// and the REAL data.json. Measures the distribution of power scores, tiers,
// outcomes — and above all P(16-0) — under bracketing strategies:
//
//   random — picks a random placeable player each spin, never re-spins.
//            Lower bound: a player mashing buttons.
//   greedy — oracle: always picks the highest hidden_ovr placeable player,
//            re-spins when the pool's best is weak, drafts the best coach.
//            Upper bound: nobody plays better than this.
//
// Real skilled play (stats + name recognition, no OVR visibility) lands
// between the two.
//
// Run: node --no-warnings scripts/balance.ts [runsPerStrategy]
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GameData, Player } from "../src/data/types.ts";
import { mulberry32, type Rng } from "../src/engine/rng.ts";
import {
  allPlayerSlotsFilled,
  eligibleOpenSlots,
  emptyPlayerSlots,
  expandedFallbackSpin,
  isPoolUsable,
  spin,
  spinCoach,
  teamRespin,
  type PlayerSlots,
  type SpinResult,
} from "../src/engine/spin.ts";
import { powerScore, resolveOutcome, tierFor } from "../src/engine/sim.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  readFileSync(join(HERE, "..", "public", "data.json"), "utf8"),
) as GameData;

const RUNS = Number(process.argv[2] ?? 20000);

type Strategy = "random" | "greedy";

function pickPlayer(pool: Player[], slots: PlayerSlots, strategy: Strategy, rng: Rng): Player | null {
  const placeable = pool.filter((p) => eligibleOpenSlots(p, slots).length > 0);
  if (placeable.length === 0) return null;
  if (strategy === "random") return placeable[Math.floor(rng() * placeable.length)];
  return placeable.reduce((a, b) => (b.hidden_ovr > a.hidden_ovr ? b : a));
}

function playOne(strategy: Strategy, rng: Rng) {
  const slots = emptyPlayerSlots();
  let respins = { team: 2, era: 2 };
  let guard = 0;

  while (!allPlayerSlotsFilled(slots) && guard++ < 100) {
    let current: SpinResult | null = spin(data, rng, {});
    // Greedy re-spin rule: burn a team re-spin when the pool's best placeable
    // player is weak (<90 OVR).
    if (strategy === "greedy") {
      while (
        respins.team > 0 &&
        current &&
        (pickPlayer(current.pool, slots, "greedy", rng)?.hidden_ovr ?? 0) < 90
      ) {
        current = teamRespin(data, rng, current);
        respins = { ...respins, team: respins.team - 1 };
      }
    }
    if (!current || !isPoolUsable(current.pool, slots)) {
      current = expandedFallbackSpin(data, rng, slots, current);
      if (!current) break;
    }
    const player = pickPlayer(current.pool, slots, strategy, rng);
    if (!player) continue;
    const open = eligibleOpenSlots(player, slots);
    const slot =
      strategy === "greedy" ? open[0] : open[Math.floor(rng() * open.length)];
    slots[slot] = player;
  }

  const coachSpin = spinCoach(data, rng, {})!;
  const order = { Elite: 3, Great: 2, Standard: 1, "Sub-Par": 0 };
  const coach =
    strategy === "greedy"
      ? coachSpin.pool.reduce((a, b) => (order[b.coach_tier] > order[a.coach_tier] ? b : a))
      : coachSpin.pool[Math.floor(rng() * coachSpin.pool.length)];

  const power = powerScore(slots, coach);
  const { tier, outcome, isDynasty } = resolveOutcome(power, rng);
  return { power, tier, outcome, isDynasty };
}

function runStrategy(strategy: Strategy, seed: number) {
  const rng = mulberry32(seed);
  const tiers: Record<string, number> = {};
  const outcomes: Record<string, number> = {};
  let dynasties = 0;
  let powerSum = 0;
  const powers: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const r = playOne(strategy, rng);
    tiers[r.tier] = (tiers[r.tier] ?? 0) + 1;
    outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
    if (r.isDynasty) dynasties++;
    powerSum += r.power;
    powers.push(r.power);
  }
  powers.sort((a, b) => a - b);
  const pct = (n: number) => ((100 * n) / RUNS).toFixed(1) + "%";
  console.log(`\n== ${strategy} (${RUNS} runs) ==`);
  console.log(
    `  power: mean ${(powerSum / RUNS).toFixed(1)}, p50 ${powers[Math.floor(RUNS * 0.5)].toFixed(1)}, ` +
      `p90 ${powers[Math.floor(RUNS * 0.9)].toFixed(1)}, max ${powers[RUNS - 1].toFixed(1)}`,
  );
  console.log(
    "  tiers: " +
      Object.entries(tiers)
        .sort()
        .map(([t, n]) => `${t} ${pct(n)}`)
        .join(" · "),
  );
  console.log(
    "  outcomes: " +
      ["natty", "semis", "major", "minor", "loss"]
        .map((o) => `${o} ${pct(outcomes[o] ?? 0)}`)
        .join(" · "),
  );
  console.log(`  >>> 16-0 rate: ${pct(outcomes.natty ?? 0)} · dynasty rate: ${pct(dynasties)}`);
}

// Rating-inflation diagnostics on the dataset itself.
const ovrs = data.players.map((p) => p.hidden_ovr).sort((a, b) => a - b);
const share = (t: number) => ((100 * ovrs.filter((o) => o >= t).length) / ovrs.length).toFixed(1) + "%";
console.log(`dataset: ${data.players.length} players`);
console.log(
  `  OVR shares: >=96 ${share(96)} · >=90 ${share(90)} · >=85 ${share(85)} · median ${ovrs[Math.floor(ovrs.length / 2)]}`,
);
const cellBest = new Map<string, number>();
for (const p of data.players) {
  const k = `${p.school_id}|${p.decade}`;
  cellBest.set(k, Math.max(cellBest.get(k) ?? 0, p.hidden_ovr));
}
const bests = [...cellBest.values()].sort((a, b) => a - b);
console.log(
  `  best-of-cell: median ${bests[Math.floor(bests.length / 2)]}, ` +
    `share of cells with a 95+ player: ${((100 * bests.filter((b) => b >= 95).length) / bests.length).toFixed(0)}%`,
);
console.log(`  tier if you avg the top-8 of the whole pool: ${tierFor(ovrs.slice(-8).reduce((a, b) => a + b, 0) / 8)}`);

runStrategy("random", 1234);
runStrategy("greedy", 5678);
