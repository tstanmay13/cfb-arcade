import { describe, expect, it } from "vitest";
import { mulberry32 } from "./rng.ts";
import { generateSchedule, type Outcome } from "./sim.ts";
import type { Resolved } from "./resolve.ts";
import { buildShareText, gameGrid } from "./share.ts";

const OPPONENTS = ["A", "B", "C", "D", "E", "F", "G", "H"];

/** Minimal Resolved for the text builder (it only reads a handful of fields). */
function mkResolved(outcome: Outcome, over: Partial<Resolved> = {}): Resolved {
  return {
    power: 92,
    tier: "Tier1",
    outcome,
    isDynasty: false,
    schedule: generateSchedule(outcome, mulberry32(1), OPPONENTS),
    record: "",
    fluffedStats: {},
    playerPerformance: {},
    heisman: null,
    allAmericans: [],
    ...over,
  };
}

describe("gameGrid (§10 text share)", () => {
  it("natty is 12 regular-season 🟩 then 4 postseason 🟨, no losses", () => {
    const grid = gameGrid(generateSchedule("natty", mulberry32(1), OPPONENTS));
    expect([...grid].length).toBe(16); // 16 squares
    expect(grid).toBe("🟩".repeat(12) + "🟨".repeat(4));
    expect(grid).not.toContain("🟥");
  });

  it("marks every loss with 🟥 and postseason wins with 🟨", () => {
    // semis: 14-1, the single loss is the semifinal (a postseason game).
    const grid = gameGrid(generateSchedule("semis", mulberry32(1), OPPONENTS));
    expect([...grid].filter((c) => c === "🟥").length).toBe(1);
    expect(grid.startsWith("🟩".repeat(12))).toBe(true); // 12 REG wins
    expect(grid).toContain("🟨"); // CCG/QF wins before the exit
  });

  it("a losing season is regular-season squares only (no 🟨)", () => {
    const grid = gameGrid(generateSchedule("loss", mulberry32(3), OPPONENTS));
    expect([...grid].length).toBe(12);
    expect(grid).not.toContain("🟨");
    expect(grid).toContain("🟥");
  });
});

describe("buildShareText (§10 text share)", () => {
  it("headlines the team, record, banner, and grid", () => {
    const text = buildShareText(mkResolved("natty", { record: "16-0", power: 94 }), {
      teamName: "Georgia",
      scoutVerified: false,
    });
    const lines = text.split("\n");
    expect(lines[0]).toBe("🏈 THE 16-0 DRAFT");
    expect(lines[1]).toBe("Georgia");
    expect(lines[2]).toBe("16-0 · NATIONAL CHAMPIONS 🏆");
    expect(lines[3]).toBe("🟩".repeat(12) + "🟨".repeat(4));
    expect(text).toContain("Team OVR 94");
  });

  it("includes Heisman + pluralized All-Americans when present", () => {
    const text = buildShareText(
      mkResolved("natty", {
        record: "16-0",
        heisman: { name: "V. Young", position: "QB", viaHornung: false },
        allAmericans: ["a", "b", "c"],
      }),
      { teamName: "Texas", scoutVerified: false },
    );
    expect(text).toContain("Heisman: V. Young");
    expect(text).toContain("3 All-Americans");
  });

  it("uses the singular for a lone All-American and omits the line at zero", () => {
    const one = buildShareText(mkResolved("major", { record: "12-2", allAmericans: ["a"] }), {
      teamName: "USC",
      scoutVerified: false,
    });
    expect(one).toContain("1 All-American");
    expect(one).not.toContain("All-Americans");

    const none = buildShareText(mkResolved("loss", { record: "5-7" }), {
      teamName: "USC",
      scoutVerified: false,
    });
    expect(none).not.toContain("All-American");
  });

  it("appends the Dynasty and Scout-verified badges only when earned", () => {
    const both = buildShareText(
      mkResolved("natty", { record: "16-0", isDynasty: true, tier: "Tier0" }),
      { teamName: "Alabama", scoutVerified: true },
    );
    expect(both).toContain("★ DYNASTY ★");
    expect(both).toContain("🔍 Scout Verified");

    const neither = buildShareText(mkResolved("minor", { record: "9-4" }), {
      teamName: "Alabama",
      scoutVerified: false,
    });
    expect(neither).not.toContain("DYNASTY");
    expect(neither).not.toContain("Scout Verified");
  });
});
