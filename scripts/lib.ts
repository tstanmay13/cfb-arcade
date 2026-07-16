// Pure helpers for the data bake (scripts/build-data.ts). No I/O here — these
// are unit-tested by lib.test.ts.
import type { Era, GamePosition, StatBlock } from "../src/data/types.ts";

/** "Vince Young" -> "vince_young" (player_id convention, §4.1). */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const NAME_SUFFIXES = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv", "v"]);

/** "Vince Young" -> "V. Young"; suffixes stripped, first char of first token. */
export function displayShort(name: string): string {
  const tokens = name.trim().split(/\s+/);
  if (tokens.length < 2) return name;
  let last = tokens.length - 1;
  while (last > 1 && NAME_SUFFIXES.has(tokens[last].toLowerCase())) last--;
  const surname = tokens.slice(1, last + 1).join(" ");
  return `${tokens[0][0]}. ${surname}`;
}

export function playerId(
  pos: GamePosition,
  name: string,
  schoolId: string,
  decade: Era,
): string {
  return `${pos.toLowerCase()}_${slugify(name)}_${schoolId}_${decade}`;
}

export function coachId(name: string, schoolId: string, decade: Era): string {
  return `hc_${slugify(name)}_${schoolId}_${decade}`;
}

/**
 * Map a warehouse position (raw CFBD position string + pos_group) onto the
 * game's 7-position vocabulary. Returns null for positions with no board slot
 * (TE/OL/K/P/...). Generic "DB"/"NB" get CB with S as secondary — an
 * unspecified defensive back can honestly play either (§5.4 dual-eligibility).
 */
export function mapDbPosition(
  posGroup: string,
  position: string,
): { primary: GamePosition; secondary: GamePosition | null } | null {
  switch (posGroup) {
    case "QB":
      return { primary: "QB", secondary: null };
    case "RB":
      return { primary: "RB", secondary: null };
    case "WR":
      return { primary: "WR", secondary: null };
    case "DL":
      return { primary: "DL", secondary: null };
    case "LB":
      return { primary: "LB", secondary: null };
    case "DB": {
      const p = (position || "").toUpperCase().trim();
      if (p === "CB") return { primary: "CB", secondary: null };
      if (p === "S" || p === "FS" || p === "SS")
        return { primary: "S", secondary: null };
      return { primary: "CB", secondary: "S" }; // generic DB / NB
    }
    default:
      return null; // TE, OL, K, P, LS, ATH — no board slot
  }
}

/** Raw long-format stats pivoted to category -> statType -> numeric value. */
export type StatPivot = Record<string, Record<string, number>>;

function g(p: StatPivot, cat: string, stat: string): number {
  return p[cat]?.[stat] ?? 0;
}

/**
 * Forced fumbles aren't in CFBD's public season stats, but three defensive
 * stat maps (§4.2) display them. Deterministic correlated proxy — cosmetic
 * flavor per §4.5, documented in ADR-0011.
 */
export function forcedFumblesProxy(pivot: StatPivot): number {
  const sacks = g(pivot, "defensive", "SACKS");
  const tot = g(pivot, "defensive", "TOT");
  const ints = g(pivot, "interceptions", "INT");
  return Math.max(0, Math.min(5, Math.round(0.3 * sacks + tot / 55 + 0.2 * ints)));
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Build the §4.2 five-stat block for a position from pivoted real stats. */
export function statBlockFor(pos: GamePosition, p: StatPivot): StatBlock {
  switch (pos) {
    case "QB":
      return {
        stat_1: g(p, "passing", "YDS"),
        stat_2: g(p, "passing", "TD"),
        stat_3: g(p, "passing", "INT"),
        stat_4: g(p, "rushing", "YDS"),
        stat_5: round1(g(p, "passing", "PCT") * 100),
      };
    case "RB":
      return {
        stat_1: g(p, "rushing", "YDS"),
        stat_2: g(p, "rushing", "TD"),
        stat_3: round1(g(p, "rushing", "YPC")),
        stat_4: g(p, "receiving", "YDS"),
        stat_5: g(p, "receiving", "TD"),
      };
    case "WR":
      return {
        stat_1: g(p, "receiving", "REC"),
        stat_2: g(p, "receiving", "YDS"),
        stat_3: g(p, "receiving", "TD"),
        stat_4: round1(g(p, "receiving", "YPR")),
        stat_5: g(p, "receiving", "LONG"),
      };
    case "DL":
      return {
        stat_1: g(p, "defensive", "TOT"),
        stat_2: round1(g(p, "defensive", "TFL")),
        stat_3: round1(g(p, "defensive", "SACKS")),
        stat_4: forcedFumblesProxy(p),
        stat_5: g(p, "defensive", "PD"),
      };
    case "LB":
      return {
        stat_1: g(p, "defensive", "TOT"),
        stat_2: round1(g(p, "defensive", "TFL")),
        stat_3: round1(g(p, "defensive", "SACKS")),
        stat_4: g(p, "interceptions", "INT"),
        stat_5: forcedFumblesProxy(p),
      };
    case "CB":
      return {
        stat_1: g(p, "defensive", "TOT"),
        stat_2: g(p, "interceptions", "INT"),
        stat_3: g(p, "defensive", "PD"),
        stat_4: g(p, "defensive", "TD") + g(p, "interceptions", "TD"),
        stat_5: round1(g(p, "defensive", "TFL")),
      };
    case "S":
      return {
        stat_1: g(p, "defensive", "TOT"),
        stat_2: g(p, "interceptions", "INT"),
        stat_3: g(p, "defensive", "PD"),
        stat_4: forcedFumblesProxy(p),
        stat_5: round1(g(p, "defensive", "TFL")),
      };
  }
}

/** How many real players to keep per game position per {team, decade} cell.
    A cell now spans a whole decade of seasons, so N is sized for "all notable
    players" (§4.5) rather than a single recruiting class. */
export const TOP_N: Record<GamePosition, number> = {
  QB: 3,
  RB: 4,
  WR: 5,
  DL: 5,
  LB: 4,
  CB: 4,
  S: 4,
};

/** Notability floor for the modern slice (overall >= FLOOR). */
export const OVR_FLOOR = 75;

// ---------------------------------------------------------------------------
// Rating recalibration (anti-inflation, ADR-0016)
//
// The warehouse rating is a within-season cohort percentile; the game pool
// then keeps only top-N of powerhouse programs at their best season — triple
// selection bias that leaves the pool's median at ~87 and made 16-0 common.
// Quantile-remap the POOL's ratings (per position, rank-preserving) onto the
// §4.5 rubric's intended scarcity. Same input value → same output value, so
// ordering and the §12 stat↔OVR correlation are preserved exactly.
// ---------------------------------------------------------------------------

/** Bottom-up cumulative bands: share of the pool mapped into [min, max]. */
export interface CalibrationBand {
  share: number;
  min: number;
  max: number;
}

export const CALIBRATION_BANDS: CalibrationBand[] = [
  { share: 0.15, min: 62, max: 69 }, // depth pieces
  { share: 0.36, min: 70, max: 76 }, // solid contributors
  { share: 0.36, min: 77, max: 83 }, // multi-year quality starters
  { share: 0.1, min: 84, max: 89 }, // all-conference
  { share: 0.025, min: 90, max: 95 }, // clear All-American
  { share: 0.004, min: 96, max: 98 }, // generational
  { share: 0.001, min: 99, max: 99 }, // the mythical 99 club
];

/**
 * Map ratings onto CALIBRATION_BANDS by mid-rank quantile, per group.
 * Returns old-value → new-value per group key.
 */
export function calibrationMap(
  byGroup: Map<string, number[]>,
  bands: CalibrationBand[] = CALIBRATION_BANDS,
): Map<string, Map<number, number>> {
  const out = new Map<string, Map<number, number>>();
  for (const [group, values] of byGroup) {
    const sorted = [...values].sort((a, b) => a - b);
    const n = sorted.length;
    const remap = new Map<number, number>();
    for (const v of new Set(sorted)) {
      const lo = sorted.findIndex((x) => x === v);
      const hi = n - 1 - [...sorted].reverse().findIndex((x) => x === v);
      const q = (lo + hi) / 2 / Math.max(1, n - 1); // mid-rank quantile in [0,1]
      remap.set(v, bandValue(q, bands));
    }
    out.set(group, remap);
  }
  return out;
}

function bandValue(q: number, bands: CalibrationBand[]): number {
  let acc = 0;
  for (const band of bands) {
    const next = acc + band.share;
    if (q <= next || band === bands[bands.length - 1]) {
      const within = band.share === 0 ? 0 : (q - acc) / band.share;
      return Math.round(band.min + Math.min(1, Math.max(0, within)) * (band.max - band.min));
    }
    acc = next;
  }
  return bands[bands.length - 1].max;
}

/** Pearson correlation — used for the §12 correlation-invariant warning. */
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 1;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}
