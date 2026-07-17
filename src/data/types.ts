// Data model per design doc §4. data.json is the game's ONLY data source
// (static, baked at build time by scripts/build-data.ts — design pillar #4).

/**
 * Eras (ADR-0028): the live game runs on 5-year windows — real dynasty cores,
 * not decade mush — while the dormant authored decades keep their strings.
 * Forward rule: half-decade grid, and the trailing grid window absorbs the
 * partial half-decade until it holds ≥3 real seasons (so the 2027 bake splits
 * "2020-25" into "2020-24" + "2025-29"). The raw string IS the display label
 * everywhere (wheel, chips, share card) — there is no formatting layer.
 * Entity fields are still named `decade` (schema history, ADR-0028).
 */
export type Era = "1980s" | "1990s" | "2000s" | "2010-14" | "2015-19" | "2020-25";

export const ERAS: Era[] = ["1980s", "1990s", "2000s", "2010-14", "2015-19", "2020-25"];

/** Player position vocabulary (WR fills either WR1 or WR2 board slot). */
export type GamePosition = "QB" | "RB" | "WR" | "DL" | "LB" | "CB" | "S";

/** The 9 board slots: 8 player slots + head coach. */
export type SlotId =
  | "QB"
  | "RB"
  | "WR1"
  | "WR2"
  | "DL"
  | "LB"
  | "CB"
  | "S"
  | "HC";

export const PLAYER_SLOTS: Exclude<SlotId, "HC">[] = [
  "QB",
  "RB",
  "WR1",
  "WR2",
  "DL",
  "LB",
  "CB",
  "S",
];

/** Position → board slots that position may occupy (§5.4). */
export const POS_SLOTS: Record<GamePosition, Exclude<SlotId, "HC">[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR1", "WR2"],
  DL: ["DL"],
  LB: ["LB"],
  CB: ["CB"],
  S: ["S"],
};

/** Uniform 5-stat container; labels resolved by position at render (§4.2). */
export interface StatBlock {
  stat_1: number;
  stat_2: number;
  stat_3: number;
  stat_4: number;
  stat_5: number;
}

/** Position → display labels for the 5-stat block (§4.2). WR1/WR2 → WR. */
export const STAT_LABELS: Record<GamePosition, [string, string, string, string, string]> = {
  QB: ["Passing Yards", "Passing TDs", "Interceptions", "Rushing Yards", "Completion %"],
  RB: ["Rushing Yards", "Rushing TDs", "Yards/Carry", "Receiving Yards", "Receiving TDs"],
  WR: ["Receptions", "Receiving Yards", "Receiving TDs", "Yards/Catch", "Longest Catch"],
  DL: ["Total Tackles", "Tackles for Loss", "Sacks", "Forced Fumbles", "Pass Deflections"],
  LB: ["Total Tackles", "Tackles for Loss", "Sacks", "Interceptions", "Forced Fumbles"],
  CB: ["Total Tackles", "Interceptions", "Pass Deflections", "Defensive TDs", "Tackles for Loss"],
  S: ["Total Tackles", "Interceptions", "Pass Deflections", "Forced Fumbles", "Tackles for Loss"],
};

/** Compact stat labels for narrow layouts (§8.4 mobile pass) — same order as
    STAT_LABELS. The full labels above stay the source of truth; a five-column
    grid at phone width truncated them into identical prefixes ("RUSHING…"
    twice), so tight screens swap to these. */
export const STAT_LABELS_SHORT: Record<GamePosition, [string, string, string, string, string]> = {
  QB: ["Pass Yds", "Pass TD", "INT", "Rush Yds", "Comp %"],
  RB: ["Rush Yds", "Rush TD", "Yds/Car", "Rec Yds", "Rec TD"],
  WR: ["Rec", "Rec Yds", "Rec TD", "Yds/Rec", "Long"],
  DL: ["Tackles", "TFL", "Sacks", "FF", "PD"],
  LB: ["Tackles", "TFL", "Sacks", "INT", "FF"],
  CB: ["Tackles", "INT", "PD", "Def TD", "TFL"],
  S: ["Tackles", "INT", "PD", "FF", "TFL"],
};

/** Coach stat labels (§4.3). */
export const COACH_STAT_LABELS: [string, string, string, string, string] = [
  "Era Wins",
  "National Titles",
  "Conference Titles",
  "Bowl Win %",
  "Total Career Wins",
];

/** Compact coach labels — same order as COACH_STAT_LABELS (§8.4). */
export const COACH_STAT_LABELS_SHORT: [string, string, string, string, string] = [
  "Era W",
  "Titles",
  "Conf",
  "Bowl %",
  "Career W",
];

export interface Player {
  /** Globally unique; convention pos_name_school_decade (§4.1). */
  player_id: string;
  name: string;
  /** Precomputed abbreviated name for the share card — never derived at render. */
  display_short: string;
  jersey_number: string;
  primary_position: GamePosition;
  /** Nullable; drives dual-slot eligibility (§5.4). */
  secondary_position: GamePosition | null;
  school: string;
  school_id: string;
  decade: Era;
  /** Display flavor only (decision #11 — no conference filtering). */
  historical_conference: string;
  /** Drives 80s/90s eligibility + 3× spin weighting (§5.3). */
  is_historic_powerhouse: boolean;
  /** The ONLY simulation input. 0–100. */
  hidden_ovr: number;
  /** Cosmetic, but must correlate with hidden_ovr (§12 invariant). */
  stats: StatBlock;
}

export type CoachTier = "Elite" | "Great" | "Standard" | "Sub-Par";

/** Season performance category for player stat display (20% each). */
export type PerformanceCategory =
  | "significantly_worse"
  | "marginally_worse"
  | "same"
  | "marginally_better"
  | "significantly_better";

export interface Coach {
  coach_id: string;
  name: string;
  display_short: string;
  school: string;
  school_id: string;
  decade: Era;
  historical_conference: string;
  /** Maps to the power-score multiplier (§6.1). */
  coach_tier: CoachTier;
  stats: StatBlock;
}

export interface Team {
  school_id: string;
  name: string;
  mascot: string;
  mainHex: string;
  accentHex: string;
  /** Lets the spin engine skip empty team/era cells cheaply (§4.4). */
  eras_present: Era[];
  is_historic_powerhouse: boolean;
  /** Which eras this program was dominant in — source of the per-player
      is_historic_powerhouse flag and per-cell spin weighting. */
  powerhouse_eras: Era[];
}

export interface GameData {
  version: number;
  generated_at: string;
  teams: Team[];
  players: Player[];
  coaches: Coach[];
}
