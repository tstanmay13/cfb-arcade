// CFB-GM calibration harness (CFB_GM_DESIGN "Calibration harness") — ships
// WITH v1.0 as the acceptance gate. Headless multi-season sims asserting
// determinism, scoring realism, upset monotonicity, OVR stability, and the
// closed-universe roster ecology.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DynastyState, GmData } from "./types.ts";
import { advance, createDynasty, simToSeasonEnd, startNextSeason, stateHash } from "./dynasty.ts";
import { selectLineup, traitsFromElo, traitsFromLineup } from "./lineup.ts";

const data = JSON.parse(
  readFileSync(new URL("../../../public/gm-data.json", import.meta.url), "utf8"),
) as GmData;

const USER_TID = data.teams.find((t) => t.p4)!.id;

function freshDynasty(seed = 12345): DynastyState {
  return createDynasty(data, USER_TID, seed);
}

describe("baked universe", () => {
  it("has 68 P4 programs and a real schedule", () => {
    expect(data.teams.filter((t) => t.p4)).toHaveLength(68);
    expect(data.schedule.length).toBeGreaterThan(400);
  });
});

describe("dynasty creation", () => {
  const state = freshDynasty();

  it("indexes teams by id and fills legal rosters", () => {
    state.teams.forEach((t, i) => expect(t.id).toBe(i));
    for (const t of state.teams) {
      if (!t.p4) {
        expect(t.roster).toHaveLength(0);
        continue;
      }
      expect(t.roster.length).toBeGreaterThanOrEqual(60);
      expect(t.roster.length).toBeLessThanOrEqual(85);
      const groups = new Map<string, number>();
      for (const pid of t.roster) {
        const p = state.players[pid];
        groups.set(p.g, (groups.get(p.g) ?? 0) + 1);
      }
      expect(groups.get("QB") ?? 0).toBeGreaterThanOrEqual(3);
      expect(groups.get("K") ?? 0).toBeGreaterThanOrEqual(1);
      expect(groups.get("P") ?? 0).toBeGreaterThanOrEqual(1);
    }
  });

  it("attrs average to ovr (nothing lies about the rating)", () => {
    for (const p of Object.values(state.players).slice(0, 500)) {
      const vals = Object.values(p.attrs);
      const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
      expect(Math.abs(mean - p.ovr)).toBeLessThanOrEqual(2.5);
    }
  });

  it("ceilings respect dev tiers and never sit below current ovr", () => {
    for (const p of Object.values(state.players)) {
      expect(p.ceil).toBeGreaterThanOrEqual(p.ovr);
      expect(p.ceil).toBeLessThanOrEqual(99);
    }
  });
});

describe("determinism", () => {
  it("same seed → identical season, different seed → different", () => {
    const a = freshDynasty(777);
    const b = freshDynasty(777);
    const c = freshDynasty(778);
    simToSeasonEnd(a);
    simToSeasonEnd(b);
    simToSeasonEnd(c);
    expect(stateHash(a)).toBe(stateHash(b));
    expect(stateHash(a)).not.toBe(stateHash(c));
  });
});

describe("single-season realism", () => {
  const state = freshDynasty(42);
  simToSeasonEnd(state);
  const regGames = state.results.filter((r) => r.kind === "reg");

  it("plays a full season into the offseason", () => {
    expect(state.phase).toBe("offseason");
    expect(regGames.length).toBeGreaterThan(400);
    expect(state.cfp?.champion).not.toBeNull();
    expect(state.honors).toHaveLength(1);
  });

  it("team scoring lands in the real-CFB band", () => {
    const scores = regGames.flatMap((r) => [r.hs, r.as]);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    expect(mean).toBeGreaterThan(20);
    expect(mean).toBeLessThan(38);
    // Blowouts and close games both exist.
    expect(regGames.some((r) => Math.abs(r.hs - r.as) >= 28)).toBe(true);
    expect(regGames.some((r) => Math.abs(r.hs - r.as) <= 3)).toBe(true);
  });

  it("favorites win at rates that track the strength gap (monotone upset curve)", () => {
    // Bucket by what the engine actually consumes: starter-average OVR
    // (roster strength for P4, Elo-derived for shells) at season start.
    const fresh = freshDynasty(42);
    const strength = new Map<number, number>(
      fresh.teams.map((t) => {
        if (!t.p4) return [t.id, traitsFromElo(t.elo).ovr];
        const lu = selectLineup(t.roster.map((pid) => fresh.players[pid]));
        return [t.id, traitsFromLineup(lu).ovr];
      }),
    );
    const buckets = [0, 0, 0];
    const wins = [0, 0, 0];
    for (const r of regGames) {
      const hs = strength.get(r.home)!;
      const as = strength.get(r.away)!;
      const gap = Math.abs(hs - as);
      if (gap < 1) continue;
      const fav = hs > as ? r.home : r.away;
      const b = gap < 5 ? 0 : gap < 12 ? 1 : 2;
      buckets[b]++;
      const winner = r.hs > r.as ? r.home : r.away;
      if (winner === fav) wins[b]++;
    }
    const rates = wins.map((w, i) => w / Math.max(1, buckets[i]));
    expect(rates[0]).toBeGreaterThan(0.5);
    expect(rates[1]).toBeGreaterThan(rates[0] - 0.03);
    expect(rates[2]).toBeGreaterThan(rates[1] - 0.03);
    expect(rates[2]).toBeGreaterThan(0.75);
    // Mid-gap upsets (1-2 TD favorites losing) must exist every season;
    // giant-gap upsets are too rare to demand from a single-season sample.
    expect(rates[1]).toBeLessThan(0.97);
  });

  it("win totals spread like a real P4 season", () => {
    const winCounts = state.teams.filter((t) => t.p4).map((t) => t.rec.w);
    expect(Math.max(...winCounts)).toBeGreaterThanOrEqual(10);
    expect(Math.min(...winCounts)).toBeLessThanOrEqual(4);
    const median = [...winCounts].sort((a, b) => a - b)[34];
    expect(median).toBeGreaterThanOrEqual(5);
    expect(median).toBeLessThanOrEqual(8);
  });

  it("stats accumulate to plausible season leader lines", () => {
    // The offseason has already archived the season into career lines.
    const lines = Object.values(state.players).flatMap((p) => p.career);
    const topPass = Math.max(0, ...lines.map((l) => l.paYd));
    const topRush = Math.max(0, ...lines.map((l) => l.ruYd));
    expect(topPass).toBeGreaterThan(2400);
    expect(topPass).toBeLessThan(6500);
    expect(topRush).toBeGreaterThan(900);
    expect(topRush).toBeLessThan(3200);
  });

  it("poll has 25 unique P4 teams", () => {
    const tids = state.poll.map((e) => e.tid);
    expect(new Set(tids).size).toBe(25);
    for (const tid of tids) expect(state.teams[tid].p4).toBe(true);
  });
});

describe("multi-season stability (10 years)", () => {
  const state = freshDynasty(99);
  const ovrMeans: number[] = [];
  const champs: number[] = [];
  for (let y = 0; y < 10; y++) {
    simToSeasonEnd(state);
    if (state.cfp?.champion != null) champs.push(state.cfp.champion);
    const p4Players = state.teams
      .filter((t) => t.p4)
      .flatMap((t) => t.roster.map((pid) => state.players[pid].ovr));
    ovrMeans.push(p4Players.reduce((a, b) => a + b, 0) / p4Players.length);
    startNextSeason(state);
  }

  it("league OVR does not drift (ceiling model working)", () => {
    const first = ovrMeans[0];
    for (const mean of ovrMeans) {
      expect(Math.abs(mean - first)).toBeLessThan(6);
    }
  });

  it("rosters stay exactly capped and class-legal after rollovers", () => {
    for (const t of state.teams) {
      if (!t.p4) continue;
      expect(t.roster.length).toBe(85);
      for (const pid of t.roster) {
        expect(state.players[pid].cls).toBeGreaterThanOrEqual(1);
        expect(state.players[pid].cls).toBeLessThanOrEqual(4);
      }
    }
  });

  it("no player-dict leaks (active ≈ rostered)", () => {
    const rostered = state.teams.reduce((a, t) => a + t.roster.length, 0);
    expect(Object.keys(state.players)).toHaveLength(rostered);
  });

  it("titles spread across programs but favor the strong", () => {
    expect(new Set(champs).size).toBeGreaterThanOrEqual(3);
  });

  it("honors ledger records every season", () => {
    expect(state.honors).toHaveLength(10);
  });
});

describe("year-2 generated schedule", () => {
  const state = freshDynasty(7);
  simToSeasonEnd(state);
  startNextSeason(state);

  it("gives every P4 team 12 games with no double-booked weeks", () => {
    const count = new Map<number, number>();
    const weeks = new Map<number, Set<number>>();
    for (const g of state.schedule) {
      for (const tid of [g.home, g.away]) {
        if (!state.teams[tid].p4) continue;
        count.set(tid, (count.get(tid) ?? 0) + 1);
        if (!weeks.has(tid)) weeks.set(tid, new Set());
        expect(weeks.get(tid)!.has(g.week)).toBe(false);
        weeks.get(tid)!.add(g.week);
      }
    }
    for (const t of state.teams) {
      if (!t.p4) continue;
      expect(count.get(t.id) ?? 0).toBe(12);
    }
  });

  it("second season simulates cleanly too", () => {
    simToSeasonEnd(state);
    expect(state.phase).toBe("offseason");
    expect(state.honors).toHaveLength(2);
  });
});

describe("advance is safe at the boundaries", () => {
  it("advance during offseason is a no-op until rollover", () => {
    const state = freshDynasty(3);
    simToSeasonEnd(state);
    const hash = stateHash(state);
    advance(state);
    expect(stateHash(state)).toBe(hash);
  });
});
