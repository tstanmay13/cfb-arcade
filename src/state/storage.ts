// Trophy room persistence (§9): localStorage, wrapped in try/catch so private
// mode / disabled storage degrades to in-memory-only gracefully.
import type { Coach, Decade, GamePosition, SlotId } from "../data/types.ts";
import { PLAYER_SLOTS } from "../data/types.ts";
import { POSITION_AWARD_LABELS } from "../engine/awards.ts";
import type { Resolved } from "../engine/resolve.ts";
import type { PlayerSlots } from "../engine/spin.ts";
import type { Mode } from "./store.tsx";

/** A drafted player as saved with a run — enough to replay the box score in the
    trophy-room popup without keeping the whole engine object. */
export interface RunPlayer {
  slot: Exclude<SlotId, "HC">;
  name: string;
  position: GamePosition; // primary_position → drives STAT_LABELS
  school: string;
  decade: Decade;
  stats: [number, number, number, number, number]; // fluffed season line
  heisman?: boolean;
  allAmerican?: boolean;
  positionAward?: string; // display label, e.g. "Biletnikoff"
}

export interface RunCoach {
  name: string;
  school: string;
  tier: string;
}

export interface RunSummary {
  timestamp: number;
  record: string;
  tier: string;
  favorite_team: string;
  mode: Mode;
  score: number;
  dynasty: boolean;
  // Season highlights (optional for backward compatibility)
  heisman?: boolean;
  allAmericansCount?: number;
  outcome?: string; // "natty" | "semis" | "major" | "minor" | "loss"
  /** Position awards won (display label + winner name), for the row badges. */
  positionAwards?: { award: string; name: string }[];
  // Roster snapshot (optional — runs saved before this existed won't have it).
  roster?: RunPlayer[];
  coach?: RunCoach;
}

export interface TrophyRoom {
  recent_runs: RunSummary[]; // ring buffer, newest first, cap 25
  top_builds: RunSummary[]; // by score desc, cap 10
}

const KEY = "the-16-0-draft:trophy_room";
const RECENT_CAP = 25;
const TOP_CAP = 10;

export function loadTrophyRoom(): TrophyRoom {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TrophyRoom;
      if (Array.isArray(parsed.recent_runs) && Array.isArray(parsed.top_builds)) {
        return parsed;
      }
    }
  } catch {
    // fall through
  }
  return { recent_runs: [], top_builds: [] };
}

// Last-played team (§2 QoL): remember the program + mode the player last ran so
// the picker can auto-select it, letting them fire off another run without
// re-choosing every time. Same fail-silent localStorage discipline.
const LAST_TEAM_KEY = "the-16-0-draft:last_team";

export interface LastTeam {
  schoolId: string;
  mode: Mode;
}

export function loadLastTeam(): LastTeam | null {
  try {
    const raw = localStorage.getItem(LAST_TEAM_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LastTeam;
      if (typeof parsed.schoolId === "string" && parsed.schoolId) {
        return { schoolId: parsed.schoolId, mode: parsed.mode === "Scout" ? "Scout" : "Classic" };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

export function saveLastTeam(schoolId: string, mode: Mode): void {
  try {
    localStorage.setItem(LAST_TEAM_KEY, JSON.stringify({ schoolId, mode }));
  } catch {
    // storage unavailable — non-fatal
  }
}

// Best-builds ranking (§9). What makes a build "best" is what it ACHIEVED, not
// how strong the roster looked: rank by playoff depth first (a national title
// beats a stacked roster that went 12-2), then by honors (All-Americans +
// Heisman), then by raw roster power, then most recent as a stable tiebreak.
const OUTCOME_DEPTH: Record<string, number> = {
  natty: 4, // national champions
  semis: 3, // final four
  major: 2, // playoff quarterfinal
  minor: 1, // bowl game
  loss: 0,
};

function playoffDepth(r: RunSummary): number {
  // A dynasty (Tier-0 title) sits above a lone championship.
  if (r.dynasty) return 5;
  return OUTCOME_DEPTH[r.outcome ?? "loss"] ?? 0;
}

function honors(r: RunSummary): number {
  // Heisman is one elite player, weighted a touch above a single All-American.
  return (r.allAmericansCount ?? 0) + (r.heisman ? 2 : 0);
}

/** Best-builds comparator: playoff depth → honors → roster power → recency. */
export function compareBuilds(a: RunSummary, b: RunSummary): number {
  return (
    playoffDepth(b) - playoffDepth(a) ||
    honors(b) - honors(a) ||
    b.score - a.score ||
    b.timestamp - a.timestamp
  );
}

export function recordRun(
  resolved: Resolved,
  favoriteTeam: string,
  mode: Mode,
  slots: PlayerSlots,
  coach: Coach,
): TrophyRoom {
  const aaIds = new Set(resolved.allAmericans);
  const posAwardByPlayer = new Map(
    resolved.positionAwards.map((a) => [a.playerId, POSITION_AWARD_LABELS[a.award]]),
  );
  const roster: RunPlayer[] = [];
  for (const slot of PLAYER_SLOTS) {
    const p = slots[slot];
    if (!p) continue;
    const s = resolved.fluffedStats[p.player_id] ?? p.stats;
    roster.push({
      slot,
      name: p.name,
      position: p.primary_position,
      school: p.school,
      decade: p.decade,
      stats: [s.stat_1, s.stat_2, s.stat_3, s.stat_4, s.stat_5],
      // Heisman carries no player_id; it's one of this roster's players by name.
      heisman: resolved.heisman?.name === p.name || undefined,
      allAmerican: aaIds.has(p.player_id) || undefined,
      positionAward: posAwardByPlayer.get(p.player_id),
    });
  }

  const run: RunSummary = {
    timestamp: Date.now(),
    record: resolved.record,
    tier: resolved.tier,
    favorite_team: favoriteTeam,
    mode,
    score: Math.round(resolved.power * 10) / 10,
    dynasty: resolved.isDynasty,
    heisman: resolved.heisman !== null,
    allAmericansCount: resolved.allAmericans.length,
    outcome: resolved.outcome,
    positionAwards: resolved.positionAwards.map((a) => ({
      award: POSITION_AWARD_LABELS[a.award],
      name: a.name,
    })),
    roster,
    coach: { name: coach.name, school: coach.school, tier: coach.coach_tier },
  };
  const room = loadTrophyRoom();
  room.recent_runs = [run, ...room.recent_runs].slice(0, RECENT_CAP);
  room.top_builds = [...room.top_builds, run]
    .sort(compareBuilds)
    .slice(0, TOP_CAP);
  try {
    localStorage.setItem(KEY, JSON.stringify(room));
  } catch {
    // storage unavailable — the returned room still reflects this session
  }
  return room;
}
