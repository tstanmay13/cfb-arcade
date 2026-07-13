// CFB-GM calibration harness (CFB_GM_DESIGN "Calibration harness") — ships
// WITH v1.0 as the acceptance gate. Headless multi-season sims asserting
// determinism, scoring realism, upset monotonicity, OVR stability, and the
// closed-universe roster ecology.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DynastyState, GmData } from "./types.ts";
import { advance, autoOffseason, createDynasty, simToSeasonEnd, startNextSeason, stateHash } from "./dynasty.ts";
import { selectLineup, traitsFromElo, traitsFromLineup } from "./lineup.ts";
import { dealBreakerLock, userAction, userPoints } from "./recruiting.ts";
import { resolveRetention, submitPortalRound } from "./offseason.ts";
import { gameBonus, recruitMult, staffOf, takeJob } from "./coaches.ts";
import { commitOutcome, prepareGame, togglePin, sideFor } from "./dynasty.ts";
import { GameSim, simGame } from "./game.ts";
import { buildSeasonRecap } from "./recap.ts";

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

  it("league OVR settles to a stable level (ceiling model working)", () => {
    // The real-import year-1 league may settle a few points as generated
    // cohorts replace it; what matters is that it stops moving.
    const first = ovrMeans[0];
    for (const mean of ovrMeans) {
      expect(Math.abs(mean - first)).toBeLessThan(9);
    }
    const tail = ovrMeans.slice(-5);
    const tailSpread = Math.max(...tail) - Math.min(...tail);
    expect(tailSpread).toBeLessThan(3);
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

describe("recruiting (v1.1)", () => {
  it("generates a national pool with the designed star shape", () => {
    const state = freshDynasty(21);
    expect(state.recruits.length).toBe(1450);
    const five = state.recruits.filter((r) => r.stars === 5).length;
    const four = state.recruits.filter((r) => r.stars === 4).length;
    expect(five).toBeGreaterThan(10);
    expect(five).toBeLessThan(60);
    expect(four).toBeGreaterThan(180);
    expect(state.recruits.every((r) => r.committed === null)).toBe(true);
    // Gems/busts hidden in ~30% of the pool.
    const gb = state.recruits.filter((r) => r.gb !== 0).length / 1450;
    expect(gb).toBeGreaterThan(0.2);
    expect(gb).toBeLessThan(0.4);
  });

  it("user actions spend RAP, add interest, and respect scouting order + locks", () => {
    const state = freshDynasty(22);
    const open = state.recruits.find((r) => !dealBreakerLock(state, r, USER_TID))!;
    expect(userAction(state, open.id, "s2")).toBeTruthy(); // S1 required first
    expect(userAction(state, open.id, "dm")).toBeNull();
    expect(state.rapLeft).toBe(590);
    // Staff recruiter multiplier scales interest gains (v1.3).
    expect(userPoints(open, USER_TID)).toBe(Math.round(15 * recruitMult(state, USER_TID)));
    expect(userAction(state, open.id, "s1")).toBeNull();
    expect(userAction(state, open.id, "s2")).toBeNull();
    expect(open.scouted).toBe(2);

    const locked = state.recruits.find((r) => dealBreakerLock(state, r, USER_TID));
    if (locked) {
      expect(userAction(state, locked.id, "dm")).toContain("Locked");
      expect(userAction(state, locked.id, "s1")).toBeNull(); // scouting always allowed
    }
  });

  it("interest race commits recruits during the season and signs classes that track prestige", () => {
    const state = freshDynasty(23);
    simToSeasonEnd(state);
    autoOffseason(state); // classes sign at the final offseason stage (v1.2)
    // After the offseason, cls-1 players are the signed class.
    const byPrestige: [number, number][] = state.teams
      .filter((t) => t.p4)
      .map((t) => {
        const frosh = t.roster.map((pid) => state.players[pid]).filter((p) => p.cls === 1);
        const avg = frosh.reduce((a, p) => a + p.ovr, 0) / Math.max(1, frosh.length);
        return [t.prestige, avg] as [number, number];
      });
    const hi = byPrestige.filter(([p]) => p >= 5).map(([, v]) => v);
    const lo = byPrestige.filter(([p]) => p <= 2).map(([, v]) => v);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean(hi)).toBeGreaterThan(mean(lo) + 2); // blue bloods sign better
    // Most of the pool found a home or was consumed by fills, pool then reset.
    expect(state.recruits).toHaveLength(0);
  });

  it("weekly RAP refreshes and commits show up in news", () => {
    const state = freshDynasty(24);
    state.rapLeft = 5;
    advance(state);
    expect(state.rapLeft).toBe(600);
    for (let i = 0; i < 9; i++) advance(state);
    expect(state.recruits.some((r) => r.committed !== null)).toBe(true);
  });
});

describe("portal & NIL (v1.2)", () => {
  const state = freshDynasty(31);
  simToSeasonEnd(state);

  it("offseason halts at the retention stage with priced user cases", () => {
    expect(state.offStage).toBe("retention");
    for (const c of state.retention) {
      expect(c.ask).toBeGreaterThan(0);
      expect(state.players[c.pid]).toBeDefined();
    }
  });

  it("portal churn lands in a realistic band; budgets never go negative", () => {
    resolveRetention(state, []);
    expect(state.offStage).toBe("portal");
    const poolSize = state.portal.length;
    expect(poolSize).toBeGreaterThan(200);
    expect(poolSize).toBeLessThan(1500);
    let guard = 0;
    while (state.offStage === "portal" && guard++ < 5) submitPortalRound(state, []);
    expect(state.offStage).toBe("done");
    for (const t of state.teams) {
      expect(t.nilBudget).toBeGreaterThanOrEqual(0);
    }
    // The pool fully resolves: players either found a new P4 home or stepped down.
    expect(state.portal).toHaveLength(0);
    const downs = state.offseason!.archive.filter((a) => a.reason === "transfer-down").length;
    const placements = poolSize - downs;
    expect(placements).toBeGreaterThan(50); // AI programs actually shop the portal
    expect(downs).toBeGreaterThanOrEqual(0);
  });

  it("draft rounds, All-America team, and record books populate", () => {
    const drafted = state.offseason!.archive.filter((a) => a.draft);
    expect(drafted.length).toBeGreaterThan(80);
    expect(drafted.length).toBeLessThanOrEqual(224);
    expect(Math.max(...drafted.map((a) => a.draft!.round))).toBeLessThanOrEqual(7);
    expect(state.honors[0].allAmericans).toHaveLength(9);
    expect(Object.keys(state.records)).toHaveLength(10);
    expect(state.records["Passing yards"].season.length).toBeGreaterThan(3);
    expect(state.records["Passing yards"].season[0].value).toBeGreaterThan(2000);
  });

  it("rollover still lands exactly 85 everywhere with clean player dict", () => {
    startNextSeason(state);
    for (const t of state.teams) {
      if (t.p4) expect(t.roster.length).toBe(85);
    }
    const rostered = state.teams.reduce((a, t) => a + t.roster.length, 0);
    expect(Object.keys(state.players)).toHaveLength(rostered);
  });

  it("retention pay only charges on success", () => {
    const s2 = freshDynasty(32);
    simToSeasonEnd(s2);
    if (s2.retention.length > 0) {
      const c = s2.retention[0];
      const before = s2.teams[s2.userTid].nilBudget;
      resolveRetention(s2, [c.pid]);
      const stayed = s2.teams[s2.userTid].roster.includes(c.pid);
      expect(s2.teams[s2.userTid].nilBudget).toBe(stayed ? before - c.ask : before);
    }
  });
});

describe("coaches & boosters (v1.3)", () => {
  it("every P4 program has a full staff and effects stay bounded", () => {
    const state = freshDynasty(41);
    for (const t of state.teams) {
      if (!t.p4) continue;
      const staff = staffOf(state, t.id);
      expect(staff.HC).toBeDefined();
      expect(staff.OC).toBeDefined();
      expect(staff.DC).toBeDefined();
      const b = gameBonus(state, t.id);
      expect(b).toBeGreaterThanOrEqual(-2);
      expect(b).toBeLessThanOrEqual(6);
    }
    expect(state.mandates.length).toBeGreaterThanOrEqual(1);
    expect(state.mandates.length).toBeLessThanOrEqual(2);
  });

  it("rivalries are baked, mutual, and real-shaped", () => {
    const state = freshDynasty(42);
    const withRivals = state.teams.filter((t) => t.p4 && (t.rivals?.length ?? 0) > 0);
    expect(withRivals.length).toBe(68);
    for (const t of withRivals) {
      for (const r of t.rivals!) {
        expect(state.teams[r].rivals).toContain(t.id);
      }
    }
  });

  it("the carousel fires and hires over a few seasons; mandates get verdicts", () => {
    const state = freshDynasty(43);
    const initialHCs = new Map(
      state.teams.filter((t) => t.p4).map((t) => [t.id, staffOf(state, t.id).HC!.id]),
    );
    for (let y = 0; y < 3; y++) {
      simToSeasonEnd(state);
      autoOffseason(state);
      for (const m of state.mandates) expect(m.met).not.toBeNull();
      startNextSeason(state);
    }
    let changed = 0;
    for (const t of state.teams) {
      if (!t.p4) continue;
      const hc = staffOf(state, t.id).HC;
      expect(hc).toBeDefined(); // no program left headless
      if (hc!.id !== initialHCs.get(t.id)) changed++;
    }
    expect(changed).toBeGreaterThan(3); // the carousel actually spins
  });

  it("takeJob moves the user and backfills the old program", () => {
    const state = freshDynasty(44);
    simToSeasonEnd(state);
    autoOffseason(state);
    const oldTid = state.userTid;
    if (state.openJobs.length > 0) {
      const target = state.openJobs[0];
      expect(takeJob(state, target)).toBe(true);
      expect(state.userTid).toBe(target);
      expect(staffOf(state, oldTid).HC).toBeDefined();
    }
  });
});

describe("watch mode & football edges (v1.4)", () => {
  it("stepping a GameSim matches the fast-sim exactly (same stream)", () => {
    const state = freshDynasty(51);
    const game = state.schedule.find((g) => g.week === 1)!;
    const a = prepareGame(state, game);
    const fast = simGame(a.home, a.away, a.rng, a.opts);
    const b = prepareGame(state, game); // fresh identical stream
    const sim = new GameSim(b.home, b.away, b.rng, b.opts);
    let guard = 0;
    while (!sim.done && guard++ < 80) sim.playDrive();
    const stepped = sim.outcome();
    expect(stepped.hs).toBe(fast.hs);
    expect(stepped.as).toBe(fast.as);
    expect(stepped.drives.length).toBe(fast.drives.length);
  });

  it("a watched game commits once and the week sim skips it", () => {
    const state = freshDynasty(52);
    const game = state.schedule.find(
      (g) => g.week === 1 && (g.home === state.userTid || g.away === state.userTid),
    );
    if (game) {
      const { home, away, rng, opts } = prepareGame(state, game);
      const out = simGame(home, away, rng, opts);
      commitOutcome(state, game, out, true);
      const before = state.results.length;
      advance(state); // sims the REST of week 1
      const dupes = state.results.filter((r) => r.gid === game.id);
      expect(dupes).toHaveLength(1);
      expect(state.results.length).toBeGreaterThan(before);
    }
  });

  it("QB spark swap benches the starter; blitz raises havoc plays", () => {
    const state = freshDynasty(53);
    const game = state.schedule.find(
      (g) => g.week === 1 && (g.home === state.userTid || g.away === state.userTid),
    )!;
    const { home, away, rng, opts } = prepareGame(state, game);
    const sim = new GameSim(home, away, rng, opts);
    const side = opts.userSide === "home" ? sim.home : sim.away;
    const qb1 = side.lineup!.QB![0].id;
    const msg = sim.swapQb();
    expect(msg).toBeTruthy();
    expect(side.lineup!.QB![0].id).not.toBe(qb1);
    expect(sim.swapQb()).toBeNull(); // once per game

    // Blitz-heavy across many games → more sacks than base coaching.
    let blitzSacks = 0;
    let baseSacks = 0;
    for (let i = 0; i < 24; i++) {
      const g2 = state.schedule[i];
      const p1 = prepareGame(state, g2);
      const s1 = new GameSim(p1.home, p1.away, p1.rng, { ...p1.opts, userSide: "home" });
      s1.finish({ blitz: true });
      blitzSacks += s1.outcome().perStats.reduce((a, [, s]) => a + s.sck, 0);
      const p2 = prepareGame(state, g2);
      const s2 = new GameSim(p2.home, p2.away, p2.rng, { ...p2.opts, userSide: "home" });
      s2.finish();
      baseSacks += s2.outcome().perStats.reduce((a, [, s]) => a + s.sck, 0);
    }
    expect(blitzSacks).toBeGreaterThan(baseSacks);
  });

  it("pins promote a backup into the lineup", () => {
    const state = freshDynasty(54);
    const user = state.teams[state.userTid];
    const qbs = user.roster
      .map((pid) => state.players[pid])
      .filter((p) => p.g === "QB" && p.inj === 0)
      .sort((a, b) => b.ovr - a.ovr);
    const backup = qbs[1];
    togglePin(state, backup.id);
    const lineup = sideFor(state, state.userTid).lineup!;
    expect(lineup.QB![0].id).toBe(backup.id);
    togglePin(state, backup.id);
    expect(sideFor(state, state.userTid).lineup!.QB![0].id).toBe(qbs[0].id);
  });

  it("redshirts bank a year for low-usage players, once", () => {
    const state = freshDynasty(55);
    for (let y = 0; y < 2; y++) {
      simToSeasonEnd(state);
      autoOffseason(state);
      startNextSeason(state);
    }
    const rsPlayers = Object.values(state.players).filter((p) => p.rs);
    expect(rsPlayers.length).toBeGreaterThan(200);
    for (const p of rsPlayers) {
      expect(p.cls).toBeGreaterThanOrEqual(1);
      expect(p.cls).toBeLessThanOrEqual(4);
    }
  });
});

describe("quick wins: difficulty, recap, 50-year soak", () => {
  it("difficulty squeezes the user's NIL, never helps it", () => {
    const normal = createDynasty(data, USER_TID, 61, 0);
    const brutal = createDynasty(data, USER_TID, 61, 2);
    simToSeasonEnd(normal);
    simToSeasonEnd(brutal);
    autoOffseason(normal);
    autoOffseason(brutal);
    expect(brutal.teams[USER_TID].nilBudget).toBeLessThan(normal.teams[USER_TID].nilBudget);
  });

  it("the season recap shares a full result grid", () => {
    const state = freshDynasty(62);
    simToSeasonEnd(state);
    autoOffseason(state);
    const recap = buildSeasonRecap(state);
    const userGames = state.results.filter(
      (r) => r.home === USER_TID || r.away === USER_TID,
    ).length;
    const squares = [...recap].filter((c) => "🟩🟥🟨🟧".includes(c)).length;
    expect(squares).toBe(userGames);
    expect(recap).toContain(state.teams[USER_TID].school);
    expect(recap).toMatch(/\d+-\d+/);
    expect(recap).toContain("Class #");
  });

  it(
    "survives a 50-year dynasty without leaks, bloat, or drift",
    () => {
      const state = freshDynasty(63);
      for (let y = 0; y < 50; y++) {
        simToSeasonEnd(state);
        autoOffseason(state);
        startNextSeason(state);
      }
      expect(state.year).toBe(51);
      expect(state.honors).toHaveLength(50);
      for (const t of state.teams) {
        if (t.p4) expect(t.roster.length).toBe(85);
        expect(t.prestige).toBeGreaterThanOrEqual(t.p4 ? 1 : 0);
        expect(t.nilBudget).toBeGreaterThanOrEqual(0);
      }
      const rostered = state.teams.reduce((a, t) => a + t.roster.length, 0);
      expect(Object.keys(state.players)).toHaveLength(rostered);
      expect(state.coaches.length).toBeLessThan(260);
      expect(state.news.length).toBeLessThanOrEqual(60);
      for (const book of Object.values(state.records)) {
        expect(book.season.length).toBeLessThanOrEqual(10);
        expect(book.career.length).toBeLessThanOrEqual(10);
      }
      // Snapshot stays exportable at a sane size.
      const bytes = JSON.stringify(state).length;
      expect(bytes).toBeLessThan(15_000_000);
      // League strength anchored after 50 generated cohorts.
      const ovrs = state.teams
        .filter((t) => t.p4)
        .flatMap((t) => t.roster.map((pid) => state.players[pid].ovr));
      const mean = ovrs.reduce((a, b) => a + b, 0) / ovrs.length;
      expect(mean).toBeGreaterThan(55);
      expect(mean).toBeLessThan(75);
    },
    120_000,
  );
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
