// Balance harness (§12): Monte Carlo over full drafts using the REAL engines
// and the REAL data.json. Measures power scores, tiers, and — exactly, with no
// outcome-roll noise — the expected outcome and final-record distributions
// under three bracketing policies:
//
//   random  — picks a random placeable player each spin; never spends a
//             re-spin or keep-team token. The floor: true button-mashing.
//   skilled — sees ONLY what a human sees: the 5 visible stats (ranked by a
//             sign-corrected per-position percentile composite) and coach
//             tiers. Spends team/era re-spins on weak pools, era-fishes a kept
//             team toward its best window, mines stacked cells with keep-team
//             tokens, re-spins Standard-or-worse coach pools. The human
//             ceiling for stat-reading play.
//   greedy  — the oracle: identical decision skeleton, but reads hidden_ovr
//             directly. Nobody plays better than this.
//
// Modeled economy (mirrors src/state/store.tsx): 8 draft spins with the
// previous cell excluded, 2 team re-spins (keep era), 2 era re-spins (keep
// team), 2 keep-team tokens (lock the NEXT spin to the just-drafted cell),
// coach spin + re-spins funded by leftover team/era tokens. NOT modeled:
// Scout mode's extra information, and human slot juggling beyond
// first-eligible placement.
//
// The expected-record accounting accumulates outcomeOdds(power) ×
// OUTCOME_PLAN loss weights per draft, so record shares are exact given the
// drafted boards — re-runs differ only through draft randomness.
//
// Decision thresholds are the tunable constants below. Retune RAMP_ANCHORS
// only with this harness in hand; quote its numbers in the ADR.
//
// Run: node --no-warnings scripts/balance.ts [runsPerStrategy] [dumpPowersPath]
// The optional second arg writes each policy's raw power samples to a JSON
// file — outcome odds are a pure function of power, so RAMP_ANCHORS
// candidates can then be evaluated offline without re-drafting.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Coach, CoachTier, GameData, GamePosition, Player } from "../src/data/types.ts";
import { pearson } from "./lib.ts";
import { mulberry32, type Rng } from "../src/engine/rng.ts";
import {
  allPlayerSlotsFilled,
  eligibleOpenSlots,
  emptyPlayerSlots,
  eraRespin,
  expandedFallbackSpin,
  isPoolUsable,
  spin,
  spinCoach,
  teamRespin,
  type CoachSpinResult,
  type PlayerSlots,
  type SpinResult,
} from "../src/engine/spin.ts";
import {
  OUTCOME_PLAN,
  outcomeOdds,
  powerScore,
  SIM_MATRIX,
  tierFor,
  tiltedLossWeights,
  type Outcome,
} from "../src/engine/sim.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(
  readFileSync(join(HERE, "..", "public", "data.json"), "utf8"),
) as GameData;

const RUNS = Number(process.argv[2] ?? 20000);
const DUMP_PATH = process.argv[3];

type Strategy = "random" | "skilled" | "greedy";

// ---------------------------------------------------------------------------
// Policy thresholds (tunable). greedy thinks in OVR points, skilled in
// composite percentile points — same skeleton, different units.
// ---------------------------------------------------------------------------
const WEAK_BAR = { greedy: 90, skilled: 0.88 }; // re-spin when best placeable is below
const ERA_GAIN = { greedy: 3, skilled: 0.03 }; // era-fish when another window beats here by
const KEEP_NEXT = { greedy: 93, skilled: 0.9 }; // arm keep-team when the cell still holds
/** Re-spin the coach pool while its best tier is at or below this. */
const COACH_RESPIN_AT_OR_BELOW: CoachTier = "Standard";

// ---------------------------------------------------------------------------
// Skilled valuation: what a human can actually read off the card. Per
// position, each of the 5 visible stats gets a Spearman sign vs hidden_ovr
// (interceptions correlate negatively; sign-correcting is the "knowing ball"
// step), then a player's value is the mean of his sign-corrected percentile
// ranks. §12 guarantees the correlation exists; this measures its ceiling.
// ---------------------------------------------------------------------------
const STAT_KEYS = ["stat_1", "stat_2", "stat_3", "stat_4", "stat_5"] as const;

function ranks(xs: number[]): number[] {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const out = new Array<number>(xs.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && xs[idx[j + 1]] === xs[idx[i]]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) out[idx[k]] = avg;
    i = j + 1;
  }
  return out;
}

const spearman = (xs: number[], ys: number[]): number => pearson(ranks(xs), ranks(ys));

function lowerBound(arr: number[], v: number): number {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(arr: number[], v: number): number {
  let lo = 0,
    hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Mid-rank percentile of v within sorted — ties land mid-bucket. */
const pctRank = (sorted: number[], v: number): number =>
  (lowerBound(sorted, v) + upperBound(sorted, v)) / (2 * sorted.length);

interface SkilledModel {
  value: (p: Player) => number;
  /** Per-position Spearman of the composite vs hidden_ovr (§12 diagnostic). */
  fidelity: [GamePosition, number][];
}

function buildSkilledModel(pool: Player[]): SkilledModel {
  const byPos = new Map<GamePosition, Player[]>();
  for (const p of pool) {
    const list = byPos.get(p.primary_position) ?? [];
    if (list.length === 0) byPos.set(p.primary_position, list);
    list.push(p);
  }
  const tables = new Map<GamePosition, { signs: number[]; sorted: number[][] }>();
  for (const [pos, players] of byPos) {
    const ovrs = players.map((p) => p.hidden_ovr);
    const signs: number[] = [];
    const sorted: number[][] = [];
    for (const key of STAT_KEYS) {
      const xs = players.map((p) => p.stats[key]);
      signs.push(spearman(xs, ovrs) >= 0 ? 1 : -1);
      sorted.push([...xs].sort((a, b) => a - b));
    }
    tables.set(pos, { signs, sorted });
  }
  const cache = new Map<string, number>();
  const value = (p: Player): number => {
    const hit = cache.get(p.player_id);
    if (hit !== undefined) return hit;
    const t = tables.get(p.primary_position)!;
    let sum = 0;
    for (let i = 0; i < STAT_KEYS.length; i++) {
      const pct = pctRank(t.sorted[i], p.stats[STAT_KEYS[i]]);
      sum += t.signs[i] > 0 ? pct : 1 - pct;
    }
    const v = sum / STAT_KEYS.length;
    cache.set(p.player_id, v);
    return v;
  };
  const fidelity: [GamePosition, number][] = [...byPos.entries()].map(([pos, players]) => [
    pos,
    spearman(players.map((p) => value(p)), players.map((p) => p.hidden_ovr)),
  ]);
  return { value, fidelity };
}

const skilledModel = buildSkilledModel(data.players);

// ---------------------------------------------------------------------------
// Draft policies
// ---------------------------------------------------------------------------
const TIER_ORDER: Record<CoachTier, number> = { Elite: 3, Great: 2, Standard: 1, "Sub-Par": 0 };

/** Cells per team, precomputed once for era-fishing lookups. */
const teamCells = new Map<string, Map<string, Player[]>>();
for (const p of data.players) {
  const eras = teamCells.get(p.school_id) ?? new Map<string, Player[]>();
  if (eras.size === 0) teamCells.set(p.school_id, eras);
  const cell = eras.get(p.decade) ?? [];
  if (cell.length === 0) eras.set(p.decade, cell);
  cell.push(p);
}

interface Tokens {
  team: number;
  era: number;
  keep: number;
}

interface DraftDiag {
  teamUsed: number;
  eraUsed: number;
  keepUsed: number;
  fallbacks: number;
}

function playOne(strategy: Strategy, rng: Rng): { power: number; diag: DraftDiag } {
  const valuer = strategy === "greedy" ? (p: Player) => p.hidden_ovr : skilledModel.value;
  const bestPlaceable = (
    pool: Player[],
    slots: PlayerSlots,
  ): { player: Player | null; value: number } => {
    let best: Player | null = null;
    let bestV = -Infinity;
    for (const p of pool) {
      if (eligibleOpenSlots(p, slots).length === 0) continue;
      const v = valuer(p);
      if (v > bestV) {
        best = p;
        bestV = v;
      }
    }
    return { player: best, value: bestV };
  };
  const bestOtherEra = (teamId: string, era: string, slots: PlayerSlots): number => {
    let best = -Infinity;
    for (const [cellEra, players] of teamCells.get(teamId) ?? []) {
      if (cellEra === era) continue;
      const v = bestPlaceable(players, slots).value;
      if (v > best) best = v;
    }
    return best;
  };

  const slots = emptyPlayerSlots();
  const tokens: Tokens = { team: 2, era: 2, keep: 2 };
  const diag: DraftDiag = { teamUsed: 0, eraUsed: 0, keepUsed: 0, fallbacks: 0 };
  let prev: SpinResult | null = null;
  let sticky: { teamId: string; era: Player["decade"] } | null = null;
  let guard = 0;

  while (!allPlayerSlotsFilled(slots) && guard++ < 100) {
    let current: SpinResult;
    if (sticky) {
      // Keep-team token: the next spin is locked to the just-drafted cell.
      current = spin(data, rng, { teamId: sticky.teamId, decade: sticky.era });
      sticky = null;
    } else {
      current = spin(data, rng, { exclude: prev });
    }

    if (strategy !== "random") {
      const weakBar = WEAK_BAR[strategy];
      const eraGain = ERA_GAIN[strategy];
      let redecide = 0;
      while (redecide++ < 8) {
        const here = bestPlaceable(current.pool, slots).value;
        if (here >= weakBar) break;
        // Era-fish first: keep the program, hunt its better window.
        if (tokens.era > 0 && bestOtherEra(current.teamId, current.era, slots) > here + eraGain) {
          const next = eraRespin(data, rng, current);
          if (next) {
            current = next;
            tokens.era--;
            diag.eraUsed++;
            continue;
          }
        }
        if (tokens.team > 0) {
          current = teamRespin(data, rng, current);
          tokens.team--;
          diag.teamUsed++;
          continue;
        }
        break;
      }
    }

    if (!isPoolUsable(current.pool, slots)) {
      const fb = expandedFallbackSpin(data, rng, slots, current);
      if (!fb) break;
      current = fb;
      diag.fallbacks++;
    }

    // Pick + place.
    let player: Player | null;
    if (strategy === "random") {
      const placeable = current.pool.filter((p) => eligibleOpenSlots(p, slots).length > 0);
      player = placeable.length > 0 ? placeable[Math.floor(rng() * placeable.length)] : null;
    } else {
      player = bestPlaceable(current.pool, slots).player;
    }
    if (!player) {
      prev = current;
      continue;
    }
    const open = eligibleOpenSlots(player, slots);
    const slot = strategy === "random" ? open[Math.floor(rng() * open.length)] : open[0];

    // Keep-team decision (arm before placing, §5.2): mine the cell again when
    // what remains after this pick is still stacked.
    if (strategy !== "random" && tokens.keep > 0) {
      const after = { ...slots, [slot]: player };
      if (!allPlayerSlotsFilled(after)) {
        const remaining = current.pool.filter((p) => p !== player);
        if (bestPlaceable(remaining, after).value >= KEEP_NEXT[strategy]) {
          sticky = { teamId: current.teamId, era: current.era };
          tokens.keep--;
          diag.keepUsed++;
        }
      }
    }

    slots[slot] = player;
    prev = current;
  }

  // Coach spin (§5.5) + re-spins funded by leftover team/era tokens.
  let coachSpin = spinCoach(data, rng, {})!;
  if (strategy !== "random") {
    const bestTier = (c: CoachSpinResult): CoachTier =>
      c.pool.reduce((a, b) => (TIER_ORDER[b.coach_tier] > TIER_ORDER[a.coach_tier] ? b : a))
        .coach_tier;
    let redecide = 0;
    while (
      redecide++ < 4 &&
      TIER_ORDER[bestTier(coachSpin)] <= TIER_ORDER[COACH_RESPIN_AT_OR_BELOW]
    ) {
      let next: CoachSpinResult | null = null;
      if (tokens.team > 0) {
        next = spinCoach(data, rng, { decade: coachSpin.era, exclude: coachSpin });
        tokens.team--;
        diag.teamUsed++;
      } else if (tokens.era > 0) {
        next = spinCoach(data, rng, { teamId: coachSpin.teamId, exclude: coachSpin });
        tokens.era--;
        diag.eraUsed++;
      } else break;
      if (!next) break;
      coachSpin = next; // a re-spin replaces the pool — the gamble is real
    }
  }
  let coach: Coach;
  if (strategy === "random") {
    coach = coachSpin.pool[Math.floor(rng() * coachSpin.pool.length)];
  } else {
    coach = coachSpin.pool.reduce((a, b) =>
      TIER_ORDER[b.coach_tier] > TIER_ORDER[a.coach_tier] ? b : a,
    );
  }

  return { power: powerScore(slots, coach), diag };
}

// ---------------------------------------------------------------------------
// Exact expected-outcome accounting + reporting
// ---------------------------------------------------------------------------
const OUTCOME_KEYS: Outcome[] = ["natty", "semis", "major", "minor", "loss"];

function runStrategy(strategy: Strategy, seed: number) {
  const rng = mulberry32(seed);
  const tiers: Record<string, number> = {};
  const expOutcome: Record<Outcome, number> = { natty: 0, semis: 0, major: 0, minor: 0, loss: 0 };
  const expRecord = new Map<string, number>();
  let expDynasty = 0;
  const powers: number[] = [];
  const totals: DraftDiag = { teamUsed: 0, eraUsed: 0, keepUsed: 0, fallbacks: 0 };

  for (let i = 0; i < RUNS; i++) {
    const { power, diag } = playOne(strategy, rng);
    tiers[tierFor(power)] = (tiers[tierFor(power)] ?? 0) + 1;
    powers.push(power);
    const odds = outcomeOdds(power);
    for (const o of OUTCOME_KEYS) {
      expOutcome[o] += odds[o];
      const plan = OUTCOME_PLAN[o];
      // ADR-0032: the engine tilts the loss draw by power — mirror it exactly.
      const tilted = tiltedLossWeights(plan.losses, power);
      const norm = Object.values(tilted).reduce((a, b) => a + b, 0);
      for (const [lossStr, w] of Object.entries(tilted)) {
        const losses = Number(lossStr);
        const rec = `${plan.games - losses}-${losses}`;
        expRecord.set(rec, (expRecord.get(rec) ?? 0) + (odds[o] * w) / norm);
      }
    }
    // ADR-0032: Tier0 no longer auto-natties — dynasty rides on the natty roll.
    if (power >= SIM_MATRIX.Tier0.min) expDynasty += odds.natty * SIM_MATRIX.Tier0.dynastyChance;
    totals.teamUsed += diag.teamUsed;
    totals.eraUsed += diag.eraUsed;
    totals.keepUsed += diag.keepUsed;
    totals.fallbacks += diag.fallbacks;
  }

  powers.sort((a, b) => a - b);
  const pct = (n: number) => ((100 * n) / RUNS).toFixed(1) + "%";
  const pct2 = (n: number) => ((100 * n) / RUNS).toFixed(2) + "%";
  console.log(`\n== ${strategy} (${RUNS} drafts, exact outcome accounting) ==`);
  console.log(
    `  power: mean ${(powers.reduce((a, b) => a + b, 0) / RUNS).toFixed(1)}, ` +
      `p50 ${powers[Math.floor(RUNS * 0.5)].toFixed(1)}, ` +
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
    "  outcomes: " + OUTCOME_KEYS.map((o) => `${o} ${pct2(expOutcome[o])}`).join(" · "),
  );
  const records = [...expRecord.entries()].sort((a, b) => b[1] - a[1]);
  const live = records.filter(([, n]) => n / RUNS > 0.02);
  const maxNonWin = records.find(([r]) => r !== "16-0");
  console.log(
    "  records: " +
      records
        .filter(([, n]) => n / RUNS >= 0.01)
        .map(([r, n]) => `${r} ${pct(n)}`)
        .join(" · "),
  );
  console.log(
    `  gates: records >2% share: ${live.length} · max non-win record: ` +
      `${maxNonWin ? `${maxNonWin[0]} at ${pct(maxNonWin[1])}` : "—"}`,
  );
  console.log(
    `  spent/draft: team ${(totals.teamUsed / RUNS).toFixed(2)} · era ${(totals.eraUsed / RUNS).toFixed(2)} · ` +
      `keep ${(totals.keepUsed / RUNS).toFixed(2)} · fallbacks ${(totals.fallbacks / RUNS).toFixed(3)}`,
  );
  console.log(
    `  >>> 16-0 rate: ${pct2(expOutcome.natty)} · expected dynasty: ${pct2(expDynasty)}`,
  );
  return { natty: expOutcome.natty / RUNS, powers };
}

// Dataset diagnostics: rating shape + the §12 visible-stat fidelity ceiling.
const ovrs = data.players.map((p) => p.hidden_ovr).sort((a, b) => a - b);
const share = (t: number) =>
  ((100 * ovrs.filter((o) => o >= t).length) / ovrs.length).toFixed(1) + "%";
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
console.log(
  "  §12 skilled-composite↔OVR Spearman: " +
    skilledModel.fidelity.map(([pos, r]) => `${pos} ${r.toFixed(2)}`).join(" · "),
);

const results = {
  random: runStrategy("random", 1234),
  skilled: runStrategy("skilled", 9012),
  greedy: runStrategy("greedy", 5678),
};
console.log(
  `\nladder: skilled/random ${(results.skilled.natty / results.random.natty).toFixed(2)}× · ` +
    `greedy/skilled ${(results.greedy.natty / results.skilled.natty).toFixed(2)}×`,
);
if (DUMP_PATH) {
  writeFileSync(
    DUMP_PATH,
    JSON.stringify({
      random: results.random.powers,
      skilled: results.skilled.powers,
      greedy: results.greedy.powers,
    }),
  );
  console.log(`power samples written to ${DUMP_PATH}`);
}
