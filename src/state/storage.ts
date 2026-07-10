// Trophy room persistence (§9): localStorage, wrapped in try/catch so private
// mode / disabled storage degrades to in-memory-only gracefully.
import type { Resolved } from "../engine/resolve.ts";
import type { Mode } from "./store.tsx";

export interface RunSummary {
  timestamp: number;
  record: string;
  tier: string;
  favorite_team: string;
  mode: Mode;
  score: number;
  dynasty: boolean;
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

export function recordRun(
  resolved: Resolved,
  favoriteTeam: string,
  mode: Mode,
): TrophyRoom {
  const run: RunSummary = {
    timestamp: Date.now(),
    record: resolved.record,
    tier: resolved.tier,
    favorite_team: favoriteTeam,
    mode,
    score: Math.round(resolved.power * 10) / 10,
    dynasty: resolved.isDynasty,
  };
  const room = loadTrophyRoom();
  room.recent_runs = [run, ...room.recent_runs].slice(0, RECENT_CAP);
  room.top_builds = [...room.top_builds, run]
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_CAP);
  try {
    localStorage.setItem(KEY, JSON.stringify(room));
  } catch {
    // storage unavailable — the returned room still reflects this session
  }
  return room;
}
