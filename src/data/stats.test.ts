// stats.ts must fail safe: reporting never throws, reads degrade to null.
// Runs in the node vitest env, so localStorage gets a tiny in-memory shim.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchGlobalStats, getPlayerHash, recordResult } from "./stats.ts";

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
  it("parses the RPC aggregate", async () => {
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
    });
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
