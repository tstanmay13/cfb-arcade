// Guess the Season — pure engine. Show a real team-season's game-by-game
// results (from cfb_games); the player identifies team + year in 6 guesses.
// Hints unlock per wrong guess. No React/DOM here; unit-tested.
import { mulberry32 } from "./rng.ts";

export interface SeasonGame {
  /** 1-based display order (regular season then postseason). */
  n: number;
  res: "W" | "L";
  us: number;
  them: number;
  opp: string;
  post: boolean;
}

export interface SeasonEntry {
  school_id: string;
  team: string;
  season: number;
  conference: string;
  record: string;
  games: SeasonGame[];
  star: { name: string; pos: string; ovr: number };
}

export interface SeasonsCatalog {
  version: number;
  generated_at: string;
  entries: SeasonEntry[];
}

export const MAX_GUESSES = 6;
/** Year feedback: |Δ| ≤ CLOSE_YEARS shows amber. */
export const CLOSE_YEARS = 2;

export interface Guess {
  school_id: string;
  season: number;
}

export interface GuessFeedback {
  teamHit: boolean;
  /** answer.season - guess.season → sign says "go later/earlier"; 0 = hit. */
  yearDiff: number;
  win: boolean;
}

export function evaluateGuess(guess: Guess, answer: SeasonEntry): GuessFeedback {
  const teamHit = guess.school_id === answer.school_id;
  const yearDiff = answer.season - guess.season;
  return { teamHit, yearDiff, win: teamHit && yearDiff === 0 };
}

/** Hints unlocked after `wrong` incorrect guesses (cumulative). */
export interface Hints {
  conference: boolean;
  starPosition: boolean;
  opponents: boolean;
  starName: boolean;
}

export function hintsFor(wrong: number): Hints {
  return {
    conference: wrong >= 1,
    starPosition: wrong >= 2,
    opponents: wrong >= 3,
    starName: wrong >= 4,
  };
}

/** Which opponents get revealed by the opponents hint (spread across the
    slate, deterministic). */
export function revealedOpponentIndices(gameCount: number): number[] {
  if (gameCount === 0) return [];
  const picks = [1, Math.floor(gameCount / 2), gameCount - 1];
  return [...new Set(picks.map((i) => Math.min(Math.max(i, 0), gameCount - 1)))];
}

/** Daily puzzle number (#1 = 2026-07-10, the mode's launch day). */
const EPOCH_UTC = Date.UTC(2026, 6, 10);
const DAY_MS = 24 * 60 * 60 * 1000;

export function puzzleNumber(date: Date): number {
  return Math.max(1, Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - EPOCH_UTC) / DAY_MS) + 1);
}

/** Deterministic daily pick: same catalog + same date → same puzzle. */
export function dailyIndex(catalogLength: number, date: Date): number {
  const seed = date.getFullYear() * 10000 + (date.getMonth() + 1) * 100 + date.getDate();
  return Math.floor(mulberry32(seed)() * catalogLength);
}

/** Wordle-style copy text: one 🟩/🟨/⬛ pair per guess (team, year). */
export function buildGuessShareText(
  feedbacks: GuessFeedback[],
  opts: { puzzle: number | null; won: boolean },
): string {
  const rows = feedbacks
    .map((f) => {
      const team = f.teamHit ? "🟩" : "⬛";
      const year = f.yearDiff === 0 ? "🟩" : Math.abs(f.yearDiff) <= CLOSE_YEARS ? "🟨" : "⬛";
      return team + year;
    })
    .join(" ");
  const header = opts.puzzle === null ? "🏈 GUESS THE SEASON (free play)" : `🏈 GUESS THE SEASON #${opts.puzzle}`;
  const score = opts.won ? `${feedbacks.length}/${MAX_GUESSES}` : `X/${MAX_GUESSES}`;
  return [header, `${score}  ${rows}`].join("\n");
}
