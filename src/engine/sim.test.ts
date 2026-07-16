import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.ts";
import {
  generateSchedule,
  outcomeOdds,
  pickLossIndices,
  powerScore,
  recordString,
  resolveOutcome,
  schedulePhase,
  SIM_MATRIX,
  tierFor,
} from "./sim.ts";
import { emptyPlayerSlots, type PlayerSlots } from "./spin.ts";
import { fullCell, mkCoach } from "./fixtures.ts";

function boardOf(ovr: number): PlayerSlots {
  const slots = emptyPlayerSlots();
  const players = fullCell("x", "2020-25", { ovr });
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
    expect(powerScore(slots, mkCoach({ school_id: "x", decade: "2020-25", coach_tier: "Standard" }))).toBe(90);
    expect(powerScore(slots, mkCoach({ school_id: "x", decade: "2020-25", coach_tier: "Elite" }))).toBeCloseTo(94.5);
    expect(powerScore(slots, mkCoach({ school_id: "x", decade: "2020-25", coach_tier: "Great" }))).toBeCloseTo(91.8);
    expect(powerScore(slots, mkCoach({ school_id: "x", decade: "2020-25", coach_tier: "Sub-Par" }))).toBeCloseTo(87.3);
  });
  it("caps at 100 (Elite coach on a 96-avg roster)", () => {
    expect(powerScore(boardOf(98), mkCoach({ school_id: "x", decade: "2020-25", coach_tier: "Elite" }))).toBe(100);
  });
});

describe("tierFor (§6.2)", () => {
  it("maps boundaries and floats between integer bounds", () => {
    expect(tierFor(100)).toBe("Tier0");
    expect(tierFor(97)).toBe("Tier0"); // §12 pass raised the bar from 96
    expect(tierFor(96.9)).toBe("Tier1");
    expect(tierFor(91)).toBe("Tier1"); // the short-lived 89 floor was reverted by ADR-0026
    expect(tierFor(90.5)).toBe("Tier2");
    expect(tierFor(85)).toBe("Tier2");
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

  it("a Team OVR 90 board wins sometimes — but 16-0 stays rare (ADR-0029)", () => {
    const rng = mulberry32(90);
    let natty = 0;
    for (let i = 0; i < 6000; i++) {
      const r = resolveOutcome(90, rng);
      expect(r.tier).toBe("Tier2"); // labels back on the original §12 bounds
      expect(r.isDynasty).toBe(false);
      if (r.outcome === "natty") natty++;
    }
    expect(natty / 6000).toBeGreaterThan(0.1); // ramp pins 12.5% at the 90 anchor
    expect(natty / 6000).toBeLessThan(0.15);
  });

  it("mid-ramp frequencies interpolate between anchors (power 92, ADR-0029)", () => {
    // halfway between the 90 anchor (natty .125) and the 94 knee (natty .31)
    const rng = mulberry32(77);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 6000; i++) {
      const r = resolveOutcome(92, rng);
      counts[r.outcome] = (counts[r.outcome] ?? 0) + 1;
    }
    expect(counts.natty / 6000).toBeCloseTo(0.2175, 1);
    expect(counts.semis / 6000).toBeCloseTo(0.29, 1);
    expect(counts.minor / 6000).toBeGreaterThan(0.1); // deep boards still stumble
  });
});

describe("outcomeOdds ramp (ADR-0026)", () => {
  it("hits the anchors exactly, and SIM_MATRIX rows mirror the ramp at their min", () => {
    expect(outcomeOdds(78)).toEqual({ natty: 0.038, semis: 0.253, major: 0.456, minor: 0.253, loss: 0 });
    expect(outcomeOdds(85)).toEqual({ natty: 0.052, semis: 0.321, major: 0.401, minor: 0.226, loss: 0 });
    expect(outcomeOdds(90).natty).toBeCloseTo(0.125, 10);
    expect(outcomeOdds(94).natty).toBeCloseTo(0.31, 10);
    // Tier1-3's informational rows must stay equal to outcomeOdds(min)
    for (const tier of ["Tier1", "Tier2", "Tier3"] as const) {
      const row = SIM_MATRIX[tier];
      const odds = outcomeOdds(row.min);
      for (const k of ["natty", "semis", "major", "minor", "loss"] as const) {
        expect(odds[k]).toBeCloseTo(row[k], 4);
      }
    }
  });

  it("is a monotone distribution with no cliff below the Tier0 summit", () => {
    let prev = outcomeOdds(78).natty;
    for (let p = 78.1; p < 96.901; p += 0.1) {
      const odds = outcomeOdds(p);
      const sum = odds.natty + odds.semis + odds.major + odds.minor + odds.loss;
      expect(sum).toBeCloseTo(1, 9);
      expect(odds.natty).toBeGreaterThanOrEqual(prev - 1e-9);
      // steepest leg is 94→97: (.52-.31)/3 = 7% per +1.0 power (ADR-0029's
      // deliberate mastery leg — skilled boards mass below 91, oracle above)
      expect(odds.natty - prev).toBeLessThan(0.008);
      prev = odds.natty;
    }
    // the summit snap at 97 is the one deliberate cliff: the Tier0 guarantee
    expect(outcomeOdds(96.9).natty).toBeCloseTo(0.513, 3);
    expect(outcomeOdds(97)).toEqual({ natty: 1, semis: 0, major: 0, minor: 0, loss: 0 });
  });

  it("keeps the stepped rows outside the ramp (Tier4-7 unchanged)", () => {
    expect(outcomeOdds(77.9)).toEqual({ natty: 0.05, semis: 0.1, major: 0.45, minor: 0.35, loss: 0.05 });
    expect(outcomeOdds(50)).toEqual({ natty: 0, semis: 0, major: 0, minor: 0.3, loss: 0.7 });
    expect(outcomeOdds(10)).toEqual({ natty: 0, semis: 0, major: 0, minor: 0, loss: 1 });
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

  it("semis: 15 games, 14-1/13-2/12-3, always exits at the SF, never a QF loss", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const s = generateSchedule("semis", mulberry32(seed), opponents);
      expect(s).toHaveLength(15);
      expect(["14-1", "13-2", "12-3"]).toContain(recordString(s));
      expect(s[14].result).toBe("LOSS");
      expect(s[14].phase).toBe("SF");
      expect(s[13].result).toBe("WIN"); // bracket coherence: won the QF it advanced from
      expect(s[0].result).toBe("WIN");
      seen.add(recordString(s));
    }
    expect(seen.size).toBeGreaterThan(1); // records actually vary (ADR-0026)
  });

  it("major: 14 games, 12-2/11-3/10-4, exits at the QF", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const s = generateSchedule("major", mulberry32(seed), opponents);
      expect(s).toHaveLength(14);
      expect(["12-2", "11-3", "10-4"]).toContain(recordString(s));
      expect(s[13].result).toBe("LOSS");
      expect(s[13].phase).toBe("QF");
      expect(s[0].result).toBe("WIN"); // opener protected in mixed zone
      seen.add(recordString(s));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("minor: 13 games, 10-3/9-4/8-5, losses only in the regular season (bowl won)", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const s = generateSchedule("minor", mulberry32(seed), opponents);
      expect(s).toHaveLength(13);
      expect(["10-3", "9-4", "8-5"]).toContain(recordString(s));
      expect(s[12].phase).toBe("BOWL");
      expect(s[12].result).toBe("WIN");
      seen.add(recordString(s));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("loss: 12 games, 6-6/5-7/4-8, no postseason", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 60; seed++) {
      const s = generateSchedule("loss", mulberry32(seed), opponents);
      expect(s).toHaveLength(12);
      expect(["6-6", "5-7", "4-8"]).toContain(recordString(s));
      expect(s.every((g) => g.phase === "REG")).toBe(true);
      seen.add(recordString(s));
    }
    expect(seen.size).toBeGreaterThan(1);
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
