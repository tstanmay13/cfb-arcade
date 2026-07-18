// Spin / draft engine (§5): weighted {team, era} cell selection, re-spins,
// dual-position eligibility, duplicate block, and the §5.6 edge cases.
// Pure functions over GameData — no React, no globals, rng injected.
//
// ADR-0031: spins are placeability-aware. Every player spin takes the board's
// slots and only lands cells holding ≥1 player you can actually place, so
// §5.6 case 2 ("pool full of people who fit nothing") is structurally
// impossible rather than re-rolled away. Re-spins stay pure taste tools.
import type {
  Coach,
  Era,
  GameData,
  Player,
  SlotId,
} from "../data/types.ts";
import { POS_SLOTS } from "../data/types.ts";
import { pick, type Rng } from "./rng.ts";

// §5.3 spin weighting — TALENT-DRIVEN and fully tweakable: every dial
// (talent curve, marquee bump, coach-tier weights, the marquee list itself)
// lives in tuning.ts, the knobs file. Re-exported here for existing callers.
import {
  COACH_TIER_WEIGHT,
  MARQUEE_BUMP,
  MARQUEE_TEAMS,
  MAX_CELL_WEIGHT,
  MIN_CELL_WEIGHT,
  TALENT_TOP_K,
} from "./tuning.ts";
export { COACH_TIER_WEIGHT, MARQUEE_BUMP, MARQUEE_TEAMS, MAX_CELL_WEIGHT, MIN_CELL_WEIGHT, TALENT_TOP_K };
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

/** ADR-0031: a cell is landable iff someone in it fits an open slot. No slots
    passed (pre-draft callers, tests) = no filter. */
const hasPlaceable = (players: Player[], slots?: PlayerSlots | null): boolean =>
  !slots || players.some((p) => eligibleOpenSlots(p, slots).length > 0);

/**
 * Default spin (§5.1): any era unless a decade filter is passed. A teamId
 * filter locks the spin to one program (used by the "keep team" token, §5.2).
 * Pass `slots` (ADR-0031) to exclude cells with nobody placeable; a locked
 * spin widens its era before it will ever land a dead pool — placeability
 * outranks the lock.
 */
export function spin(
  data: GameData,
  rng: Rng,
  opts: {
    decade?: Era | null;
    teamId?: string | null;
    exclude?: SpinResult | null;
    slots?: PlayerSlots | null;
  } = {},
): SpinResult {
  const placeable = (c: Cell) => hasPlaceable(c.players, opts.slots);
  const excluded = opts.exclude
    ? notCell(opts.exclude.teamId, opts.exclude.era)
    : () => true;
  // Widen ladder, most-specific candidate set first: as locked, era lock
  // dropped, team lock dropped. The exclude rides every rung so a paid
  // re-spin widens instead of re-serving the identical cell.
  const rungs: (() => Cell[])[] = [
    () => playerCells(data, { decade: opts.decade, teamId: opts.teamId }),
  ];
  if (opts.decade) rungs.push(() => playerCells(data, { teamId: opts.teamId }));
  if (opts.teamId) rungs.push(() => playerCells(data, {}));
  for (const rung of rungs) {
    const cells = rung().filter(placeable).filter(excluded);
    if (cells.length > 0) {
      const cell = weightedCell(cells, rng);
      return { teamId: cell.teamId, era: cell.era, pool: cell.players };
    }
  }
  // No placeable alternative anywhere: re-serving the current cell beats a
  // dead pool (only reachable when the data can't fill the open slots at all).
  for (const rung of rungs) {
    const cells = rung().filter(placeable);
    if (cells.length > 0) {
      const cell = weightedCell(cells, rng);
      return { teamId: cell.teamId, era: cell.era, pool: cell.players };
    }
  }
  // Safety net (never crash): with a placeable cell nowhere in the data the
  // draft is unfinishable anyway — fall back to the pre-0031 behavior.
  let cells = playerCells(data, { decade: opts.decade, teamId: opts.teamId });
  const filtered = cells.filter(excluded);
  if (filtered.length > 0) cells = filtered;
  const cell = weightedCell(cells, rng);
  return { teamId: cell.teamId, era: cell.era, pool: cell.players };
}

/** Team re-spin (§5.2): keep the era, re-roll the team (placeable cells only
    when `slots` is passed — ADR-0031). */
export function teamRespin(
  data: GameData,
  rng: Rng,
  current: SpinResult,
  slots?: PlayerSlots | null,
): SpinResult {
  return spin(data, rng, { decade: current.era, exclude: current, slots });
}

function eraRespinCells(
  data: GameData,
  current: { teamId: string; era: Era },
  slots?: PlayerSlots | null,
): Cell[] {
  return playerCells(data, { teamId: current.teamId })
    .filter(notCell(current.teamId, current.era))
    .filter((c) => hasPlaceable(c.players, slots));
}

/**
 * Era re-spin (§5.2): keep the team, re-roll the era (within eras_present;
 * 80s/90s only if the program was a powerhouse then; placeable cells only —
 * ADR-0031). Returns null when the team has no other eligible era — the UI
 * disables the button via canEraRespin, and a null never costs a re-spin.
 */
export function eraRespin(
  data: GameData,
  rng: Rng,
  current: SpinResult,
  slots?: PlayerSlots | null,
): SpinResult | null {
  const cells = eraRespinCells(data, current, slots);
  if (cells.length === 0) return null;
  const cell = weightedCell(cells, rng);
  return { teamId: cell.teamId, era: cell.era, pool: cell.players };
}

/** UI contract for the ERA ↻ button (player phase): false ⇒ disabled. */
export function canEraRespin(
  data: GameData,
  current: { teamId: string; era: Era },
  slots?: PlayerSlots | null,
): boolean {
  return eraRespinCells(data, current, slots).length > 0;
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

/** Why a pool row is blocked (§8.5 greying) — null when placeable. Gives the
    board a concrete caption ("RB already filled", "Already on your roster")
    instead of a mystery grey-out. */
export function blockedReason(
  player: Player,
  slots: PlayerSlots,
): { kind: "duplicate" } | { kind: "filled"; slots: Exclude<SlotId, "HC">[] } | null {
  if (eligibleOpenSlots(player, slots).length > 0) return null;
  if (isDuplicate(player, slots)) return { kind: "duplicate" };
  const candidates = new Set<Exclude<SlotId, "HC">>([
    ...(POS_SLOTS[player.primary_position] ?? []),
    ...(player.secondary_position ? POS_SLOTS[player.secondary_position] : []),
  ]);
  return { kind: "filled", slots: [...candidates] };
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
    let filtered = cells.filter(notCell(opts.exclude.teamId, opts.exclude.era));
    // Era-locked re-spin with no same-era alternative: widen the era (mirror
    // of the player ladder) instead of re-serving the identical cell.
    if (filtered.length === 0 && opts.decade) {
      filtered = coachCells(data, { teamId: opts.teamId }).filter(
        notCell(opts.exclude.teamId, opts.exclude.era),
      );
    }
    // No alternative cell anywhere → null, and the caller must not charge a
    // re-spin (charging for the same pool again was ADR-0031's coach bug).
    if (filtered.length === 0) return null;
    cells = filtered;
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

/** UI contract for TEAM ↻ in the coach phase: false ⇒ disabled. The coach
    team re-spin widens its era when cornered, so any other coach cell works. */
export function canCoachTeamRespin(
  data: GameData,
  current: { teamId: string; era: Era },
): boolean {
  return coachCells(data, {}).filter(notCell(current.teamId, current.era)).length > 0;
}

/** UI contract for ERA ↻ in the coach phase: false ⇒ disabled (the program
    has coaches in no other era — a re-spin could only re-serve this cell). */
export function canCoachEraRespin(
  data: GameData,
  current: { teamId: string; era: Era },
): boolean {
  return (
    coachCells(data, { teamId: current.teamId }).filter(notCell(current.teamId, current.era))
      .length > 0
  );
}

/** All player slots filled? → advance to COACH_SPIN (§2 state machine). */
export function allPlayerSlotsFilled(slots: PlayerSlots): boolean {
  return Object.values(slots).every((s) => s !== null);
}

export function emptyPlayerSlots(): PlayerSlots {
  return { QB: null, RB: null, WR1: null, WR2: null, DL: null, LB: null, CB: null, S: null };
}
