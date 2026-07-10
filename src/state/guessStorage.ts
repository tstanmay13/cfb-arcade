// Guess the Season daily streak (companion to the draft's trophy room).
// localStorage wrapped in try/catch so private mode degrades to in-memory —
// same style as storage.ts. Only DAILY results move the streak; free play never
// touches it.
import { MAX_GUESSES } from "../engine/guessSeason.ts";

export interface GuessStats {
  /** Highest daily puzzle number already recorded (0 = none yet). */
  lastPuzzle: number;
  streak: number;
  maxStreak: number;
  played: number;
  wins: number;
  /** Wins-by-guess-count histogram, index 0 = solved in 1 guess. */
  dist: number[];
}

const KEY = "the-16-0-draft:guess_season";

export function emptyGuessStats(): GuessStats {
  return { lastPuzzle: 0, streak: 0, maxStreak: 0, played: 0, wins: 0, dist: Array(MAX_GUESSES).fill(0) };
}

export function loadGuessStats(): GuessStats {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as GuessStats;
      if (typeof p.streak === "number" && Array.isArray(p.dist)) {
        return { ...emptyGuessStats(), ...p, dist: [...p.dist] };
      }
    }
  } catch {
    // fall through to a fresh record
  }
  return emptyGuessStats();
}

/**
 * Record a finished DAILY puzzle and return the updated stats. Idempotent per
 * puzzle number: replaying the same day is a no-op (guards React StrictMode /
 * accidental double-submits), so the streak can only advance once a day.
 */
export function recordDailyResult(puzzle: number, won: boolean, guessCount: number): GuessStats {
  const stats = loadGuessStats();
  if (puzzle <= stats.lastPuzzle) return stats; // already recorded this day

  stats.played += 1;
  if (won) {
    stats.wins += 1;
    stats.streak = puzzle === stats.lastPuzzle + 1 ? stats.streak + 1 : 1;
    stats.maxStreak = Math.max(stats.maxStreak, stats.streak);
    if (guessCount >= 1 && guessCount <= MAX_GUESSES) stats.dist[guessCount - 1] += 1;
  } else {
    stats.streak = 0;
  }
  stats.lastPuzzle = puzzle;

  try {
    localStorage.setItem(KEY, JSON.stringify(stats));
  } catch {
    // storage unavailable — the returned object still reflects this session
  }
  return stats;
}
