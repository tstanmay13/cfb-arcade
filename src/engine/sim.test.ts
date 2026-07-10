import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.ts";
import {
  generateSchedule,
  pickLossIndices,
  powerScore,
  recordString,
  resolveOutcome,
  schedulePhase,
  tierFor,
} from "./sim.ts";
import { emptyPlayerSlots, type PlayerSlots } from "./spin.ts";
import { fullCell, mkCoach } from "./fixtures.ts";

function boardOf(ovr: number): PlayerSlots {
  const slots = emptyPlayerSlots();
  const players = fullCell("x", "2020s", { ovr });
  slots.QB = players[0];
  slots.RB = players[1];
  slots.WR1 = players[2];
  slots.WR2 = players[3];
  slots.DL = players[4];
  slots.LB = players[5];
  slots.CB = players[6];
  slots.S = players[7];
  return slots;
}

describe("powerScore (§6.1)", () => {
  it("is the mean of the 8 players times the coach multiplier", () => {
    const slots = boardOf(90);
    expect(powerScore(slots, mkCoach({ school_id: "x", decade: "2020s", coach_tier: "Standard" }))).toBe(90);
    expect(powerScore(slots, mkCoach({ school_id: "x", decade: "2020s", coach_tier: "Elite" }))).toBeCloseTo(94.5);
    expect(powerScore(slots, mkCoach({ school_id: "x", decade: "2020s", coach_tier: "Great" }))).toBeCloseTo(91.8);
    expect(powerScore(slots, mkCoach({ school_id: "x", decade: "2020s", coach_tier: "Sub-Par" }))).toBeCloseTo(87.3);
  });
  it("caps at 100 (Elite coach on a 96-avg roster)", () => {
    expect(powerScore(boardOf(98), mkCoach({ school_id: "x", decade: "2020s", coach_tier: "Elite" }))).toBe(100);
  });
});

describe("tierFor (§6.2)", () => {
  it("maps boundaries and floats between integer bounds", () => {
    expect(tierFor(100)).toBe("Tier0");
    expect(tierFor(97)).toBe("Tier0"); // §12 pass raised the bar from 96
    expect(tierFor(96.9)).toBe("Tier1");
    expect(tierFor(91)).toBe("Tier1");
    expect(tierFor(90.5)).toBe("Tier2");
    expect(tierFor(78)).toBe("Tier3");
    expect(tierFor(77.9)).toBe("Tier4");
    expect(tierFor(60)).toBe("Tier5");
    expect(tierFor(45)).toBe("Tier6");
    expect(tierFor(44.99)).toBe("Tier7");
    expect(tierFor(0)).toBe("Tier7");
  });
});

describe("resolveOutcome (§6.2)", () => {
  it("Tier 0 always wins the natty and rolls ~80% dynasty", () => {
    const rng = mulberry32(123);
    let dynasties = 0;
    for (let i = 0; i < 4000; i++) {
      const r = resolveOutcome(98, rng);
      expect(r.tier).toBe("Tier0");
      expect(r.outcome).toBe("natty");
      if (r.isDynasty) dynasties++;
    }
    expect(dynasties / 4000).toBeGreaterThan(0.76);
    expect(dynasties / 4000).toBeLessThan(0.84);
  });

  it("Tier 7 always ends in a losing season, never a dynasty", () => {
    const rng = mulberry32(5);
    for (let i = 0; i < 200; i++) {
      const r = resolveOutcome(30, rng);
      expect(r.outcome).toBe("loss");
      expect(r.isDynasty).toBe(false);
    }
  });

  it("Tier 1 outcome frequencies track the matrix (20/50/30)", () => {
    const rng = mulberry32(77);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 6000; i++) {
      const r = resolveOutcome(93, rng);
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    }
    expect(counts.natty / 6000).toBeCloseTo(0.2, 1);
    expect(counts.semis / 6000).toBeCloseTo(0.5, 1);
    expect(counts.major / 6000).toBeCloseTo(0.3, 1);
    expect(counts.minor ?? 0).toBe(0);
  });
});

describe("schedule generation (§6.3)", () => {
  const opponents = ["A", "B", "C", "D", "E", "F", "G", "H"];

  it("natty: 16 games, 16-0, phases run REG×12 → CCG QF SF FINAL", () => {
    const s = generateSchedule("natty", mulberry32(1), opponents);
    expect(s).toHaveLength(16);
    expect(s.every((g) => g.result === "WIN")).toBe(true);
    expect(recordString(s)).toBe("16-0");
    expect(s.slice(12).map((g) => g.phase)).toEqual(["CCG", "QF", "SF", "FINAL"]);
    expect(s.slice(0, 12).every((g) => g.phase === "REG")).toBe(true);
  });

  it("semis: 15 games, 14-1, the single loss is the semifinal exit", () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = generateSchedule("semis", mulberry32(seed), opponents);
      expect(s).toHaveLength(15);
      expect(recordString(s)).toBe("14-1");
      expect(s[14].result).toBe("LOSS");
      expect(s[14].phase).toBe("SF");
    }
  });

  it("major: 14 games, 12-2, one loss is the quarterfinal exit", () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = generateSchedule("major", mulberry32(seed), opponents);
      expect(s).toHaveLength(14);
      expect(recordString(s)).toBe("12-2");
      expect(s[13].result).toBe("LOSS");
      expect(s[13].phase).toBe("QF");
      expect(s[0].result).toBe("WIN"); // opener protected in mixed zone
    }
  });

  it("minor: 13 games, 9-4, losses only in the regular season (bowl won)", () => {
    for (let seed = 0; seed < 20; seed++) {
      const s = generateSchedule("minor", mulberry32(seed), opponents);
      expect(s).toHaveLength(13);
      expect(recordString(s)).toBe("9-4");
      expect(s[12].phase).toBe("BOWL");
      expect(s[12].result).toBe("WIN");
    }
  });

  it("loss: 12 games, 5-7, no postseason", () => {
    const s = generateSchedule("loss", mulberry32(3), opponents);
    expect(s).toHaveLength(12);
    expect(recordString(s)).toBe("5-7");
    expect(s.every((g) => g.phase === "REG")).toBe(true);
  });

  it("scores agree with results (win scores ahead, loss scores behind)", () => {
    const s = generateSchedule("minor", mulberry32(9), opponents);
    for (const g of s) {
      const [us, them] = g.score.split("-").map(Number);
      if (g.result === "WIN") expect(us).toBeGreaterThan(them);
      else expect(us).toBeLessThan(them);
    }
  });

  it("is deterministic for a fixed seed", () => {
    const a = generateSchedule("major", mulberry32(42), opponents);
    const b = generateSchedule("major", mulberry32(42), opponents);
    expect(a).toEqual(b);
  });
});

describe("pickLossIndices / schedulePhase helpers", () => {
  it("never double-books an index", () => {
    for (let seed = 0; seed < 30; seed++) {
      const idx = pickLossIndices(12, 7, "regular", mulberry32(seed));
      expect(new Set(idx).size).toBe(7);
      expect(Math.max(...idx)).toBeLessThan(12);
    }
  });
  it("labels a 13-game season's finale as the bowl", () => {
    expect(schedulePhase(12, 13)).toBe("BOWL");
    expect(schedulePhase(12, 16)).toBe("CCG");
    expect(schedulePhase(15, 16)).toBe("FINAL");
    expect(schedulePhase(5, 12)).toBe("REG");
  });
});
