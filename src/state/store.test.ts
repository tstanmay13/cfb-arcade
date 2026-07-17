// Reducer coverage for the keep-team lock (§5.2 + ADR-0031): the lock is
// honored only when the cell can still serve a pick after placement —
// otherwise the token refunds instead of forcing a dead sticky spin.
import { describe, expect, it } from "vitest";
import { initialRunState, reducer, type RunState } from "./store.tsx";
import { fullCell, mkPlayer } from "../engine/fixtures.ts";

const cellPool = fullCell("alpha", "2020-25");
const armed: RunState = {
  ...initialRunState,
  phase: "DRAFT",
  keepArmed: true,
  respins: { team: 2, era: 2, keepTeam: 1 }, // one token already spent arming
  currentSpin: { teamId: "alpha", era: "2020-25", pool: cellPool },
};

describe("PLACE + keep-team (ADR-0031)", () => {
  it("honors the lock while the cell still has a placeable player", () => {
    const qb = cellPool.find((p) => p.primary_position === "QB")!;
    const next = reducer(armed, { type: "PLACE", player: qb, slot: "QB" });
    expect(next.stickyCell).toEqual({ teamId: qb.school_id, era: qb.decade });
    expect(next.respins.keepTeam).toBe(1); // spent, not refunded
    expect(next.keepArmed).toBe(false);
  });

  it("refunds the token when the lock could only land a dead pool", () => {
    const qbs = [
      mkPlayer({ primary_position: "QB", school_id: "alpha", decade: "2020-25" }),
      mkPlayer({ primary_position: "QB", school_id: "alpha", decade: "2020-25" }),
    ];
    const st: RunState = {
      ...armed,
      currentSpin: { teamId: "alpha", era: "2020-25", pool: qbs },
    };
    // Placing one QB fills the only slot the other QB could take.
    const next = reducer(st, { type: "PLACE", player: qbs[0], slot: "QB" });
    expect(next.stickyCell).toBeNull();
    expect(next.respins.keepTeam).toBe(2); // refunded
    expect(next.keepArmed).toBe(false);
  });

  it("leaves re-spins untouched on a normal, unarmed placement", () => {
    const st: RunState = { ...armed, keepArmed: false };
    const qb = cellPool.find((p) => p.primary_position === "QB")!;
    const next = reducer(st, { type: "PLACE", player: qb, slot: "QB" });
    expect(next.stickyCell).toBeNull();
    expect(next.respins).toEqual(st.respins);
  });
});
