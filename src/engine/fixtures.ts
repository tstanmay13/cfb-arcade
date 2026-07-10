// Tiny synthetic GameData for engine unit tests — hermetic, no data.json.
import type {
  Coach,
  CoachTier,
  Decade,
  GameData,
  GamePosition,
  Player,
  Team,
} from "../data/types.ts";

let n = 0;

export function mkPlayer(over: Partial<Player> & { primary_position: GamePosition }): Player {
  n += 1;
  const name = over.name ?? `Player ${n}`;
  return {
    player_id: over.player_id ?? `${over.primary_position.toLowerCase()}_p${n}_${over.school_id ?? "aaa"}_${over.decade ?? "2020s"}`,
    name,
    display_short: over.display_short ?? name,
    jersey_number: over.jersey_number ?? String((n % 99) + 1),
    secondary_position: over.secondary_position ?? null,
    school: over.school ?? over.school_id ?? "AAA",
    school_id: over.school_id ?? "aaa",
    decade: over.decade ?? "2020s",
    historical_conference: over.historical_conference ?? "Test",
    is_historic_powerhouse: over.is_historic_powerhouse ?? false,
    hidden_ovr: over.hidden_ovr ?? 85,
    stats: over.stats ?? { stat_1: 100, stat_2: 10, stat_3: 5, stat_4: 50, stat_5: 3 },
    ...{ primary_position: over.primary_position },
  };
}

export function mkCoach(over: Partial<Coach> & { school_id: string; decade: Decade }): Coach {
  n += 1;
  const name = over.name ?? `Coach ${n}`;
  return {
    coach_id: over.coach_id ?? `hc_c${n}_${over.school_id}_${over.decade}`,
    name,
    display_short: over.display_short ?? name,
    school: over.school ?? over.school_id,
    school_id: over.school_id,
    decade: over.decade,
    historical_conference: over.historical_conference ?? "Test",
    coach_tier: (over.coach_tier ?? "Standard") as CoachTier,
    stats: over.stats ?? { stat_1: 50, stat_2: 0, stat_3: 1, stat_4: 50, stat_5: 100 },
  };
}

export function mkTeam(over: Partial<Team> & { school_id: string }): Team {
  return {
    name: over.name ?? over.school_id.toUpperCase(),
    mascot: over.mascot ?? "Testers",
    mainHex: over.mainHex ?? "#112233",
    accentHex: over.accentHex ?? "#ffffff",
    eras_present: over.eras_present ?? ["2020s"],
    is_historic_powerhouse: over.is_historic_powerhouse ?? (over.powerhouse_eras ?? []).length > 0,
    powerhouse_eras: over.powerhouse_eras ?? [],
    ...{ school_id: over.school_id },
  };
}

/** A full-position roster for one {team, era} cell. */
export function fullCell(
  schoolId: string,
  decade: Decade,
  opts: { powerhouse?: boolean; ovr?: number } = {},
): Player[] {
  const positions: GamePosition[] = ["QB", "RB", "WR", "WR", "DL", "LB", "CB", "S"];
  return positions.map((pos) =>
    mkPlayer({
      primary_position: pos,
      school_id: schoolId,
      decade,
      is_historic_powerhouse: opts.powerhouse ?? false,
      hidden_ovr: opts.ovr ?? 85,
    }),
  );
}

export function mkData(over: Partial<GameData> = {}): GameData {
  return {
    version: 1,
    generated_at: "test",
    teams: over.teams ?? [],
    players: over.players ?? [],
    coaches: over.coaches ?? [],
  };
}
