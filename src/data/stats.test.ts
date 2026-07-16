// stats.ts must fail safe: reporting never throws, reads degrade to null.
// Runs in the node vitest env, so localStorage gets a tiny in-memory shim.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGlobalStats, fetchOverview, getPlayerHash, recordResult } from "./stats.ts";

function shimLocalStorage(): void {
  const map = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  });
}

beforeEach(() => {
  shimLocalStorage();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("getPlayerHash", () => {
  it("mints once and stays stable", () => {
    const first = getPlayerHash();
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(getPlayerHash()).toBe(first);
  });

  it("still returns an id when storage throws (private mode)", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    });
    const hash = getPlayerHash();
    expect(hash.length).toBeGreaterThanOrEqual(8);
    expect(hash.length).toBeLessThanOrEqual(64);
  });
});

describe("recordResult", () => {
  it("POSTs the snake_case row with return=minimal and the player hash", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    recordResult({
      game: "guess_season",
      puzzleNumber: 3,
      won: true,
      guessCount: 2,
      guesses: ["georgia 2021", "georgia 2022"],
      hintsUsed: 1,
      timeToCompleteSeconds: 41.6,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/rest/v1/arcade_results");
    expect((init.headers as Record<string, string>).Prefer).toBe("return=minimal");
    expect(init.keepalive).toBe(true);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      game: "guess_season",
      puzzle_number: 3,
      won: true,
      guess_count: 2,
      guesses: ["georgia 2021", "georgia 2022"],
      hints_used: 1,
      time_to_complete_seconds: 42,
    });
    expect(body.player_hash.length).toBeGreaterThanOrEqual(8);
  });

  it("never throws — rejected fetch", () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(() =>
      recordResult({
        game: "guess_season",
        puzzleNumber: null,
        won: false,
        guessCount: 6,
        guesses: [],
        hintsUsed: 4,
        timeToCompleteSeconds: null,
      }),
    ).not.toThrow();
  });

  it("never throws — fetch itself explodes synchronously", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("no fetch here");
      }),
    );
    expect(() =>
      recordResult({
        game: "guess_season",
        puzzleNumber: 1,
        won: true,
        guessCount: 1,
        guesses: ["x 2020"],
        hintsUsed: 0,
        timeToCompleteSeconds: 5,
      }),
    ).not.toThrow();
  });
});

describe("fetchGlobalStats", () => {
  it("parses a v1 RPC aggregate, defaulting the v2 fields", async () => {
    const payload = {
      plays: 128,
      wins: 96,
      win_pct: 75.0,
      guess_distribution: { "1": 4, "2": 18, "3": 30, "4": 24, "5": 14, "6": 6 },
      avg_guesses: 3.4,
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    const stats = await fetchGlobalStats("guess_season", 3);
    expect(stats).toEqual({
      plays: 128,
      wins: 96,
      winPct: 75.0,
      guessDistribution: payload.guess_distribution,
      avgGuesses: 3.4,
      players: null,
      avgHints: null,
      medianTimeSeconds: null,
      topGuesses: [],
    });
  });

  it("parses the v2 fields and drops malformed top_guesses entries", async () => {
    const payload = {
      plays: 128,
      wins: 96,
      win_pct: 75.0,
      guess_distribution: { "1": 4 },
      avg_guesses: 3.4,
      players: 41,
      avg_hints: 1.25,
      median_time_seconds: 102,
      top_guesses: [
        { guess: "georgia 2021", n: 40 },
        { guess: 7, n: 2 }, // malformed — dropped, not crashed on
        { n: 3 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    const stats = await fetchGlobalStats("guess_season", 3);
    expect(stats?.players).toBe(41);
    expect(stats?.avgHints).toBe(1.25);
    expect(stats?.medianTimeSeconds).toBe(102);
    expect(stats?.topGuesses).toEqual([{ guess: "georgia 2021", n: 40 }]);
  });

  it("returns null on HTTP error, junk payload, and network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    expect(await fetchGlobalStats("guess_season", 1)).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ unexpected: true })));
    expect(await fetchGlobalStats("guess_season", 1)).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchGlobalStats("guess_season", null)).toBeNull();
  });
});

describe("fetchOverview", () => {
  it("parses the overview RPC", async () => {
    const payload = {
      all_time: { plays: 500, wins: 300, players: 88, win_pct: 60.0 },
      today: { plays: 12, players: 9, wins: 7 },
      series: [
        { day: "2026-07-13", plays: 30, players: 20, wins: 18 },
        { day: "2026-07-14", plays: 12, players: 9, wins: 7 },
      ],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    const overview = await fetchOverview("guess_season", 14);
    expect(overview).toEqual({
      allTime: { plays: 500, wins: 300, winPct: 60.0, players: 88 },
      today: { plays: 12, players: 9, wins: 7 },
      series: payload.series,
    });
  });

  it("returns null when the RPC is missing (pre-0008 server), errors, or junk", async () => {
    // PostgREST answers 404 for an unknown RPC — the client must shrug.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("no rpc", { status: 404 })));
    expect(await fetchOverview("guess_season")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ nope: 1 })));
    expect(await fetchOverview("guess_season")).toBeNull();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await fetchOverview("guess_season")).toBeNull();
  });
});
