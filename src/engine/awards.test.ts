import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.ts";
import {
  allAmericanChance,
  calculateStatFluff,
  fluffPlayerStats,
  positionAwardChance,
  processHeismanAward,
  processPositionAwards,
  selectAllAmericans,
} from "./awards.ts";
import { resolveSeason } from "./resolve.ts";
import { emptyPlayerSlots, type PlayerSlots } from "./spin.ts";
import { fullCell, mkCoach, mkData, mkPlayer, mkTeam } from "./fixtures.ts";

function board(ovr = 90): PlayerSlots {
  const slots = emptyPlayerSlots();
  const ps = fullCell("x", "2020s", { ovr });
  [slots.QB, slots.RB, slots.WR1, slots.WR2, slots.DL, slots.LB, slots.CB, slots.S] = ps;
  return slots;
}

describe("stat fluff (§7.1)", () => {
  it("stays within the 0.70–1.35 envelope and matches base precision", () => {
    const rng = mulberry32(1);
    for (let i = 0; i < 2000; i++) {
      const f = calculateStatFluff(1000, rng);
      expect(f.appliedModifier).toBeGreaterThanOrEqual(0.7);
      expect(f.appliedModifier).toBeLessThanOrEqual(1.35);
      expect(Number.isInteger(f.value)).toBe(true);
    }
    const ratio = calculateStatFluff(6.3, rng);
    expect(ratio.value).toBeCloseTo(6.3 * ratio.appliedModifier, 1);
  });

  it("distributes across the five 20% performance buckets", () => {
    const rng = mulberry32(99);
    let wild = 0;
    let locked = 0;
    const n = 8000;
    for (let i = 0; i < n; i++) {
      const f = calculateStatFluff(100, rng);
      if (f.appliedModifier < 0.9 || f.appliedModifier > 1.1) wild++;
      if (f.appliedModifier >= 0.98 && f.appliedModifier <= 1.02) locked++;
    }
    // Beyond ±10%: all of significantly_worse/better (40%) plus half of each
    // marginal band (~20%) → ~60%.
    expect(wild / n).toBeGreaterThan(0.5);
    expect(wild / n).toBeLessThan(0.7);
    expect(locked / n).toBeGreaterThan(0.15); // the 20% "same" band
  });

  it("computedModifier is the max across the 5 stats", () => {
    const p = mkPlayer({ primary_position: "QB", school_id: "x", decade: "2020s" });
    const f = fluffPlayerStats(p, mulberry32(7));
    expect(f.computedModifier).toBeGreaterThanOrEqual(0.98); // max of 5 draws is ~never the floor
    expect(f.computedModifier).toBeLessThanOrEqual(1.35);
  });
});

describe("Heisman (§7.2)", () => {
  it("Paul Hornung rule: eruption stat line gets ~25% regardless of tier", () => {
    const slots = board();
    const modifiers = new Map([[slots.DL!.player_id, 1.25]]);
    let wins = 0;
    const rng = mulberry32(11);
    for (let i = 0; i < 4000; i++) {
      const w = processHeismanAward("Tier6", slots, modifiers, rng);
      if (w?.viaHornung) {
        expect(w.name).toBe(slots.DL!.name);
        wins++;
      }
    }
    expect(wins / 4000).toBeGreaterThan(0.21);
    expect(wins / 4000).toBeLessThan(0.29);
  });

  it("tier baseline: Tier0 hits ~80% and skews QB/RB/WR1", () => {
    const slots = board();
    const rng = mulberry32(21);
    const byName: Record<string, number> = {};
    let wins = 0;
    for (let i = 0; i < 6000; i++) {
      const w = processHeismanAward("Tier0", slots, new Map(), rng);
      if (w) {
        wins++;
        byName[w.name] = (byName[w.name] ?? 0) + 1;
      }
    }
    expect(wins / 6000).toBeCloseTo(0.8, 1);
    expect(byName[slots.QB!.name] / wins).toBeCloseTo(0.65, 1);
    expect(byName[slots.RB!.name] / wins).toBeCloseTo(0.2, 1);
    expect(byName[slots.WR1!.name] / wins).toBeCloseTo(0.15, 1);
    expect(Object.keys(byName)).toHaveLength(3); // never WR2/defense via baseline
  });

  it("unknown tiers fall back to 5%", () => {
    const slots = board();
    const rng = mulberry32(31);
    let wins = 0;
    for (let i = 0; i < 6000; i++) {
      if (processHeismanAward("Tier7", slots, new Map(), rng)) wins++;
    }
    expect(wins / 6000).toBeCloseTo(0.05, 1);
  });
});

describe("Position awards (§7.2b)", () => {
  const allMods = (slots: PlayerSlots, mod: number) =>
    new Map(Object.values(slots).filter((p): p is NonNullable<typeof p> => !!p).map((p) => [p.player_id, mod]));

  it("chance bands: eruption 35%, lone green arrow 5%, flat line 0", () => {
    expect(positionAwardChance(1.3)).toBe(0.35);
    expect(positionAwardChance(1.2)).toBe(0.35);
    expect(positionAwardChance(1.19)).toBe(0.05);
    expect(positionAwardChance(1.05)).toBe(0.05);
    expect(positionAwardChance(1.0)).toBe(0);
    expect(positionAwardChance(0.7)).toBe(0);
  });

  it("a stat eruption at a position wins its award ~35% of the time", () => {
    const slots = board(90);
    const mods = new Map([[slots.WR1!.player_id, 1.3]]); // only the WR erupts
    let wins = 0;
    const rng = mulberry32(3);
    for (let i = 0; i < 6000; i++) {
      if (processPositionAwards("Tier1", slots, mods, null, rng).some((a) => a.award === "biletnikoff")) wins++;
    }
    expect(wins / 6000).toBeCloseTo(0.35, 1);
  });

  it("both eligible players roll independently (~57% combined, not one 35% roll)", () => {
    const slots = board(90);
    const mods = new Map([
      [slots.WR1!.player_id, 1.3],
      [slots.WR2!.player_id, 1.3],
    ]);
    let wins = 0;
    const rng = mulberry32(17);
    for (let i = 0; i < 8000; i++) {
      if (processPositionAwards("Tier1", slots, mods, null, rng).some((a) => a.award === "biletnikoff")) wins++;
    }
    // 1 - 0.65^2 = 0.5775 — well above a single candidate's 35%.
    expect(wins / 8000).toBeGreaterThan(0.5);
    expect(wins / 8000).toBeLessThan(0.65);
  });

  it("a lone green arrow wins ~5% of the time", () => {
    const slots = board(90);
    const mods = new Map([[slots.LB!.player_id, 1.1]]);
    let wins = 0;
    const rng = mulberry32(9);
    for (let i = 0; i < 8000; i++) {
      if (processPositionAwards("Tier1", slots, mods, null, rng).some((a) => a.award === "butkus")) wins++;
    }
    expect(wins / 8000).toBeCloseTo(0.05, 1);
  });

  it("caps at 2 non-Heisman awards, 3 for a Tier-0 board", () => {
    const slots = board(90);
    const mods = allMods(slots, 1.3); // every position candidate erupts
    let max1 = 0;
    let max0 = 0;
    const a = mulberry32(7);
    const b = mulberry32(7);
    for (let i = 0; i < 5000; i++) {
      const t1 = processPositionAwards("Tier1", slots, mods, null, a);
      const t0 = processPositionAwards("Tier0", slots, mods, null, b);
      expect(t1.length).toBeLessThanOrEqual(2);
      expect(t0.length).toBeLessThanOrEqual(3);
      max1 = Math.max(max1, t1.length);
      max0 = Math.max(max0, t0.length);
    }
    expect(max1).toBe(2); // the soft cap is reachable
    expect(max0).toBe(3); // Tier-0 can reach three
  });

  it("keeps the Heisman winner's award over higher-OVR awards when trimming", () => {
    const slots = board(90);
    slots.RB!.hidden_ovr = 60; // Heisman winner, but LOWEST rated → dropped first by OVR
    slots.WR1!.hidden_ovr = 99;
    slots.LB!.hidden_ovr = 98;
    slots.CB!.hidden_ovr = 97;
    slots.S!.hidden_ovr = 96;
    const mods = allMods(slots, 1.3);
    const heismanName = slots.RB!.name;
    let checked = 0;
    for (let s = 1; s <= 4000 && checked < 25; s++) {
      // Same seed, different cap: Tier0 keeps 3, Tier1 keeps 2. When Tier0 has 3
      // and the RB is among them (it erupted), Tier1's two MUST still include it.
      const t0 = processPositionAwards("Tier0", slots, mods, heismanName, mulberry32(s));
      const t1 = processPositionAwards("Tier1", slots, mods, heismanName, mulberry32(s));
      if (t0.length === 3 && t1.length === 2 && t0.some((x) => x.award === "doakWalker")) {
        expect(t1.some((x) => x.award === "doakWalker")).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0); // we actually exercised the trim path
  });
});

describe("All-Americans (§7.3)", () => {
  it("probability curve matches the spec anchors", () => {
    expect(allAmericanChance(98)).toBeCloseTo(0.57);
    expect(allAmericanChance(70)).toBeCloseTo(0.15);
    expect(allAmericanChance(60)).toBe(0);
    expect(allAmericanChance(40)).toBe(0);
    expect(allAmericanChance(100)).toBeCloseTo(0.6);
  });

  it("selects more from elite boards than depth boards", () => {
    const rng = mulberry32(41);
    let elite = 0;
    let depth = 0;
    for (let i = 0; i < 500; i++) {
      elite += selectAllAmericans(board(98), rng).length;
      depth += selectAllAmericans(board(70), rng).length;
    }
    expect(elite / 500).toBeGreaterThan(3.5); // ~4.56 expected
    expect(depth / 500).toBeLessThan(2); // ~1.2 expected
  });
});

describe("resolveSeason (SIM_RESOLVE)", () => {
  const data = mkData({
    teams: [mkTeam({ school_id: "x", eras_present: ["2020s"] })],
    players: [],
    coaches: [],
  });

  it("is fully deterministic from one seed", () => {
    const slots = board(92);
    const coach = mkCoach({ school_id: "x", decade: "2020s", coach_tier: "Great" });
    const a = resolveSeason(slots, coach, data, mulberry32(1234));
    const b = resolveSeason(slots, coach, data, mulberry32(1234));
    expect(a).toEqual(b);
  });

  it("wires power → tier → schedule → awards coherently", () => {
    const slots = board(97); // 97 avg, Elite coach → capped 100 → Tier0
    const coach = mkCoach({ school_id: "x", decade: "2020s", coach_tier: "Elite" });
    const r = resolveSeason(slots, coach, data, mulberry32(2));
    expect(r.power).toBe(100);
    expect(r.tier).toBe("Tier0");
    expect(r.outcome).toBe("natty");
    expect(r.record).toBe("16-0");
    expect(r.schedule).toHaveLength(16);
    expect(Object.keys(r.fluffedStats)).toHaveLength(8);
  });
});
