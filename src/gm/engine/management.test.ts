import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { GmData } from "./types.ts";
import { createDynasty, sideFor } from "./dynasty.ts";
import { developPlayer } from "./recruiting.ts";
import { selectLineup } from "./lineup.ts";

const data: GmData = JSON.parse(readFileSync(new URL("../../../public/gm-data.json", import.meta.url), "utf8"));
const fresh = () => createDynasty(data, data.teams.find(t => t.p4)!.id, 12345);

describe("management decisions reach the simulation", () => {
  it("developing the starting QB improves actual passing traits as well as OVR", () => {
    const state = fresh();
    state.phase = "offseason";
    state.stamina = 100;
    const qb = sideFor(state, state.userTid).lineup!.QB![0];
    qb.ceil = 99;
    const before = sideFor(state, state.userTid).traits.airO;
    const oldOvr = qb.ovr;
    expect(developPlayer(state, qb.id)).toBeNull();
    expect(qb.ovr).toBeGreaterThan(oldOvr);
    expect(sideFor(state, state.userTid).traits.airO).toBeGreaterThan(before);
  });

  it("honors a coach's ordered QB preferences and skips injured players", () => {
    const state = fresh();
    const roster = state.teams[state.userTid].roster.map(id => state.players[id]);
    const qbs = roster.filter(p => p.g === "QB").sort((a,b) => b.ovr - a.ovr);
    const chosen = qbs[qbs.length - 1];
    const pins = [chosen.id, qbs[0].id];
    expect(selectLineup(roster, pins).QB![0].id).toBe(chosen.id);
    chosen.inj = 2;
    expect(selectLineup(roster, pins).QB![0].id).toBe(qbs[0].id);
  });
});
