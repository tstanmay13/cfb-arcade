import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.ts";
import {
  allPlayerSlotsFilled,
  cellSpinWeight,
  eligibleOpenSlots,
  emptyPlayerSlots,
  eraRespin,
  expandedFallbackSpin,
  isDuplicate,
  isPoolUsable,
  MARQUEE_BUMP,
  playerCells,
  spin,
  spinCoach,
  teamRespin,
} from "./spin.ts";
import { fullCell, mkCoach, mkData, mkPlayer, mkTeam } from "./fixtures.ts";

// Fixture: 3 programs.
// - dynasty: powerhouse in 1990s + 2020s (cells in both eras)
// - modern: 2020s only, not a powerhouse
// - relic:  1990s players but NOT a powerhouse -> its 90s cell must not exist
const dynasty90s = fullCell("dynasty", "1990s", { powerhouse: true, ovr: 95 });
const dynasty20s = fullCell("dynasty", "2020s", { powerhouse: true, ovr: 90 });
const modern20s = fullCell("modern", "2020s", { ovr: 82 });
const relic90s = fullCell("relic", "1990s", { ovr: 80 }); // powerhouse: false

const data = mkData({
  teams: [
    mkTeam({ school_id: "dynasty", powerhouse_eras: ["1990s", "2020s"], eras_present: ["1990s", "2020s"] }),
    mkTeam({ school_id: "modern", eras_present: ["2020s"] }),
    mkTeam({ school_id: "relic", eras_present: ["1990s"] }),
  ],
  players: [...dynasty90s, ...dynasty20s, ...modern20s, ...relic90s],
  coaches: [
    mkCoach({ school_id: "dynasty", decade: "1990s", coach_tier: "Elite" }),
    mkCoach({ school_id: "modern", decade: "2020s", coach_tier: "Standard" }),
  ],
});

describe("playerCells (§5.3)", () => {
  it("collapses players into unique {team, era} cells", () => {
    const cells = playerCells(data);
    const keys = cells.map((c) => `${c.teamId}|${c.era}`).sort();
    // relic|1990s excluded: 80s/90s are powerhouse-only
    expect(keys).toEqual(["dynasty|1990s", "dynasty|2020s", "modern|2020s"]);
  });

  it("filters by decade", () => {
    const cells = playerCells(data, { decade: "2020s" });
    expect(cells.map((c) => c.teamId).sort()).toEqual(["dynasty", "modern"]);
  });

  it("non-powerhouse 90s cell is ineligible even when directly requested", () => {
    const cells = playerCells(data, { decade: "1990s" });
    expect(cells.map((c) => c.teamId)).toEqual(["dynasty"]);
  });
});

describe("spin weighting (§5.3)", () => {
  it("favors higher-talent cells over weaker ones (gentle curve)", () => {
    // dynasty 2020s (ovr 90) vs modern 2020s (ovr 82): talent-weighted, the
    // richer pool lands ~2x (gentle MIN..MAX = 1.5..3.0), not the old flat 3x.
    const rng = mulberry32(42);
    const counts: Record<string, number> = {};
    for (let i = 0; i < 8000; i++) {
      const s = spin(data, rng, { decade: "2020s" });
      counts[s.teamId] = (counts[s.teamId] ?? 0) + 1;
    }
    const ratio = counts.dynasty / counts.modern;
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.6);
  });

  it("applies the marquee brand bump on top of talent", () => {
    // Two identical-talent cells; only one team is marquee → ~MARQUEE_BUMP more.
    const cells = [
      { teamId: "alabama", players: fullCell("alabama", "2020s", { ovr: 85 }) },
      { teamId: "modern", players: fullCell("modern", "2020s", { ovr: 85 }) },
    ];
    const wMarquee = cellSpinWeight(cells[0], cells);
    const wPlain = cellSpinWeight(cells[1], cells);
    expect(wMarquee / wPlain).toBeCloseTo(MARQUEE_BUMP, 5);
  });

  it("is deterministic for a fixed seed", () => {
    const a = spin(data, mulberry32(7), {});
    const b = spin(data, mulberry32(7), {});
    expect(a.teamId).toBe(b.teamId);
    expect(a.era).toBe(b.era);
  });

  it("returns the cell's full pool", () => {
    const s = spin(data, mulberry32(1), { decade: "1990s" });
    expect(s.teamId).toBe("dynasty");
    expect(s.pool).toHaveLength(8);
  });
});

describe("re-spins (§5.2)", () => {
  it("team re-spin keeps the era and changes the cell", () => {
    const current = { teamId: "dynasty", era: "2020s" as const, pool: dynasty20s };
    const rng = mulberry32(3);
    for (let i = 0; i < 50; i++) {
      const s = teamRespin(data, rng, current);
      expect(s.era).toBe("2020s");
      expect(s.teamId).toBe("modern"); // only other 2020s cell
    }
  });

  it("era re-spin keeps the team and changes the era", () => {
    const current = { teamId: "dynasty", era: "2020s" as const, pool: dynasty20s };
    const s = eraRespin(data, mulberry32(5), current);
    expect(s).not.toBeNull();
    expect(s!.teamId).toBe("dynasty");
    expect(s!.era).toBe("1990s");
  });

  it("era re-spin returns null when the team has no other era", () => {
    const current = { teamId: "modern", era: "2020s" as const, pool: modern20s };
    expect(eraRespin(data, mulberry32(5), current)).toBeNull();
  });
});

describe("eligibility + duplicates (§5.4)", () => {
  it("offers primary and secondary position slots", () => {
    const slots = emptyPlayerSlots();
    const dual = mkPlayer({ primary_position: "CB", secondary_position: "WR", school_id: "x", decade: "2020s" });
    expect(eligibleOpenSlots(dual, slots).sort()).toEqual(["CB", "WR1", "WR2"]);
  });

  it("WR fills either WR slot; a filled slot disappears", () => {
    const slots = emptyPlayerSlots();
    const wr1 = mkPlayer({ primary_position: "WR", school_id: "x", decade: "2020s" });
    const wr2 = mkPlayer({ primary_position: "WR", school_id: "x", decade: "2020s" });
    expect(eligibleOpenSlots(wr1, slots)).toEqual(["WR1", "WR2"]);
    slots.WR1 = wr1;
    expect(eligibleOpenSlots(wr2, slots)).toEqual(["WR2"]);
  });

  it("blocks exact duplicates and same-human cross-era duplicates", () => {
    const slots = emptyPlayerSlots();
    const young = mkPlayer({ name: "Vince Young", primary_position: "QB", school_id: "texas", decade: "2000s" });
    slots.QB = young;
    expect(isDuplicate(young, slots)).toBe(true);
    const youngOtherEra = mkPlayer({ name: "Vince Young", primary_position: "QB", school_id: "texas", decade: "2010s" });
    expect(isDuplicate(youngOtherEra, slots)).toBe(true);
    expect(eligibleOpenSlots(youngOtherEra, slots)).toEqual([]);
    const otherHuman = mkPlayer({ name: "Vince Young", primary_position: "QB", school_id: "usc", decade: "2000s" });
    expect(isDuplicate(otherHuman, slots)).toBe(false);
  });

  it("isPoolUsable detects a dead pool (§5.6 case 2)", () => {
    const slots = emptyPlayerSlots();
    const qb = mkPlayer({ primary_position: "QB", school_id: "x", decade: "2020s" });
    slots.QB = qb;
    const onlyQBs = [mkPlayer({ primary_position: "QB", school_id: "y", decade: "2020s" })];
    expect(isPoolUsable(onlyQBs, slots)).toBe(false);
    slots.QB = null;
    expect(isPoolUsable(onlyQBs, slots)).toBe(true);
  });
});

describe("expandedFallbackSpin (§5.6 case 3)", () => {
  it("always lands a cell containing a placeable player", () => {
    const slots = emptyPlayerSlots();
    // Fill everything except S.
    for (const slot of ["QB", "RB", "WR1", "WR2", "DL", "LB", "CB"] as const) {
      slots[slot] = dynasty20s.find((p) => eligibleOpenSlots(p, { ...emptyPlayerSlots() }).includes(slot))!;
    }
    const rng = mulberry32(11);
    for (let i = 0; i < 30; i++) {
      const s = expandedFallbackSpin(data, rng, slots);
      expect(s).not.toBeNull();
      expect(isPoolUsable(s!.pool, slots)).toBe(true);
    }
  });

  it("returns null only when the board is full", () => {
    const slots = emptyPlayerSlots();
    for (const p of dynasty20s) {
      const open = eligibleOpenSlots(p, slots);
      if (open.length > 0) slots[open[0]] = p;
    }
    expect(allPlayerSlotsFilled(slots)).toBe(true);
    expect(expandedFallbackSpin(data, mulberry32(1), slots)).toBeNull();
  });
});

describe("coach spin (§5.5)", () => {
  it("only lands cells that actually have coaches", () => {
    const rng = mulberry32(9);
    for (let i = 0; i < 40; i++) {
      const s = spinCoach(data, rng, {});
      expect(s).not.toBeNull();
      expect(s!.pool.length).toBeGreaterThan(0);
    }
  });

  it("widens the era filter when it yields no coaches", () => {
    const s = spinCoach(data, mulberry32(2), { decade: "1980s" });
    expect(s).not.toBeNull(); // no 1980s coaches exist — must widen, not null
  });

  it("returns null only when the dataset has no coaches at all", () => {
    const empty = mkData({ teams: data.teams, players: data.players, coaches: [] });
    expect(spinCoach(empty, mulberry32(2), {})).toBeNull();
  });
});
