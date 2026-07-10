// Awards & post-season (§7): cosmetic stat fluff, the Heisman engine with the
// Paul Hornung rule, and All-American evaluation. None of this affects the
// record — hidden_ovr already decided it at §6.
import type { Player, StatBlock } from "../data/types.ts";
import type { Rng } from "./rng.ts";
import type { PlayerSlots } from "./spin.ts";

// ---------------------------------------------------------------------------
// §7.1 Cosmetic stat-fluff engine
// ---------------------------------------------------------------------------
export interface Fluffed {
  value: number;
  appliedModifier: number;
}

/** Round to the base stat's own precision so ratio stats keep their decimals. */
function roundLike(base: number, value: number): number {
  return Number.isInteger(base) ? Math.round(value) : Math.round(value * 10) / 10;
}

export function calculateStatFluff(baseStat: number, rng: Rng): Fluffed {
  const roll = rng();
  let modifier: number;
  if (roll <= 0.4) modifier = rng() * (1.3 - 0.7) + 0.7; // wild swing
  else if (roll <= 0.8) modifier = rng() * (1.1 - 0.9) + 0.9; // mild variance
  else modifier = rng() * (1.02 - 0.98) + 0.98; // stat lock
  return { value: roundLike(baseStat, baseStat * modifier), appliedModifier: modifier };
}

export interface FluffedPlayer {
  stats: StatBlock;
  /** Max applied modifier across the 5 stats — feeds the Hornung rule. */
  computedModifier: number;
}

export function fluffPlayerStats(player: Player, rng: Rng): FluffedPlayer {
  const keys = ["stat_1", "stat_2", "stat_3", "stat_4", "stat_5"] as const;
  const stats = {} as StatBlock;
  let max = 0;
  for (const k of keys) {
    const f = calculateStatFluff(player.stats[k], rng);
    stats[k] = f.value;
    max = Math.max(max, f.appliedModifier);
  }
  return { stats, computedModifier: max };
}

// ---------------------------------------------------------------------------
// §7.2 Heisman engine (Paul Hornung rule)
// ---------------------------------------------------------------------------
export interface HeismanWinner {
  name: string;
  position: string;
  viaHornung: boolean;
}

const HEISMAN_THRESHOLDS: Record<string, number> = {
  Tier0: 0.8,
  Tier1: 0.4,
  Tier2: 0.15,
  Tier3: 0.1,
  Tier4: 0.05,
};

export function processHeismanAward(
  teamTier: string,
  slots: PlayerSlots,
  modifiers: Map<string, number>, // player_id -> computedModifier
  rng: Rng,
): HeismanWinner | null {
  // Paul Hornung exception first: a stat-line eruption (≥1.20) earns a
  // standalone 25% check that overrides tier restrictions.
  for (const p of Object.values(slots)) {
    if (!p) continue;
    if ((modifiers.get(p.player_id) ?? 0) >= 1.2 && rng() <= 0.25) {
      return { name: p.name, position: p.primary_position, viaHornung: true };
    }
  }
  const chance = HEISMAN_THRESHOLDS[teamTier] ?? 0.05;
  if (rng() <= chance) {
    const r = rng();
    const slot = r <= 0.65 ? "QB" : r <= 0.85 ? "RB" : "WR1";
    const p = slots[slot];
    if (p) return { name: p.name, position: p.primary_position, viaHornung: false };
  }
  return null;
}

// ---------------------------------------------------------------------------
// §7.3 All-American evaluation
// ---------------------------------------------------------------------------
export const ALL_AMERICAN_COEFF = 0.015; // §12 dial
export const ALL_AMERICAN_FLOOR = 60;

export function allAmericanChance(hiddenOvr: number): number {
  return Math.min(1, Math.max(0, (hiddenOvr - ALL_AMERICAN_FLOOR) * ALL_AMERICAN_COEFF));
}

export function selectAllAmericans(slots: PlayerSlots, rng: Rng): Player[] {
  return Object.values(slots).filter(
    (p): p is Player => p !== null && rng() <= allAmericanChance(p.hidden_ovr),
  );
}
