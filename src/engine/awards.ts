// Awards & post-season (§7): cosmetic stat fluff, the Heisman engine with the
// Paul Hornung rule, and All-American evaluation. None of this affects the
// record — hidden_ovr already decided it at §6.
import type { Player, PerformanceCategory, StatBlock } from "../data/types.ts";
import type { Rng } from "./rng.ts";
import type { PlayerSlots } from "./spin.ts";

// ---------------------------------------------------------------------------
// §7.1 Cosmetic stat-fluff engine (20% equal distribution)
// ---------------------------------------------------------------------------
export interface Fluffed {
  value: number;
  appliedModifier: number;
  category: PerformanceCategory;
}

/** Round to the base stat's own precision so ratio stats keep their decimals. */
function roundLike(base: number, value: number): number {
  return Number.isInteger(base) ? Math.round(value) : Math.round(value * 10) / 10;
}

/**
 * Apply cosmetic stat modifier with 20% equal distribution:
 * - 20% significantly worse (70-75%)
 * - 20% marginally worse (85-95%)
 * - 20% same (98-102%)
 * - 20% marginally better (105-115%)
 * - 20% significantly better (125-135%)
 */
export function calculateStatFluff(baseStat: number, rng: Rng): Fluffed {
  const roll = rng();
  let modifier: number;
  let category: PerformanceCategory;

  if (roll < 0.2) {
    // Significantly worse: 70-75% of base
    modifier = 0.70 + rng() * 0.05;
    category = "significantly_worse";
  } else if (roll < 0.4) {
    // Marginally worse: 85-95% of base
    modifier = 0.85 + rng() * 0.10;
    category = "marginally_worse";
  } else if (roll < 0.6) {
    // Same: 98-102% of base
    modifier = 0.98 + rng() * 0.04;
    category = "same";
  } else if (roll < 0.8) {
    // Marginally better: 105-115% of base
    modifier = 1.05 + rng() * 0.10;
    category = "marginally_better";
  } else {
    // Significantly better: 125-135% of base
    modifier = 1.25 + rng() * 0.10;
    category = "significantly_better";
  }

  return {
    value: roundLike(baseStat, baseStat * modifier),
    appliedModifier: modifier,
    category,
  };
}

export interface FluffedPlayer {
  stats: StatBlock;
  /** Max applied modifier across the 5 stats — feeds the Hornung rule. */
  computedModifier: number;
  /** Overall performance category based on average modifier. */
  performance: PerformanceCategory;
}

/** Determine overall performance category from average modifier. */
function categorizePerformance(avgModifier: number): PerformanceCategory {
  if (avgModifier < 0.80) return "significantly_worse";
  if (avgModifier < 0.95) return "marginally_worse";
  if (avgModifier < 1.05) return "same";
  if (avgModifier < 1.20) return "marginally_better";
  return "significantly_better";
}

export function fluffPlayerStats(player: Player, rng: Rng): FluffedPlayer {
  const keys = ["stat_1", "stat_2", "stat_3", "stat_4", "stat_5"] as const;
  const stats = {} as StatBlock;
  let max = 0;
  let sum = 0;
  for (const k of keys) {
    const f = calculateStatFluff(player.stats[k], rng);
    stats[k] = f.value;
    max = Math.max(max, f.appliedModifier);
    sum += f.appliedModifier;
  }
  const avgModifier = sum / 5;
  return { stats, computedModifier: max, performance: categorizePerformance(avgModifier) };
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
  // Paul Hornung exception first: find the player with the HIGHEST stat eruption
  // (modifier >= 1.20), then give them a 25% Heisman chance.
  let hornungCandidate: { player: Player; modifier: number } | null = null;
  for (const p of Object.values(slots)) {
    if (!p) continue;
    const mod = modifiers.get(p.player_id) ?? 0;
    if (mod >= 1.2) {
      if (!hornungCandidate || mod > hornungCandidate.modifier) {
        hornungCandidate = { player: p, modifier: mod };
      }
    }
  }
  if (hornungCandidate && rng() <= 0.25) {
    return {
      name: hornungCandidate.player.name,
      position: hornungCandidate.player.primary_position,
      viaHornung: true,
    };
  }

  // Standard path: tier-based chance with positional weighting
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
// §7.2b Position awards — Biletnikoff (WR), Butkus (LB), Jim Thorpe (CB/S),
// Doak Walker (RB). Calculated like the Heisman's Hornung path (breakout-only,
// no tier "standard path"): EVERY eligible player on the roster rolls for the
// award on his own — a stat eruption gives a 35% chance, a lone green arrow 5%.
// If both eligible players (the two WRs, or CB + S) win their rolls, the single
// trophy goes to the higher-rated one. A team keeps at most 2 of these awards
// (3 for a Tier-0 board); the Heisman is separate and does not count toward the
// cap, but its winner's position award is kept first when trimming.
// ---------------------------------------------------------------------------
export type PositionAwardKey = "biletnikoff" | "butkus" | "thorpe" | "doakWalker";

export const POSITION_AWARD_LABELS: Record<PositionAwardKey, string> = {
  biletnikoff: "Biletnikoff",
  butkus: "Butkus",
  thorpe: "Jim Thorpe",
  doakWalker: "Doak Walker",
};

/** Fixed order → deterministic rng consumption. */
const POSITION_AWARD_ORDER: PositionAwardKey[] = ["biletnikoff", "butkus", "thorpe", "doakWalker"];

/** Which board slots each award draws from. */
const POSITION_AWARD_SLOTS: Record<PositionAwardKey, (keyof PlayerSlots)[]> = {
  biletnikoff: ["WR1", "WR2"],
  butkus: ["LB"],
  thorpe: ["CB", "S"],
  doakWalker: ["RB"],
};

export interface PositionAwardWinner {
  award: PositionAwardKey;
  playerId: string;
  name: string;
  position: string;
}

/** Win chance from a candidate's computedModifier (max fluff across 5 stats):
    a significantly-better eruption (>=1.20) is 35%; a lone green arrow
    (marginally better, 1.05–1.19) is 5%; a flat/worse line can't win. */
export function positionAwardChance(computedModifier: number): number {
  if (computedModifier >= 1.2) return 0.35;
  if (computedModifier >= 1.05) return 0.05;
  return 0;
}

export function processPositionAwards(
  teamTier: string,
  slots: PlayerSlots,
  modifiers: Map<string, number>, // player_id -> computedModifier
  heismanName: string | null,
  rng: Rng,
): PositionAwardWinner[] {
  const raw: { award: PositionAwardKey; player: Player }[] = [];
  for (const award of POSITION_AWARD_ORDER) {
    // Every eligible player rolls independently on his own breakout. If more
    // than one wins the single trophy, the higher-rated player takes it (bigger
    // breakout as a further tiebreak).
    let winner: { player: Player; mod: number } | null = null;
    for (const slot of POSITION_AWARD_SLOTS[award]) {
      const p = slots[slot];
      if (!p) continue;
      const mod = modifiers.get(p.player_id) ?? 0;
      const chance = positionAwardChance(mod);
      if (chance <= 0 || rng() > chance) continue; // didn't win his roll
      if (
        !winner ||
        p.hidden_ovr > winner.player.hidden_ovr ||
        (p.hidden_ovr === winner.player.hidden_ovr && mod > winner.mod)
      ) {
        winner = { player: p, mod };
      }
    }
    if (winner) raw.push({ award, player: winner.player });
  }

  // Cap: 2 (soft) or 3 for a truly exceptional Tier-0 board. When more fire,
  // protect the Heisman winner's award first, then keep the highest-OVR players.
  const cap = teamTier === "Tier0" ? 3 : 2;
  if (raw.length > cap) {
    raw.sort((a, b) => {
      const aH = a.player.name === heismanName ? 1 : 0;
      const bH = b.player.name === heismanName ? 1 : 0;
      if (aH !== bH) return bH - aH;
      return b.player.hidden_ovr - a.player.hidden_ovr;
    });
    raw.length = cap;
  }

  return raw.map(({ award, player }) => ({
    award,
    playerId: player.player_id,
    name: player.name,
    position: player.primary_position,
  }));
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
