// Spin / draft engine (§5): weighted {team, era} cell selection, re-spins,
// dual-position eligibility, duplicate block, and the §5.6 edge cases.
// Pure functions over GameData — no React, no globals, rng injected.
import type {
  Decade,
  GameData,
  GamePosition,
  Player,
  Coach,
  SlotId,
} from "../data/types.ts";
import { POS_SLOTS } from "../data/types.ts";
import { pick, type Rng } from "./rng.ts";

export const POWERHOUSE_WEIGHT = 3; // §5.3 / §12 dial
const POWERHOUSE_ONLY_DECADES: Decade[] = ["1980s", "1990s"]; // §5.3 era authenticity

export type PlayerSlots = Record<Exclude<SlotId, "HC">, Player | null>;

export interface SpinResult {
  teamId: string;
  era: Decade;
  pool: Player[];
}

export interface CoachSpinResult {
  teamId: string;
  era: Decade;
  pool: Coach[];
}

interface Cell {
  teamId: string;
  era: Decade;
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
  opts: { decade?: Decade | null; teamId?: string | null } = {},
): Cell[] {
  const cells = new Map<string, Cell>();
  for (const p of data.players) {
    if (opts.decade && p.decade !== opts.decade) continue;
    if (opts.teamId && p.school_id !== opts.teamId) continue;
    // Era authenticity: 80s/90s cells exist only for historic powerhouses.
    if (POWERHOUSE_ONLY_DECADES.includes(p.decade) && !p.is_historic_powerhouse) continue;
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

function weightedCell(cells: Cell[], rng: Rng): Cell {
  const expanded: Cell[] = [];
  for (const c of cells) {
    const w = c.powerhouse ? POWERHOUSE_WEIGHT : 1;
    for (let i = 0; i < w; i++) expanded.push(c);
  }
  return pick(expanded, rng);
}

const notCell =
  (teamId: string, era: Decade) =>
  (c: { teamId: string; era: Decade }): boolean =>
    !(c.teamId === teamId && c.era === era);

/** Default spin (§5.1): any era unless a decade filter is passed. */
export function spin(
  data: GameData,
  rng: Rng,
  opts: { decade?: Decade | null; exclude?: SpinResult | null } = {},
): SpinResult {
  let cells = playerCells(data, { decade: opts.decade });
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
  opts: { decade?: Decade | null; teamId?: string | null } = {},
): { teamId: string; era: Decade; powerhouse: boolean; coaches: Coach[] }[] {
  const powerhouseEras = new Map(data.teams.map((t) => [t.school_id, t.powerhouse_eras]));
  const cells = new Map<string, { teamId: string; era: Decade; powerhouse: boolean; coaches: Coach[] }>();
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
    decade?: Decade | null;
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
  const expanded: typeof cells = [];
  for (const c of cells) {
    const w = c.powerhouse ? POWERHOUSE_WEIGHT : 1;
    for (let i = 0; i < w; i++) expanded.push(c);
  }
  const cell = pick(expanded, rng);
  return { teamId: cell.teamId, era: cell.era, pool: cell.coaches };
}

/** All player slots filled? → advance to COACH_SPIN (§2 state machine). */
export function allPlayerSlotsFilled(slots: PlayerSlots): boolean {
  return Object.values(slots).every((s) => s !== null);
}

export function emptyPlayerSlots(): PlayerSlots {
  return { QB: null, RB: null, WR1: null, WR2: null, DL: null, LB: null, CB: null, S: null };
}

/** Which game position does a slot display/require (WR1/WR2 → WR)? */
export function slotPosition(slot: Exclude<SlotId, "HC">): GamePosition {
  return slot === "WR1" || slot === "WR2" ? "WR" : slot;
}
