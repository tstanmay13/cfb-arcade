import { describe, expect, it } from "vitest";
import { outcomeOdds } from "./sim.ts";
import { fluffPlayerStats } from "./awards.ts";
import { mulberry32 } from "./rng.ts";
import { mkPlayer } from "./fixtures.ts";

describe("draft fairness and believable stats", () => {
  it("improves playoff chances inside the lower tiers without boundary jumps", () => {
    const playoff = (power: number) => { const o = outcomeOdds(power); return o.natty + o.semis + o.major; };
    expect(playoff(65)).toBeGreaterThan(playoff(60));
    for (const boundary of [45, 60, 70, 78]) {
      expect(Math.abs(playoff(boundary) - playoff(boundary - 0.001))).toBeLessThan(0.001);
    }
  });

  it("never makes a better postseason finish less likely as power increases", () => {
    const keys = ["natty", "semis", "major", "minor"] as const;
    let previous = keys.map(() => 0);
    for (let step = 0; step <= 1000; step++) {
      const odds = outcomeOdds(step / 10);
      expect(Object.values(odds).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
      let cumulative = 0;
      keys.forEach((key, i) => {
        cumulative += odds[key];
        expect(cumulative).toBeGreaterThanOrEqual(previous[i] - 1e-9);
        previous[i] = cumulative;
      });
    }
  });

  it("keeps sacks and tackles coherent with half-credit precision across seeded seasons", () => {
    const p = mkPlayer({ primary_position: "DL", stats: { stat_1: 40, stat_2: 12.5, stat_3: 11.5, stat_4: 2, stat_5: 3 } });
    const rng = mulberry32(991);
    for (let season = 0; season < 1000; season++) {
      const { stats } = fluffPlayerStats(p, rng);
      expect(stats.stat_3).toBeLessThanOrEqual(stats.stat_2);
      expect(stats.stat_2).toBeLessThanOrEqual(stats.stat_1);
      expect(Number.isInteger(stats.stat_2 * 2)).toBe(true);
      expect(Number.isInteger(stats.stat_3 * 2)).toBe(true);
    }
  });

  it("a QB breakout reduces interceptions and respects percentage limits", () => {
    const p = mkPlayer({ primary_position: "QB", stats: { stat_1: 4000, stat_2: 40, stat_3: 10, stat_4: -50, stat_5: 80 } });
    const { stats } = fluffPlayerStats(p, () => 0.99);
    expect(stats.stat_3).toBeLessThan(10);
    expect(stats.stat_4).toBeGreaterThan(-50);
    expect(stats.stat_5).toBeLessThanOrEqual(100);
  });

  it("receiving yards per catch agrees with the season totals and long stays legal", () => {
    const p = mkPlayer({ primary_position: "WR", stats: { stat_1: 80, stat_2: 1200, stat_3: 12, stat_4: 15, stat_5: 95 } });
    const { stats } = fluffPlayerStats(p, () => 0.99);
    expect(stats.stat_4).toBeCloseTo(stats.stat_2 / stats.stat_1, 1);
    expect(stats.stat_5).toBeLessThanOrEqual(99);
    expect(stats.stat_3).toBeLessThanOrEqual(stats.stat_1);
  });
});

it("every baked draft card has recorded production to evaluate", async () => {
  const { readFileSync } = await import("node:fs");
  const data = JSON.parse(readFileSync(new URL("../../public/data.json", import.meta.url), "utf8"));
  const empty = data.players.filter((p: { stats: Record<string, number> }) => Object.values(p.stats).every(v => v === 0));
  expect(empty).toHaveLength(0);
});
