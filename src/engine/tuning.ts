// ============================================================================
// THE KNOBS FILE — every gameplay dial for The 16-0 Draft in one place.
//
// Owner workflow: edit a number below → `npm run tune` (prints what the new
// dial does: odds by power, spin landing shares) → for anything touching the
// outcome ramp, run the deep referee `node --no-warnings scripts/balance.ts`
// and keep the gates (ADR-0033): skilled 16-0 in the 6-10% band, ladder
// skilled/random ≥2×, oracle/skilled ≥2.2×. Ship the table in the ADR/PR.
//
// PLAYER OVERALLS are the one dial NOT here: they're baked into
// public/data.json by scripts/build-data.ts (owner-side, needs the warehouse).
// Their knobs live in scripts/lib.ts — OVR_FLOOR (who makes the pool at all),
// TOP_N (roster depth per position per cell), and CALIBRATION_BANDS (the
// quantile curve that decides how many 90s/96s exist per position). Change
// those → `npm run build:data` → commit the new data.json.
// ============================================================================

import type { CoachTier } from "../data/types.ts";

/** The tier keys used by the outcome matrix. */
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

export type OutcomeOdds = Record<Outcome, number>;

export interface TierRow {
  min: number;
  natty: number;
  semis: number;
  major: number;
  minor: number;
  loss: number;
  dynastyChance: number;
}

// ----------------------------------------------------------------------------
// 1. SPIN — how often the good teams show up (§5.3, consumed by spin.ts)
// ----------------------------------------------------------------------------

/** Players averaged for a cell's talent score. Smaller = more star-driven. */
export const TALENT_TOP_K = 3;

/** Weakest cell's landing weight. Raise toward MAX to flatten the wheel
    (everyone shows up equally); lower to bury weak pools. */
export const MIN_CELL_WEIGHT = 1.5;

/** Strongest cell's landing weight. The MAX/MIN ratio is "how much more often
    a stacked roster lands than a thin one" — currently 2×. */
export const MAX_CELL_WEIGHT = 3.0;

/** Extra multiplier for MARQUEE_TEAMS — brand shine independent of talent. */
export const MARQUEE_BUMP = 1.25;

/** Coach-phase cell weights by the cell's best coach tier. */
export const COACH_TIER_WEIGHT: Record<CoachTier, number> = {
  Elite: 3.0,
  Great: 2.25,
  Standard: 1.5,
  "Sub-Par": 1.0,
};

/** Hand-curated "cool/marquee" programs (school_id) — editorial, tweakable. */
export const MARQUEE_TEAMS = new Set<string>([
  // established blue-bloods (the original 18)
  "alabama", "auburn", "florida", "florida_state", "georgia", "lsu", "miami",
  "michigan", "nebraska", "notre_dame", "ohio_state", "oklahoma", "oregon",
  "penn_state", "tennessee", "texas", "usc", "washington",
  // marquee brands among the expansion
  "clemson", "colorado", "texas_a_m", "wisconsin", "ucla", "michigan_state",
]);

// ----------------------------------------------------------------------------
// 2. OUTCOMES — what a given board strength earns (§6, consumed by sim.ts)
// ----------------------------------------------------------------------------

/** Coach multiplier on the roster's average OVR (power = avg × (1 + mod)). */
export const COACH_MODIFIERS: Record<CoachTier, number> = {
  Elite: 0.05,
  Great: 0.02,
  Standard: 0.0,
  "Sub-Par": -0.03,
};

/**
 * §6.2 tier table. `Tier0.min` IS the "what overall are we making a 16-0"
 * bar: at or above it the board is a commanding title favorite
 * (Tier0.natty, never 1.0 — ADR-0026's reversal of the guaranteed natty
 * stands) and a natty there rolls dynastyChance for the Dynasty banner.
 * Tier1-3's outcome columns are informational mirrors of outcomeOdds(min)
 * (pinned by sim.test.ts); the ramp below is what actually rolls in 78-96.9.
 * Tier4-7 are real stepped rows for the sub-ramp mass.
 */
export const SIM_MATRIX: Record<TierKey, TierRow> = {
  Tier0: { min: 97, natty: 0.7, semis: 0.22, major: 0.08, minor: 0.0, loss: 0.0, dynastyChance: 0.8 },
  Tier1: { min: 91, natty: 0.17, semis: 0.3625, major: 0.3925, minor: 0.075, loss: 0.0, dynastyChance: 0.0 },
  Tier2: { min: 85, natty: 0.038, semis: 0.32, major: 0.472, minor: 0.17, loss: 0.0, dynastyChance: 0.0 },
  Tier3: { min: 78, natty: 0.03, semis: 0.26, major: 0.45, minor: 0.26, loss: 0.0, dynastyChance: 0.0 },
  Tier4: { min: 70, natty: 0.03, semis: 0.1, major: 0.45, minor: 0.37, loss: 0.05, dynastyChance: 0.0 },
  Tier5: { min: 60, natty: 0.0, semis: 0.05, major: 0.15, minor: 0.6, loss: 0.2, dynastyChance: 0.0 },
  Tier6: { min: 45, natty: 0.0, semis: 0.0, major: 0.0, minor: 0.3, loss: 0.7, dynastyChance: 0.0 },
  Tier7: { min: 0, natty: 0.0, semis: 0.0, major: 0.0, minor: 0.0, loss: 1.0, dynastyChance: 0.0 },
};

const oddsOf = (r: TierRow): OutcomeOdds => ({
  natty: r.natty, semis: r.semis, major: r.major, minor: r.minor, loss: r.loss,
});

/**
 * The outcome ramp (ADR-0026/0032/0033): odds for power 78-96.9 interpolate
 * linearly between these anchors. THE dial for "how good does a board have
 * to be to win":
 *   RARITY (ADR-0026) — overall skilled-play 16-0 budget is 6-10%; the
 *   90-anchor's natty column is what protects it (skilled boards mass ≈87-91).
 *   FAVORITE (ADR-0033) — the 90→97 leg is steep (10% → 38% → 62%) so a
 *   board that reaches the elite band actually wins: 91→17%, 93→31%, 95→46%.
 *   FLOOR (ADR-0032) — the minor column (missed the CFP) falls with power.
 * Each row must sum to 1 with loss included (outcomeOdds re-normalizes tiny
 * drift). The last anchor is an interpolation TARGET; at ≥Tier0.min the
 * stepped Tier0 row above rolls instead (+snap = the one deliberate cliff).
 */
export const RAMP_ANCHORS: [number, OutcomeOdds][] = [
  [SIM_MATRIX.Tier3.min, oddsOf(SIM_MATRIX.Tier3)],
  [SIM_MATRIX.Tier2.min, oddsOf(SIM_MATRIX.Tier2)],
  [90, { natty: 0.1, semis: 0.37, major: 0.44, minor: 0.09, loss: 0.0 }],
  [94, { natty: 0.38, semis: 0.34, major: 0.25, minor: 0.03, loss: 0.0 }],
  [SIM_MATRIX.Tier0.min, { natty: 0.62, semis: 0.26, major: 0.11, minor: 0.01, loss: 0.0 }],
];

/**
 * Within-outcome record tilt (ADR-0032): stronger boards draw the kinder
 * record for the same exit round (a 92's bowl year reads 10-3, an 80's 8-5).
 * STRENGTH 0.5 keeps the ADR-0026 record-variety gates (0.6 collapsed
 * oracle to 8 records); MIDPOINT/SPAN define where the tilt turns over.
 */
// (The per-outcome loss-count tables themselves — 14-1 vs 13-2 weights etc. —
// are OUTCOME_PLAN in sim.ts §6.3.)
export const RECORD_TILT_MIDPOINT = 86;
export const RECORD_TILT_SPAN = 10;
export const RECORD_TILT_STRENGTH = 0.5;
