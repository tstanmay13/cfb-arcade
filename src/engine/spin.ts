// Spin / draft engine (§5): weighted {team, era} cell selection, re-spins,
// dual-position eligibility, duplicate block, and the §5.6 edge cases.
// Pure functions over GameData — no React, no globals, rng injected.
import type {
  Coach,
  CoachTier,
  Era,
  GameData,
  Player,
  SlotId,
} from "../data/types.ts";
import { POS_SLOTS } from "../data/types.ts";
import { pick, type Rng } from "./rng.ts";

// §5.3 spin weighting — TALENT-DRIVEN and fully tweakable (no one-door dial).
// A {team, era} cell's landing weight scales with its top-end talent (so a
// stacked roster — of ANY program — is exciting to hit) plus a small brand
// "marquee" bump (so a cool/blue-blood program still shines in a down year).
// Retuning any of these is a one-line edit + redeploy: weights are derived at
// runtime from the players already in data.json, so no data re-bake is needed.
//
// Curve: a cell's talent percentile within the current candidate set maps
// linearly onto [MIN_CELL_WEIGHT, MAX_CELL_WEIGHT]. "Gentle" by default — even
// the weakest pool keeps a real chance, so the long tail still shows up.
export const TALENT_TOP_K = 3; // players averaged for a cell's talent score
export const MIN_CELL_WEIGHT = 1.5; // weakest cell's weight (gentle floor)
export const MAX_CELL_WEIGHT = 3.0; // strongest cell's weight
export const MARQUEE_BUMP = 1.25; // brand-shine multiplier for MARQUEE_TEAMS
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
const POWERHOUSE_ONLY_ERAS: Era[] = ["1980s", "1990s"]; // §5.3 era authenticity

export type PlayerSlots = Record<Exclude<SlotId, "HC">, Player | null>;

export interface SpinResult {
  teamId: string;
  era: Era;
  pool: Player[];
}

export interface CoachSpinResult {
  teamId: string;
  era: Era;
  pool: Coach[];
}

interface Cell {
  teamId: string;
  era: Era;
  powerhouse: boolean;
  players: Player[];
}

// ---------------------------------------------------------------------------
// Cells (§5.3) — collapse players to unique {team, era}, weight cells not
// players, so a deep roster doesn't out-weigh a thin one. Cells are derived
// from players, so a cell with 0 notable players cannot exist (§5.6 case 1 is
// structurally impossible rather than re-rolled).
// ---------------------------------------------------------------------------
export function playerCells(
  data: GameData,
  opts: { decade?: Era | null; teamId?: string | null } = {},
): Cell[] {
  const cells = new Map<string, Cell>();
  for (const p of data.players) {
    if (opts.decade && p.decade !== opts.decade) continue;
    if (opts.teamId && p.school_id !== opts.teamId) continue;
    // Era authenticity: 80s/90s cells exist only for historic powerhouses.
    if (POWERHOUSE_ONLY_ERAS.includes(p.decade) && !p.is_historic_powerhouse) continue;
    const key = `${p.school_id}|${p.decade}`;
    const cell = cells.get(key) ?? {
      teamId: p.school_id,
      era: p.decade,
      powerhouse: false,
      players: [],
    };
    cell.players.push(p);
    cell.powerhouse ||= p.is_historic_powerhouse;
    cells.set(key, cell);
  }
  return [...cells.values()];
}

/** Top-K average OVR — a cell's "star power", the excitement signal. */
function talentScore(players: Player[]): number {
  if (players.length === 0) return 0;
  const top = players
    .map((p) => p.hidden_ovr)
    .sort((a, b) => b - a)
    .slice(0, TALENT_TOP_K);
  return top.reduce((a, b) => a + b, 0) / top.length;
}

function weightFor(teamId: string, score: number, scores: number[]): number {
  const below = scores.filter((x) => x < score).length;
  const pct = scores.length > 1 ? below / (scores.length - 1) : 0.5;
  const base = MIN_CELL_WEIGHT + (MAX_CELL_WEIGHT - MIN_CELL_WEIGHT) * pct;
  return base * (MARQUEE_TEAMS.has(teamId) ? MARQUEE_BUMP : 1);
}

/** A cell's landing weight: talent percentile within `allCells` → the gentle
    [MIN,MAX] curve, times the marquee brand bump. Exported for tuning/tests. */
export function cellSpinWeight(
  cell: { teamId: string; players: Player[] },
  allCells: { players: Player[] }[],
): number {
  const scores = allCells.map((c) => talentScore(c.players));
  return weightFor(cell.teamId, talentScore(cell.players), scores);
}

/** Weighted pick over parallel items/weights arrays; one rng() draw. */
function pickWeighted<T>(items: T[], weights: number[], rng: Rng): T {
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) return pick(items, rng);
  let r = rng() * total;
  for (let i = 0; i < items.length; i++) {
    r -= weights[i];
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function weightedCell(cells: Cell[], rng: Rng): Cell {
  const scores = cells.map((c) => talentScore(c.players));
  const weights = cells.map((c, i) => weightFor(c.teamId, scores[i], scores));
  return pickWeighted(cells, weights, rng);
}

const notCell =
  (teamId: string, era: Era) =>
  (c: { teamId: string; era: Era }): boolean =>
    !(c.teamId === teamId && c.era === era);

/** Default spin (§5.1): any era unless a decade filter is passed. A teamId
    filter locks the spin to one program (used by the "keep team" token, §5.2). */
export function spin(
  data: GameData,
  rng: Rng,
  opts: { decade?: Era | null; teamId?: string | null; exclude?: SpinResult | null } = {},
): SpinResult {
  let cells = playerCells(data, { decade: opts.decade, teamId: opts.teamId });
  if (opts.exclude) {
    const filtered = cells.filter(notCell(opts.exclude.teamId, opts.exclude.era));
    if (filtered.length > 0) cells = filtered;
  }
  const cell = weightedCell(cells, rng);
  return { teamId: cell.teamId, era: cell.era, pool: cell.players };
}

/** Team re-spin (§5.2): keep the era, re-roll the team. */
export function teamRespin(data: GameData, rng: Rng, current: SpinResult): SpinResult {
  return spin(data, rng, { decade: current.era, exclude: current });
}

/**
 * Era re-spin (§5.2): keep the team, re-roll the era (within eras_present;
 * 80s/90s only if the program was a powerhouse then). Returns null when the
 * team has no other eligible era — the UI must disable the button, and a null
 * here never costs a re-spin.
 */
export function eraRespin(
  data: GameData,
  rng: Rng,
  current: SpinResult,
): SpinResult | null {
  const cells = playerCells(data, { teamId: current.teamId }).filter(
    notCell(current.teamId, current.era),
  );
  if (cells.length === 0) return null;
  const cell = weightedCell(cells, rng);
  return { teamId: cell.teamId, era: cell.era, pool: cell.players };
}

// ---------------------------------------------------------------------------
// Placement & eligibility (§5.4)
// ---------------------------------------------------------------------------

/** True if this exact human is already on the board (id or same name+school —
    the same real player can't appear twice via different era spins). */
export function isDuplicate(player: Player, slots: PlayerSlots): boolean {
  return Object.values(slots).some(
    (s) =>
      s !== null &&
      (s.player_id === player.player_id ||
        (s.name === player.name && s.school_id === player.school_id)),
  );
}

/** Open slots this player may fill (primary or secondary position; WR1/WR2
    interchangeable). Empty for duplicates — drives board greying. */
export function eligibleOpenSlots(player: Player, slots: PlayerSlots): Exclude<SlotId, "HC">[] {
  if (isDuplicate(player, slots)) return [];
  const candidates = new Set<Exclude<SlotId, "HC">>([
    ...(POS_SLOTS[player.primary_position] ?? []),
    ...(player.secondary_position ? POS_SLOTS[player.secondary_position] : []),
  ]);
  return [...candidates].filter((s) => slots[s] === null);
}

/** §5.6 case 2: pool has players but none can be placed. */
export function isPoolUsable(pool: Player[], slots: PlayerSlots): boolean {
  return pool.some((p) => eligibleOpenSlots(p, slots).length > 0);
}

/**
 * §5.6 case 3: re-spins exhausted and the current pool is unusable — guarantee
 * a placeable option instead of soft-locking. Relaxation ladder: any cell
 * containing at least one placeable player (era + powerhouse filters dropped).
 */
export function expandedFallbackSpin(
  data: GameData,
  rng: Rng,
  slots: PlayerSlots,
  exclude?: SpinResult | null,
): SpinResult | null {
  const all = new Map<string, Cell>();
  for (const p of data.players) {
    if (eligibleOpenSlots(p, slots).length === 0) continue;
    const key = `${p.school_id}|${p.decade}`;
    const cell = all.get(key) ?? {
      teamId: p.school_id,
      era: p.decade,
      powerhouse: p.is_historic_powerhouse,
      players: [],
    };
    cell.players.push(p);
    all.set(key, cell);
  }
  let cells = [...all.values()];
  if (cells.length === 0) return null; // no open slots anywhere
  if (exclude) {
    const filtered = cells.filter(notCell(exclude.teamId, exclude.era));
    if (filtered.length > 0) cells = filtered;
  }
  const cell = weightedCell(cells, rng);
  // Return the cell's FULL roster (unplaceable rows grey out in the UI).
  const full = data.players.filter(
    (p) => p.school_id === cell.teamId && p.decade === cell.era,
  );
  return { teamId: cell.teamId, era: cell.era, pool: full };
}

// ---------------------------------------------------------------------------
// Coach spin (§5.5) — coaches are sparser than players, so cells are derived
// from coaches directly: landing on a coachless {team, era} is impossible,
// which implements "re-roll until a coach is found" without looping.
// ---------------------------------------------------------------------------
function coachCells(
  data: GameData,
  opts: { decade?: Era | null; teamId?: string | null } = {},
): { teamId: string; era: Era; powerhouse: boolean; coaches: Coach[] }[] {
  const powerhouseEras = new Map(data.teams.map((t) => [t.school_id, t.powerhouse_eras]));
  const cells = new Map<string, { teamId: string; era: Era; powerhouse: boolean; coaches: Coach[] }>();
  for (const c of data.coaches) {
    if (opts.decade && c.decade !== opts.decade) continue;
    if (opts.teamId && c.school_id !== opts.teamId) continue;
    const key = `${c.school_id}|${c.decade}`;
    const cell = cells.get(key) ?? {
      teamId: c.school_id,
      era: c.decade,
      powerhouse: (powerhouseEras.get(c.school_id) ?? []).includes(c.decade),
      coaches: [],
    };
    cell.coaches.push(c);
    cells.set(key, cell);
  }
  return [...cells.values()];
}

/**
 * Spin for the 9th slot. If a decade filter yields no coaches, widen to any
 * era (§5.5 fallback). Coach re-spins draw from the same shared re-spin pool
 * (Appendix A #2, recommended option) — enforced by the caller.
 */
export function spinCoach(
  data: GameData,
  rng: Rng,
  opts: {
    decade?: Era | null;
    teamId?: string | null;
    exclude?: CoachSpinResult | null;
  } = {},
): CoachSpinResult | null {
  let cells = coachCells(data, opts);
  if (cells.length === 0 && opts.decade) {
    cells = coachCells(data, { teamId: opts.teamId }); // widen era filter
  }
  if (cells.length === 0 && opts.teamId) {
    cells = coachCells(data, {}); // widen fully
  }
  if (cells.length === 0) return null;
  if (opts.exclude) {
    const filtered = cells.filter(notCell(opts.exclude.teamId, opts.exclude.era));
    if (filtered.length > 0) cells = filtered;
  }
  // Coaches carry no OVR, so weight the cell by its best coach's tier (with the
  // same marquee brand bump the player spin uses) — parallel to talent weighting.
  const weights = cells.map(
    (c) =>
      Math.max(...c.coaches.map((co) => COACH_TIER_WEIGHT[co.coach_tier] ?? 1)) *
      (MARQUEE_TEAMS.has(c.teamId) ? MARQUEE_BUMP : 1),
  );
  const cell = pickWeighted(cells, weights, rng);
  return { teamId: cell.teamId, era: cell.era, pool: cell.coaches };
}

/** All player slots filled? → advance to COACH_SPIN (§2 state machine). */
export function allPlayerSlotsFilled(slots: PlayerSlots): boolean {
  return Object.values(slots).every((s) => s !== null);
}

export function emptyPlayerSlots(): PlayerSlots {
  return { QB: null, RB: null, WR1: null, WR2: null, DL: null, LB: null, CB: null, S: null };
}
