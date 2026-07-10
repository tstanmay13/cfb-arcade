import { describe, expect, it } from "vitest";
import {
  buildGuessShareText,
  dailyIndex,
  evaluateGuess,
  hintsFor,
  puzzleNumber,
  revealedOpponentIndices,
  type SeasonEntry,
} from "./guessSeason.ts";

const answer: SeasonEntry = {
  school_id: "lsu",
  team: "LSU",
  season: 2019,
  conference: "SEC",
  record: "15-0",
  games: [],
  star: { name: "J. Burrow", pos: "QB", ovr: 99 },
};

describe("evaluateGuess", () => {
  it("scores team and year independently with direction", () => {
    expect(evaluateGuess({ school_id: "lsu", season: 2019 }, answer)).toEqual({
      teamHit: true,
      yearDiff: 0,
      win: true,
    });
    expect(evaluateGuess({ school_id: "alabama", season: 2017 }, answer)).toEqual({
      teamHit: false,
      yearDiff: 2, // answer is later → point the player forward
      win: false,
    });
    expect(evaluateGuess({ school_id: "lsu", season: 2022 }, answer).win).toBe(false);
  });
});

describe("hint ladder", () => {
  it("unlocks cumulatively with wrong guesses", () => {
    expect(hintsFor(0)).toEqual({ conference: false, starPosition: false, opponents: false, starName: false });
    expect(hintsFor(2)).toEqual({ conference: true, starPosition: true, opponents: false, starName: false });
    expect(hintsFor(4).starName).toBe(true);
  });

  it("reveals a spread of opponents without duplicates or overflow", () => {
    expect(revealedOpponentIndices(13)).toEqual([1, 6, 12]);
    expect(revealedOpponentIndices(2)).toEqual([1]);
    expect(revealedOpponentIndices(0)).toEqual([]);
  });
});

describe("daily puzzle", () => {
  it("is deterministic per date and within bounds", () => {
    const d = new Date(2026, 6, 15);
    const a = dailyIndex(250, d);
    expect(a).toBe(dailyIndex(250, new Date(2026, 6, 15)));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(250);
    expect(dailyIndex(250, new Date(2026, 6, 16))).not.toBe(a); // near-certain for adjacent days
  });

  it("numbers puzzles from the launch day", () => {
    expect(puzzleNumber(new Date(2026, 6, 10))).toBe(1);
    expect(puzzleNumber(new Date(2026, 6, 20))).toBe(11);
  });
});

describe("share text", () => {
  it("encodes team/year squares per guess", () => {
    const text = buildGuessShareText(
      [
        { teamHit: false, yearDiff: 5, win: false },
        { teamHit: false, yearDiff: -1, win: false },
        { teamHit: true, yearDiff: 0, win: true },
      ],
      { puzzle: 7, won: true },
    );
    expect(text).toContain("#7");
    expect(text).toContain("3/6");
    expect(text).toContain("⬛⬛ ⬛🟨 🟩🟩");
  });

  it("marks losses and free play", () => {
    const text = buildGuessShareText(
      Array(6).fill({ teamHit: false, yearDiff: 9, win: false }),
      { puzzle: null, won: false },
    );
    expect(text).toContain("X/6");
    expect(text).toContain("free play");
  });
});
