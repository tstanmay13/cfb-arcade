// Simulation engine (§6). Everything here runs synchronously at SIM_RESOLVE,
// before any animation: power score → tier → outcome roll → schedule. The
// season animation is pure playback of this result. All randomness through
// the injected seeded rng.
import type { Coach, CoachTier } from "../data/types.ts";
import { shuffle, weightedPick, type Rng } from "./rng.ts";
import type { PlayerSlots } from "./spin.ts";

// ---------------------------------------------------------------------------
// §6.1 Power score
// ---------------------------------------------------------------------------
export const COACH_MODIFIERS: Record<CoachTier, number> = {
  Elite: 0.05,
  Great: 0.02,
  Standard: 0.0,
  "Sub-Par": -0.03,
};

export function powerScore(slots: PlayerSlots, coach: Coach): number {
  const ovrs = Object.values(slots).map((p) => {
    if (!p) throw new Error("powerScore requires a full board");
    return p.hidden_ovr;
  });
  const base = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
  const m = COACH_MODIFIERS[coach.coach_tier] ?? 0;
  return Math.min(100, base * (1 + m)); // cap so Tier 0's range stays meaningful
}

// ---------------------------------------------------------------------------
// §6.2 Tier mapping + two-stage outcome matrix
// ---------------------------------------------------------------------------
export type TierKey =
  | "Tier0"
  | "Tier1"
  | "Tier2"
  | "Tier3"
  | "Tier4"
  | "Tier5"
  | "Tier6"
  | "Tier7";

export type Outcome = "natty" | "semis" | "major" | "minor" | "loss";

interface TierRow {
  min: number;
  natty: number;
  semis: number;
  major: number;
  minor: number;
  loss: number;
  dynastyChance: number;
}

/** §6.2 values verbatim; `min` thresholds define the ranges (floats between
    integer boundaries fall to the lower tier, e.g. 95.4 → Tier1). */
export const SIM_MATRIX: Record<TierKey, TierRow> = {
  // §12 balance pass (ADR-0016): Tier0 min 96→97; natty odds trimmed in
  // Tiers 1-3 so 16-0 stays rare (~5% random, ~18% oracle-optimal play).
  Tier0: { min: 97, natty: 1.0, semis: 0.0, major: 0.0, minor: 0.0, loss: 0.0, dynastyChance: 0.8 },
  Tier1: { min: 91, natty: 0.2, semis: 0.5, major: 0.3, minor: 0.0, loss: 0.0, dynastyChance: 0.0 },
  Tier2: { min: 85, natty: 0.08, semis: 0.42, major: 0.35, minor: 0.15, loss: 0.0, dynastyChance: 0.0 },
  Tier3: { min: 78, natty: 0.05, semis: 0.25, major: 0.45, minor: 0.25, loss: 0.0, dynastyChance: 0.0 },
  Tier4: { min: 70, natty: 0.05, semis: 0.1, major: 0.45, minor: 0.35, loss: 0.05, dynastyChance: 0.0 },
  Tier5: { min: 60, natty: 0.0, semis: 0.05, major: 0.15, minor: 0.6, loss: 0.2, dynastyChance: 0.0 },
  Tier6: { min: 45, natty: 0.0, semis: 0.0, major: 0.0, minor: 0.3, loss: 0.7, dynastyChance: 0.0 },
  Tier7: { min: 0, natty: 0.0, semis: 0.0, major: 0.0, minor: 0.0, loss: 1.0, dynastyChance: 0.0 },
};

const TIER_ORDER: TierKey[] = ["Tier0", "Tier1", "Tier2", "Tier3", "Tier4", "Tier5", "Tier6", "Tier7"];

export function tierFor(pFinal: number): TierKey {
  return TIER_ORDER.find((k) => pFinal >= SIM_MATRIX[k].min) ?? "Tier7";
}

export interface OutcomeResult {
  tier: TierKey;
  outcome: Outcome;
  isDynasty: boolean;
}

/** Dynasty gating (§0 decision 6): Tier 0 always wins the natty, then rolls
    the 80% Dynasty chance. No other tier can produce a Dynasty. */
export function resolveOutcome(pFinal: number, rng: Rng): OutcomeResult {
  const tier = tierFor(pFinal);
  const t = SIM_MATRIX[tier];
  const outcome = weightedPick(
    { natty: t.natty, semis: t.semis, major: t.major, minor: t.minor, loss: t.loss },
    rng,
  ) as Outcome;
  const isDynasty = tier === "Tier0" && outcome === "natty" && rng() <= t.dynastyChance;
  return { tier, outcome, isDynasty };
}

// ---------------------------------------------------------------------------
// §6.3 Schedule generation (dynamic 12→16 length)
// ---------------------------------------------------------------------------
export type Phase = "REG" | "CCG" | "QF" | "SF" | "FINAL" | "BOWL";

export interface ScheduledGame {
  week: number;
  phase: Phase;
  result: "WIN" | "LOSS";
  score: string;
  opponent: string;
}

export const OUTCOME_PLAN: Record<
  Outcome,
  { games: number; losses: number; lossZone: "none" | "exit" | "mixed" | "regular" }
> = {
  natty: { games: 16, losses: 0, lossZone: "none" },
  semis: { games: 15, losses: 1, lossZone: "exit" },
  major: { games: 14, losses: 2, lossZone: "mixed" },
  minor: { games: 13, losses: 4, lossZone: "regular" },
  loss: { games: 12, losses: 7, lossZone: "regular" },
};

/** Postseason phase labels appended after the 12 regular-season games. */
export function schedulePhase(index: number, games: number): Phase {
  if (index < 12) return "REG";
  if (games === 13) return "BOWL";
  const post: Phase[] = ["CCG", "QF", "SF", "FINAL"];
  return post[index - 12];
}

/**
 * Loss placement. Bracket coherence (deliberate refinement of §6.3's literal
 * zones, see ADR-0013): a postseason run ENDS at its exit game, so `semis`
 * places its single loss in the final game (the SF) and `major` places one of
 * its two in the QF exit; extra losses use the doc's zones. Low tiers spread
 * losses across the regular season.
 */
export function pickLossIndices(
  games: number,
  count: number,
  zone: "none" | "exit" | "mixed" | "regular",
  rng: Rng,
): number[] {
  if (count === 0) return [];
  const out = new Set<number>();
  let remaining = count;
  if (zone === "exit" || zone === "mixed") {
    out.add(games - 1); // the exit game
    remaining -= 1;
  }
  const candidates =
    zone === "regular"
      ? [...Array(Math.min(12, games)).keys()] // regular season only
      : [...Array(games - 1).keys()].slice(2); // anywhere but the opening games and exit
  for (const idx of shuffle(candidates, rng)) {
    if (remaining <= 0) break;
    if (!out.has(idx)) {
      out.add(idx);
      remaining -= 1;
    }
  }
  return [...out].sort((a, b) => a - b);
}

// §6.4 cosmetic score strings
const WIN_SCORES = ["34-31", "24-17", "42-38", "52-14", "38-7", "45-42", "21-10", "49-3", "59-0", "63-14"];
const LOSS_SCORES = ["21-24", "38-42", "17-20", "28-31", "10-45", "35-42", "14-49", "6-52", "0-45", "13-56"];

export function getScoreString(result: "WIN" | "LOSS", rng: Rng): string {
  const table = result === "WIN" ? WIN_SCORES : LOSS_SCORES;
  return table[Math.floor(rng() * table.length)];
}

export function generateSchedule(
  outcome: Outcome,
  rng: Rng,
  opponents: string[],
): ScheduledGame[] {
  const plan = OUTCOME_PLAN[outcome];
  const lossIdx = new Set(pickLossIndices(plan.games, plan.losses, plan.lossZone, rng));
  const opps = shuffle(opponents, rng);
  return Array.from({ length: plan.games }, (_, i) => {
    const result: "WIN" | "LOSS" = lossIdx.has(i) ? "LOSS" : "WIN";
    return {
      week: i + 1,
      phase: schedulePhase(i, plan.games),
      result,
      score: getScoreString(result, rng),
      opponent: opps[i % opps.length] ?? "State",
    };
  });
}

export function recordString(schedule: ScheduledGame[]): string {
  const wins = schedule.filter((g) => g.result === "WIN").length;
  return `${wins}-${schedule.length - wins}`;
}
