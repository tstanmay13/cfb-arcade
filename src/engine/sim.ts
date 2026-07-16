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

/** §6.2 values; `min` thresholds define the ranges (floats between integer
    boundaries fall to the lower tier, e.g. 95.4 → Tier1). ADR-0026: for power
    78–96.9 the outcome roll no longer steps on these rows — it interpolates
    RAMP_ANCHORS (see outcomeOdds). Tier1–3's outcome columns below are kept
    equal to outcomeOdds(min) — informational, pinned by a test — while `min`
    still drives labels, the scout-verified badge, Heisman chance, and the
    Tier0 dynasty gate. Tier4–7 and Tier0 remain real stepped rows. */
export const SIM_MATRIX: Record<TierKey, TierRow> = {
  // §12 balance pass (ADR-0016): Tier0 min 96→97; 16-0 stays rare.
  // A 2026-07-14 "Tier1 becomes a 60% title favorite" retune was reversed by
  // the owner before it ever shipped — a title must stay rare even for elite
  // boards; ADR-0026 records the reversal and the design that replaced it.
  Tier0: { min: 97, natty: 1.0, semis: 0.0, major: 0.0, minor: 0.0, loss: 0.0, dynastyChance: 0.8 },
  Tier1: { min: 91, natty: 0.17125, semis: 0.28825, major: 0.34775, minor: 0.19275, loss: 0.0, dynastyChance: 0.0 },
  Tier2: { min: 85, natty: 0.052, semis: 0.321, major: 0.401, minor: 0.226, loss: 0.0, dynastyChance: 0.0 },
  Tier3: { min: 78, natty: 0.038, semis: 0.253, major: 0.456, minor: 0.253, loss: 0.0, dynastyChance: 0.0 },
  Tier4: { min: 70, natty: 0.05, semis: 0.1, major: 0.45, minor: 0.35, loss: 0.05, dynastyChance: 0.0 },
  Tier5: { min: 60, natty: 0.0, semis: 0.05, major: 0.15, minor: 0.6, loss: 0.2, dynastyChance: 0.0 },
  Tier6: { min: 45, natty: 0.0, semis: 0.0, major: 0.0, minor: 0.3, loss: 0.7, dynastyChance: 0.0 },
  Tier7: { min: 0, natty: 0.0, semis: 0.0, major: 0.0, minor: 0.0, loss: 1.0, dynastyChance: 0.0 },
};

const TIER_ORDER: TierKey[] = ["Tier0", "Tier1", "Tier2", "Tier3", "Tier4", "Tier5", "Tier6", "Tier7"];

export function tierFor(pFinal: number): TierKey {
  return TIER_ORDER.find((k) => pFinal >= SIM_MATRIX[k].min) ?? "Tier7";
}

type OutcomeOdds = Record<Outcome, number>;

const oddsOf = (r: {
  natty: number; semis: number; major: number; minor: number; loss: number;
}): OutcomeOdds => ({ natty: r.natty, semis: r.semis, major: r.major, minor: r.minor, loss: r.loss });

/**
 * ADR-0026 ramp, re-heighted by ADR-0029 for the 5-year era pool (ADR-0028):
 * outcome odds for power 78–96.9 interpolate linearly between these anchors —
 * every point of power moves the odds and there is no mid-range cliff. The
 * shape is flat through ~90 and steep 94→97 ON PURPOSE: skilled stat-reading
 * boards mass at power 84–91 while oracle-grade boards mass at 90–96, so the
 * top leg is what separates mastery from mere competence (the owner's ladder:
 * skilled ≥2× random, oracle ≥2.2× skilled). Each anchor's non-natty mass
 * keeps ADR-0026's semis/major/minor proportions — the record-variety
 * structure is untouched. Measured on the 2026-07-16 rebucketed bake
 * (20k drafts/policy, scripts/balance.ts, exact outcome accounting):
 * random 4.7%, skilled 10.0%, oracle-optimal 23.0% — ladder 2.1× / 2.3×.
 * The final [97] row is an interpolation TARGET only — at ≥97 outcomeOdds
 * returns Tier0's row, so the summit snap to a guaranteed title (the Tier0
 * fantasy) is the one deliberate cliff, exactly as in every prior dial set.
 * Retune only with scripts/balance.ts in hand.
 */
const RAMP_ANCHORS: [number, OutcomeOdds][] = [
  [SIM_MATRIX.Tier3.min, oddsOf(SIM_MATRIX.Tier3)],
  [SIM_MATRIX.Tier2.min, oddsOf(SIM_MATRIX.Tier2)],
  [90, { natty: 0.125, semis: 0.288, major: 0.37, minor: 0.217, loss: 0.0 }],
  [94, { natty: 0.31, semis: 0.289, major: 0.281, minor: 0.12, loss: 0.0 }],
  [SIM_MATRIX.Tier0.min, { natty: 0.52, semis: 0.269, major: 0.173, minor: 0.038, loss: 0.0 }],
];

const OUTCOME_KEYS: Outcome[] = ["natty", "semis", "major", "minor", "loss"];

/** Odds the outcome roll uses. Below the ramp (Tier4-7) and at Tier0 these are
    the stepped SIM_MATRIX rows; inside 78–96.9 they interpolate (ADR-0026). */
export function outcomeOdds(pFinal: number): OutcomeOdds {
  const floor = RAMP_ANCHORS[0][0];
  const ceil = RAMP_ANCHORS[RAMP_ANCHORS.length - 1][0];
  if (pFinal < floor || pFinal >= ceil) return oddsOf(SIM_MATRIX[tierFor(pFinal)]);
  let i = 0;
  while (i < RAMP_ANCHORS.length - 2 && pFinal >= RAMP_ANCHORS[i + 1][0]) i++;
  const [p0, r0] = RAMP_ANCHORS[i];
  const [p1, r1] = RAMP_ANCHORS[i + 1];
  const t = (pFinal - p0) / (p1 - p0);
  const odds = {} as OutcomeOdds;
  let sum = 0;
  for (const k of OUTCOME_KEYS) {
    odds[k] = r0[k] + t * (r1[k] - r0[k]);
    sum += odds[k];
  }
  for (const k of OUTCOME_KEYS) odds[k] /= sum; // guard float drift; rows stay a distribution
  return odds;
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
  const outcome = weightedPick(outcomeOdds(pFinal), rng) as Outcome;
  const isDynasty =
    tier === "Tier0" && outcome === "natty" && rng() <= SIM_MATRIX.Tier0.dynastyChance;
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

/**
 * The outcome fixes the season's LENGTH and exit round; the loss COUNT is now
 * a weighted draw (ADR-0026) so the same outcome produces varied records —
 * semis reads 14-1 or 13-2, major 12-2 or 11-3, minor 10-3/9-4/8-5 — instead
 * of one fixed near-miss every run (the "every game ends 14-1" monotony).
 * natty stays exactly 16-0: the perfect season IS the game.
 */
export const OUTCOME_PLAN: Record<
  Outcome,
  { games: number; losses: Record<string, number>; lossZone: "none" | "exit" | "mixed" | "regular" }
> = {
  natty: { games: 16, losses: { 0: 1 }, lossZone: "none" },
  semis: { games: 15, losses: { 1: 0.55, 2: 0.35, 3: 0.1 }, lossZone: "exit" }, // 14-1 · 13-2 · 12-3
  major: { games: 14, losses: { 2: 0.5, 3: 0.35, 4: 0.15 }, lossZone: "mixed" }, // 12-2 · 11-3 · 10-4
  minor: { games: 13, losses: { 3: 0.35, 4: 0.4, 5: 0.25 }, lossZone: "regular" }, // 10-3 · 9-4 · 8-5
  loss: { games: 12, losses: { 6: 0.25, 7: 0.45, 8: 0.3 }, lossZone: "regular" }, // 6-6 · 5-7 · 4-8
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
  // Extra losses never land past the CCG (index 12): a run that exits in the
  // SF cannot show a QF loss (bracket coherence, ADR-0013/0026 — losing your
  // CCG and still making the field as an at-large is fine, losing a
  // knockout round you then advanced from is not).
  const candidates =
    zone === "regular"
      ? [...Array(Math.min(12, games)).keys()] // regular season only
      : [...Array(Math.min(13, games - 1)).keys()].slice(2); // no openers, no exit, nothing past the CCG
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
  const lossCount = Number(weightedPick(plan.losses, rng)); // ADR-0026 record variety
  const lossIdx = new Set(pickLossIndices(plan.games, lossCount, plan.lossZone, rng));
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
