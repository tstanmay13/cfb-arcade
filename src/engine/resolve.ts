// SIM_RESOLVE (§2): one synchronous call producing runState.resolved. The
// results/season screens only ever read this object — no rng after this point.
import type { Coach, GameData, PerformanceCategory, StatBlock } from "../data/types.ts";
import type { Rng } from "./rng.ts";
import type { PlayerSlots } from "./spin.ts";
import {
  generateSchedule,
  powerScore,
  recordString,
  resolveOutcome,
  type Outcome,
  type ScheduledGame,
  type TierKey,
} from "./sim.ts";
import {
  fluffPlayerStats,
  processHeismanAward,
  processPositionAwards,
  selectAllAmericans,
  type HeismanWinner,
  type PositionAwardWinner,
} from "./awards.ts";

export interface Resolved {
  power: number;
  tier: TierKey;
  outcome: Outcome;
  isDynasty: boolean;
  schedule: ScheduledGame[];
  record: string;
  /** player_id → fluffed (displayed) stat block (§7.1). */
  fluffedStats: Record<string, StatBlock>;
  /** player_id → season performance category (20% distribution). */
  playerPerformance: Record<string, PerformanceCategory>;
  heisman: HeismanWinner | null;
  /** Position awards won this season (§7.2b), after the 2/3 cap. */
  positionAwards: PositionAwardWinner[];
  /** player_ids of All-American selections (§7.3). */
  allAmericans: string[];
}

/** Schedule filler so a 16-game slate isn't all 12 in-game programs. */
const FILLER_OPPONENTS = [
  "Boise State",
  "TCU",
  "Arkansas",
  "West Virginia",
  "Fresno State",
  "Iowa",
  "Colorado",
  "Missouri",
];

export function resolveSeason(
  slots: PlayerSlots,
  coach: Coach,
  data: GameData,
  rng: Rng,
): Resolved {
  const power = powerScore(slots, coach);
  const { tier, outcome, isDynasty } = resolveOutcome(power, rng);
  const opponents = [...data.teams.map((t) => t.name), ...FILLER_OPPONENTS];
  const schedule = generateSchedule(outcome, rng, opponents, power); // ADR-0032 record tilt

  const fluffedStats: Record<string, StatBlock> = {};
  const playerPerformance: Record<string, PerformanceCategory> = {};
  const modifiers = new Map<string, number>();
  for (const p of Object.values(slots)) {
    if (!p) continue;
    const f = fluffPlayerStats(p, rng);
    fluffedStats[p.player_id] = f.stats;
    playerPerformance[p.player_id] = f.performance;
    modifiers.set(p.player_id, f.computedModifier);
  }

  const heisman = processHeismanAward(tier, slots, modifiers, rng);
  const positionAwards = processPositionAwards(tier, slots, modifiers, heisman?.name ?? null, rng);
  const allAmericans = selectAllAmericans(slots, rng).map((p) => p.player_id);

  return {
    power,
    tier,
    outcome,
    isDynasty,
    schedule,
    record: recordString(schedule),
    fluffedStats,
    playerPerformance,
    heisman,
    positionAwards,
    allAmericans,
  };
}
