import { describe, expect, it } from "vitest";
import {
  displayShort,
  forcedFumblesProxy,
  mapDbPosition,
  pearson,
  playerId,
  slugify,
  statBlockFor,
} from "./lib.ts";

describe("displayShort", () => {
  it("abbreviates first name", () => {
    expect(displayShort("Vince Young")).toBe("V. Young");
  });
  it("keeps hyphenated and multi-word surnames", () => {
    expect(displayShort("Ha Ha Clinton-Dix")).toBe("H. Ha Clinton-Dix");
    expect(displayShort("Michael Penix Jr.")).toBe("M. Penix");
  });
  it("strips suffixes", () => {
    expect(displayShort("Frank Gore Jr.")).toBe("F. Gore");
    expect(displayShort("Kool-Aid McKinstry II")).toBe("K. McKinstry");
  });
  it("handles initialed first names", () => {
    expect(displayShort("J.T. Barrett")).toBe("J. Barrett");
  });
  it("leaves single tokens alone", () => {
    expect(displayShort("Cher")).toBe("Cher");
  });
});

describe("slugify / playerId", () => {
  it("slugs names", () => {
    expect(slugify("Ndamukong Suh")).toBe("ndamukong_suh");
    expect(slugify("Ha Ha Clinton-Dix")).toBe("ha_ha_clinton_dix");
  });
  it("builds ids per §4.1 convention", () => {
    expect(playerId("QB", "Vince Young", "texas", "2000s")).toBe(
      "qb_vince_young_texas_2000s",
    );
  });
});

describe("mapDbPosition", () => {
  it("maps simple groups", () => {
    expect(mapDbPosition("QB", "QB")).toEqual({ primary: "QB", secondary: null });
    expect(mapDbPosition("DL", "EDGE")).toEqual({ primary: "DL", secondary: null });
  });
  it("splits DB group by raw position", () => {
    expect(mapDbPosition("DB", "CB")).toEqual({ primary: "CB", secondary: null });
    expect(mapDbPosition("DB", "FS")).toEqual({ primary: "S", secondary: null });
    expect(mapDbPosition("DB", "DB")).toEqual({ primary: "CB", secondary: "S" });
  });
  it("rejects slotless positions", () => {
    expect(mapDbPosition("TE", "TE")).toBeNull();
    expect(mapDbPosition("OL", "OT")).toBeNull();
    expect(mapDbPosition("K", "PK")).toBeNull();
  });
});

describe("statBlockFor", () => {
  const qbPivot = {
    passing: { YDS: 3610, TD: 32, INT: 8, PCT: 0.77 },
    rushing: { YDS: -44, YPC: -1.0 },
  };
  it("maps QB block and converts PCT to percentage", () => {
    expect(statBlockFor("QB", qbPivot)).toEqual({
      stat_1: 3610,
      stat_2: 32,
      stat_3: 8,
      stat_4: -44,
      stat_5: 77,
    });
  });
  it("missing categories become zeros", () => {
    expect(statBlockFor("WR", {})).toEqual({
      stat_1: 0,
      stat_2: 0,
      stat_3: 0,
      stat_4: 0,
      stat_5: 0,
    });
  });
  it("CB defensive TDs sum defensive + pick-six TDs", () => {
    const p = {
      defensive: { TOT: 40, PD: 12, TD: 1, TFL: 2 },
      interceptions: { INT: 4, TD: 2 },
    };
    expect(statBlockFor("CB", p).stat_4).toBe(3);
  });
});

describe("forcedFumblesProxy", () => {
  it("is zero for empty stats and bounded for monsters", () => {
    expect(forcedFumblesProxy({})).toBe(0);
    const monster = { defensive: { SACKS: 17, TOT: 120 }, interceptions: { INT: 3 } };
    expect(forcedFumblesProxy(monster)).toBeLessThanOrEqual(5);
    expect(forcedFumblesProxy(monster)).toBeGreaterThan(0);
  });
});

describe("pearson", () => {
  it("detects positive correlation", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1);
  });
  it("handles constant series", () => {
    expect(pearson([1, 1, 1, 1], [2, 4, 6, 8])).toBe(0);
  });
});
