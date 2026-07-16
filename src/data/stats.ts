// Global arcade stats (ADR-0019): fire-and-forget result reporting + aggregate
// reads, straight from the browser with the anon key. This is the ONE runtime
// network touch in the arcade (game data stays baked, pillar #4), so it must
// FAIL SAFE: every path here is wrapped, timeboxed, and silent — a dead network
// can never block or break a game.
//
// Server side (supabase/migrations/0006_arcade_results.sql): the anon role can
// only INSERT into arcade_results (append-only, RLS + revoked SELECT); reads
// happen through the SECURITY DEFINER aggregate RPC arcade_daily_stats. No PII:
// player_hash is a random id minted locally, never tied to a person.

// Anon (publishable) key — safe to embed by design; same one as scripts/build-*.ts.
const SUPABASE_URL = "https://owwjabhinvwoaarjbmgm.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93d2phYmhpbnZ3b2FhcmpibWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMjcxNjgsImV4cCI6MjA5ODYwMzE2OH0.sIQ5UlK9aOl60CUL7cqWH9NHiaDxgJMNIOkpo44tme8";

const TIMEOUT_MS = 8_000;

export type ArcadeGame = "guess_season" | "draft";

export interface ArcadeResult {
  game: ArcadeGame;
  /** Daily puzzle number; null for free play. */
  puzzleNumber: number | null;
  won: boolean;
  guessCount: number;
  /** One entry per guess, e.g. "georgia 2021". */
  guesses: string[];
  hintsUsed: number;
  timeToCompleteSeconds: number | null;
}

export interface GlobalStats {
  plays: number;
  wins: number;
  /** 0–100, null when nobody has played the scope yet. */
  winPct: number | null;
  /** Wins by guess count, keys "1"–"6". */
  guessDistribution: Record<string, number>;
  avgGuesses: number | null;
  /** Distinct anonymous players in scope; null until the v2 RPC is live. */
  players: number | null;
  avgHints: number | null;
  /** Median winning solve time in seconds; null when nobody's won with a time. */
  medianTimeSeconds: number | null;
  /** Most-guessed "school_id season" strings in scope, most popular first. */
  topGuesses: { guess: string; n: number }[];
}

export interface OverviewStats {
  allTime: { plays: number; wins: number; winPct: number | null; players: number };
  today: { plays: number; players: number; wins: number };
  /** Zero-filled per-day series (UTC days), oldest first. */
  series: { day: string; plays: number; players: number; wins: number }[];
}

const HASH_KEY = "the-16-0-draft:player_hash";

function headers(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };
}

/** Stable anonymous id (localStorage); private mode gets a per-session one.
    UI-side randomness, not engine code — same carve-out as free-play rounds. */
export function getPlayerHash(): string {
  let fresh = "";
  try {
    const existing = localStorage.getItem(HASH_KEY);
    if (existing && existing.length >= 8 && existing.length <= 64) return existing;
    fresh = crypto.randomUUID();
    localStorage.setItem(HASH_KEY, fresh);
    return fresh;
  } catch {
    return fresh || `anon-${Math.random().toString(36).slice(2, 14)}`;
  }
}

/**
 * Report a finished game. Fire-and-forget: returns immediately, swallows every
 * failure, and uses keepalive so a result fired right before a tab closes still
 * lands. The insert asks for `return=minimal` — the anon role has no SELECT, so
 * a RETURNING payload would be rejected.
 */
export function recordResult(result: ArcadeResult): void {
  try {
    void fetch(`${SUPABASE_URL}/rest/v1/arcade_results`, {
      method: "POST",
      headers: { ...headers(), Prefer: "return=minimal" },
      body: JSON.stringify({
        game: result.game,
        puzzle_number: result.puzzleNumber,
        won: result.won,
        guess_count: result.guessCount,
        guesses: result.guesses.slice(0, 6),
        hints_used: result.hintsUsed,
        time_to_complete_seconds:
          result.timeToCompleteSeconds === null
            ? null
            : Math.max(0, Math.min(86_400, Math.round(result.timeToCompleteSeconds))),
        player_hash: getPlayerHash(),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // never let a stats report surface in the game
  }
}

/** Aggregates for one puzzle (or all-time when puzzle is null); null = unavailable. */
export async function fetchGlobalStats(
  game: ArcadeGame,
  puzzle: number | null,
): Promise<GlobalStats | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/arcade_daily_stats`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ game, puzzle }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const raw = (await resp.json()) as {
      plays?: number;
      wins?: number;
      win_pct?: number | null;
      guess_distribution?: Record<string, number>;
      avg_guesses?: number | null;
      players?: number | null;
      avg_hints?: number | null;
      median_time_seconds?: number | null;
      top_guesses?: { guess?: string; n?: number }[] | null;
    };
    if (typeof raw?.plays !== "number") return null;
    return {
      plays: raw.plays,
      wins: raw.wins ?? 0,
      winPct: raw.win_pct ?? null,
      guessDistribution: raw.guess_distribution ?? {},
      avgGuesses: raw.avg_guesses ?? null,
      players: typeof raw.players === "number" ? raw.players : null,
      avgHints: raw.avg_hints ?? null,
      medianTimeSeconds: raw.median_time_seconds ?? null,
      topGuesses: Array.isArray(raw.top_guesses)
        ? raw.top_guesses.flatMap((t) =>
            typeof t?.guess === "string" && typeof t?.n === "number" ? [{ guess: t.guess, n: t.n }] : [],
          )
        : [],
    };
  } catch {
    return null;
  }
}

/**
 * All-time + today totals and a zero-filled per-day series (last `days` UTC
 * days) from the arcade_overview RPC. Same contract as everything here:
 * null on any failure — including a server that doesn't have the RPC yet.
 */
export async function fetchOverview(
  game: ArcadeGame,
  days = 14,
): Promise<OverviewStats | null> {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/arcade_overview`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ game, days }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) return null;
    const raw = (await resp.json()) as {
      all_time?: { plays?: number; wins?: number; players?: number; win_pct?: number | null };
      today?: { plays?: number; players?: number; wins?: number };
      series?: { day?: string; plays?: number; players?: number; wins?: number }[] | null;
    };
    if (typeof raw?.all_time?.plays !== "number") return null;
    return {
      allTime: {
        plays: raw.all_time.plays,
        wins: raw.all_time.wins ?? 0,
        winPct: raw.all_time.win_pct ?? null,
        players: raw.all_time.players ?? 0,
      },
      today: {
        plays: raw.today?.plays ?? 0,
        players: raw.today?.players ?? 0,
        wins: raw.today?.wins ?? 0,
      },
      series: Array.isArray(raw.series)
        ? raw.series.flatMap((d) =>
            typeof d?.day === "string"
              ? [{ day: d.day, plays: d.plays ?? 0, players: d.players ?? 0, wins: d.wins ?? 0 }]
              : [],
          )
        : [],
    };
  } catch {
    return null;
  }
}
