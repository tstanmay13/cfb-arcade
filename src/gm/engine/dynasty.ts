// Dynasty orchestration: creation from the baked universe, the week-advance
// state machine (regular → CCG → CFP/bowls → offseason → rollover). Engines
// stay storage-free; persistence lives in src/gm/db.ts.
//
// Invariant: state.teams is indexed by team id (bake order preserved).

import type {
  DynastyState, GameResult, GmData, Player, PosGroup, SchedGame, Team,
} from "./types.ts";
import { stream, subSeed } from "./streams.ts";
import { playerFromSeed, generatePlayer } from "./player.ts";
import type { Rng } from "../../engine/rng.ts";
import { selectLineup, traitsFromElo, traitsFromLineup, type Lineup } from "./lineup.ts";
import { simGame, type SideInput, type SimOptions, type SimOutcome } from "./game.ts";
import { eloDelta, eloPreseason } from "./elo.ts";
import { computePoll } from "./poll.ts";
import { generateSchedule, REG_WEEKS } from "./schedule.ts";
import { buildPostseason, ccgGames, nextCfpRound, CFP_NC_WEEK } from "./postseason.ts";
import { resolveRetention, runOffseason, submitPortalRound } from "./offseason.ts";
import { baseBudget, marketValue } from "./nil.ts";
import { generateRecruitPool, recruitingTick, signingDay, WEEKLY_RAP } from "./recruiting.ts";
import { boosterTypeFor, gameBonus, genMandates, initCoaches, staffOf } from "./coaches.ts";
import { poyTop } from "./awards.ts";
import { rangeInt } from "./streams.ts";

/** National recruit pool size per cycle (CFB_GM_DESIGN roster ecology). */
const RECRUIT_POOL = 1450;

const ROSTER_MINIMUMS: [PosGroup, number][] = [
  ["QB", 3], ["RB", 4], ["WR", 6], ["TE", 3], ["OL", 10],
  ["DL", 8], ["LB", 6], ["CB", 5], ["S", 4], ["K", 1], ["P", 1],
];
const CREATE_CAP = 85;

export function createDynasty(
  data: GmData,
  userTid: number,
  seed: number,
  difficulty = 0,
): DynastyState {
  const teams: Team[] = data.teams.map((t) => ({
    ...t,
    roster: [],
    rec: { w: 0, l: 0, cw: 0, cl: 0, pf: 0, pa: 0 },
    prevW: 6,
    nilBudget: t.p4 ? baseBudget(t.prestige) : 0,
    boosterType: boosterTypeFor(seed, t.id),
  }));

  const players: Record<number, Player> = {};
  let pid = 1;

  const byTeam = new Map<number, Player[]>();
  for (const seedRow of data.players) {
    const p = playerFromSeed(seedRow, pid++, seed);
    byTeam.set(seedRow.t, [...(byTeam.get(seedRow.t) ?? []), p]);
  }

  for (const team of teams) {
    if (!team.p4) continue;
    const pool = (byTeam.get(team.id) ?? []).sort((a, b) => b.ovr - a.ovr);
    const kept = new Set<Player>();
    for (const [g, min] of ROSTER_MINIMUMS) {
      for (const p of pool.filter((x) => x.g === g).slice(0, min)) kept.add(p);
    }
    for (const p of pool) {
      if (kept.size >= CREATE_CAP) break;
      kept.add(p);
    }
    // Walk-on fillers for any group still under its minimum (thin real data).
    const fillRng = stream(seed, "fill", team.id);
    for (const [g, min] of ROSTER_MINIMUMS) {
      let have = [...kept].filter((p) => p.g === g).length;
      while (have < min) {
        const p = generatePlayer(g, rangeInt(fillRng, 45, 55), rangeInt(fillRng, 1, 2), pid++, seed, fillRng);
        kept.add(p);
        have++;
      }
    }
    // Enforce the cap: drop the weakest players whose group stays legal.
    const minOf = new Map(ROSTER_MINIMUMS);
    while (kept.size > CREATE_CAP) {
      const counts = new Map<string, number>();
      for (const p of kept) counts.set(p.g, (counts.get(p.g) ?? 0) + 1);
      const droppable = [...kept]
        .filter((p) => (counts.get(p.g) ?? 0) > (minOf.get(p.g) ?? 0))
        .sort((a, b) => a.ovr - b.ovr);
      if (!droppable.length) break;
      kept.delete(droppable[0]);
    }
    for (const p of kept) {
      players[p.id] = p;
      team.roster.push(p.id);
    }
  }

  const schedule: SchedGame[] = data.schedule.map((g, i) => ({
    id: i + 1,
    week: g.w,
    kind: "reg",
    home: g.h,
    away: g.a,
    conf:
      teams[g.h].p4 && teams[g.a].p4 && teams[g.h].conference === teams[g.a].conference,
  }));

  const state: DynastyState = {
    v: 1,
    seed,
    difficulty,
    year: 1,
    season: data.season,
    week: 1,
    phase: "regular",
    userTid,
    teams,
    players,
    nextPid: pid,
    nextGid: schedule.length + 1,
    schedule,
    results: [],
    poll: [],
    cfp: null,
    news: [],
    honors: [],
    offseason: null,
    recruits: [],
    nextRid: 1,
    rapLeft: WEEKLY_RAP,
    pendingVisits: [],
    offStage: "done",
    retention: [],
    portal: [],
    portalRound: 0,
    portalLog: [],
    records: {},
    coaches: [],
    nextCoachId: 1,
    mandates: [],
    openJobs: [],
  };
  state.poll = computePoll(teams, []);
  // Preseason-ranked programs count as "contenders" for deal-breakers in year 1.
  for (const e of state.poll) state.teams[e.tid].prevW = 9;
  // Established players open with NIL money already in hand (morale baseline).
  for (const team of teams) {
    for (const pid of team.roster) {
      const p = players[pid];
      if (p.ovr >= 75) {
        const rng = stream(seed, "nil0", pid);
        p.nil = Math.round((marketValue(p) * (0.5 + rng() * 0.5)) / 500) * 500;
      }
    }
  }
  generateRecruitPool(state, RECRUIT_POOL);
  initCoaches(state);
  genMandates(state);
  return state;
}

function pushNews(state: DynastyState, text: string): void {
  state.news.unshift({ season: state.season, week: state.week, text });
  state.news.splice(60);
}

export function sideFor(state: DynastyState, tid: number): SideInput {
  const team = state.teams[tid];
  let lineup: Lineup | null = null;
  let traits;
  if (team.p4) {
    lineup = selectLineup(team.roster.map((id) => state.players[id]), team.pins);
    traits = traitsFromLineup(lineup);
    // Coaching quality shifts execution across the board (v1.3).
    const bonus = gameBonus(state, tid);
    if (bonus !== 0) {
      traits.airO += bonus; traits.gndO += bonus; traits.prot += bonus;
      traits.sec += bonus; traits.rzO += bonus; traits.st += bonus;
      traits.airD += bonus; traits.gndD += bonus; traits.havoc += bonus;
      traits.hunt += bonus; traits.rzD += bonus;
    }
  } else {
    traits = traitsFromElo(team.elo);
  }
  return { tid, school: team.school, traits, lineup };
}

/** Everything the engine needs to simulate one scheduled game (fast or watched). */
export function prepareGame(
  state: DynastyState,
  game: SchedGame,
): { home: SideInput; away: SideInput; rng: Rng; opts: SimOptions } {
  const rng = stream(state.seed, "game", state.season, game.id);
  const home = sideFor(state, game.home);
  const away = sideFor(state, game.away);
  const neutral = game.kind !== "reg";
  const homeTeam = state.teams[game.home];
  const isRival = !!homeTeam.rivals?.includes(game.away);
  const userSide =
    game.home === state.userTid ? ("home" as const) : game.away === state.userTid ? ("away" as const) : null;
  return {
    home,
    away,
    rng,
    opts: {
      neutral,
      rivalry: isRival || (!!game.conf && game.week >= 12),
      hostileNoise: !neutral && homeTeam.p4 && homeTeam.prestige >= 5,
      userSide,
    },
  };
}

/** Toggle a pinned starter on the user's depth chart. */
export function togglePin(state: DynastyState, pid: number): void {
  const team = state.teams[state.userTid];
  const pins = team.pins ?? [];
  team.pins = pins.includes(pid) ? pins.filter((x) => x !== pid) : [...pins, pid];
}

/** Apply a finished game's outcome to the dynasty (shared by both drivers). */
export function commitOutcome(
  state: DynastyState,
  game: SchedGame,
  out: SimOutcome,
  keepDetail: boolean,
): GameResult {
  const homeTeam = state.teams[game.home];
  const awayTeam = state.teams[game.away];
  const neutral = game.kind !== "reg";

  // Records + Elo.
  const homeWon = out.hs > out.as;
  const [wt, lt] = homeWon ? [homeTeam, awayTeam] : [awayTeam, homeTeam];
  wt.rec.w++;
  lt.rec.l++;
  if (game.conf) {
    wt.rec.cw++;
    lt.rec.cl++;
  }
  homeTeam.rec.pf += out.hs;
  homeTeam.rec.pa += out.as;
  awayTeam.rec.pf += out.as;
  awayTeam.rec.pa += out.hs;
  const delta = eloDelta(wt.elo, lt.elo, Math.abs(out.hs - out.as), neutral ? null : homeWon);
  wt.elo = Math.round(wt.elo + delta);
  lt.elo = Math.round(lt.elo - delta);

  // Player stats + injuries.
  for (const [pid, s] of out.perStats) {
    const p = state.players[pid];
    if (!p) continue;
    for (const k of Object.keys(s) as (keyof typeof s)[]) {
      p.stats[k] += s[k];
    }
  }
  for (const injury of out.injuries) {
    const p = state.players[injury.pid];
    if (p) p.inj = Math.max(p.inj, injury.weeks);
  }

  const result: GameResult = {
    gid: game.id,
    week: game.week,
    kind: game.kind,
    home: game.home,
    away: game.away,
    hs: out.hs,
    as: out.as,
    ot: out.ot,
    name: game.name,
    star: out.star ?? undefined,
  };
  if (keepDetail) {
    result.drives = out.drives;
    result.box = out.box;
  }
  state.results.push(result);
  if (state.cfp && game.kind.startsWith("cfp")) {
    state.cfp.results.push(result);
  }

  // Upset headline: unranked (or shell) knocks off a top-10 team.
  const rankOf = (tid: number) => {
    const i = state.poll.findIndex((e) => e.tid === tid);
    return i >= 0 ? i + 1 : 0;
  };
  const loserTid = homeWon ? game.away : game.home;
  const winnerTid = homeWon ? game.home : game.away;
  const loserRank = rankOf(loserTid);
  if (loserRank > 0 && loserRank <= 10 && rankOf(winnerTid) === 0) {
    pushNews(
      state,
      `DOWN GOES No. ${loserRank}! ${state.teams[winnerTid].school} shocks ${state.teams[loserTid].school} ${Math.max(out.hs, out.as)}-${Math.min(out.hs, out.as)}.`,
    );
  }

  // Narrative layer (feel pass): thrillers, rivalry results, monster games.
  if (out.ot >= 2) {
    pushNews(
      state,
      `⚡ ${out.ot}OT MARATHON: ${state.teams[winnerTid].school} outlasts ${state.teams[loserTid].school} ${Math.max(out.hs, out.as)}-${Math.min(out.hs, out.as)}.`,
    );
  }
  const userInGame = game.home === state.userTid || game.away === state.userTid;
  if (userInGame && homeTeam.rivals?.includes(game.away)) {
    pushNews(
      state,
      winnerTid === state.userTid
        ? `🪓 RIVALRY WIN: you take down ${state.teams[loserTid].school} — the trophy stays home.`
        : `🪓 Rivalry loss to ${state.teams[winnerTid].school}. The boosters felt that one.`,
    );
  }
  let bigLine: { score: number; text: string } | null = null;
  for (const [pid, s] of out.perStats) {
    const p = state.players[pid];
    if (!p) continue;
    const hit =
      s.paYd >= 380 || s.ruYd >= 190 || s.reYd >= 175 || s.sck >= 3 || s.int >= 2;
    if (!hit) continue;
    const score = s.paYd * 0.04 + s.ruYd * 0.1 + s.reYd * 0.1 + s.sck * 8 + s.int * 9;
    const team = state.teams[game.home].roster.includes(pid) ? game.home : game.away;
    const bits =
      s.paYd >= 380
        ? `${s.paYd} passing yds, ${s.paTD} TD`
        : s.ruYd >= 190
          ? `${s.ruYd} rushing yds`
          : s.reYd >= 175
            ? `${s.reYd} receiving yds`
            : s.sck >= 3
              ? `${s.sck} sacks`
              : `${s.int} INTs`;
    if (!bigLine || score > bigLine.score) {
      bigLine = {
        score,
        text: `🔥 ${p.name} (${state.teams[team].school}) goes off: ${bits}.`,
      };
    }
  }
  if (bigLine) pushNews(state, bigLine.text);
  return result;
}

function applyResult(state: DynastyState, game: SchedGame, keepDetail: boolean): GameResult {
  const { home, away, rng, opts } = prepareGame(state, game);
  const out = simGame(home, away, rng, opts);
  return commitOutcome(state, game, out, keepDetail);
}

function simCurrentWeek(state: DynastyState): void {
  // Injured players heal one week at the top of each sim week.
  for (const p of Object.values(state.players)) {
    if (p.inj > 0) p.inj--;
  }
  const played = new Set(state.results.map((r) => r.gid));
  const games = state.schedule.filter((g) => g.week === state.week && !played.has(g.id));
  for (const game of games) {
    const isUser = game.home === state.userTid || game.away === state.userTid;
    applyResult(state, game, isUser);
  }
  const prevNo1 = state.poll[0]?.tid;
  state.poll = computePoll(state.teams, state.poll);
  const newNo1 = state.poll[0]?.tid;
  if (prevNo1 !== undefined && newNo1 !== undefined && prevNo1 !== newNo1) {
    pushNews(state, `👑 New AP No. 1: ${state.teams[newNo1].school}.`);
  }
  weeklyStories(state);
}

/** Season-arc storylines (feel pass): Heisman watch, unbeatens, hot seats. */
function weeklyStories(state: DynastyState): void {
  if (state.phase !== "regular") return;
  if (state.week === 8) {
    const race = poyTop(state, 3);
    if (race.length === 3) {
      pushNews(
        state,
        `🏆 Heisman watch: ${race.map((c, i) => `${i + 1}) ${c.player.name} (${state.teams[c.tid].school})`).join("  ")}`,
      );
    }
  }
  if (state.week === 10) {
    const seats = state.teams
      .filter((t) => {
        if (!t.p4 || t.id === state.userTid) return false;
        const hc = staffOf(state, t.id).HC;
        return !!hc && (hc.lastW[hc.lastW.length - 1] ?? 9) <= 4 && t.rec.l >= 5;
      })
      .slice(0, 3);
    if (seats.length) {
      pushNews(
        state,
        `🔥 Hot-seat watch: ${seats.map((t) => `${staffOf(state, t.id).HC!.name} (${t.school})`).join(", ")}.`,
      );
    }
  }
  if (state.week === 11) {
    const unbeaten = state.teams.filter((t) => t.p4 && t.rec.l === 0 && t.rec.w >= 8);
    if (unbeaten.length > 0 && unbeaten.length <= 6) {
      pushNews(state, `💯 Still perfect: ${unbeaten.map((t) => t.school).join(", ")}.`);
    }
  }
}

/** Advance the dynasty by one sim step (a week, or a postseason round). */
export function advance(state: DynastyState): void {
  if (state.phase === "offseason") return;

  simCurrentWeek(state);

  if (state.phase === "regular") {
    recruitingTick(state);
    if (state.week >= REG_WEEKS) {
      const ccgs = ccgGames(state);
      state.schedule.push(...ccgs);
      state.nextGid += ccgs.length;
      state.phase = "ccg";
      state.week = ccgs[0].week;
    } else {
      state.week++;
    }
    return;
  }

  if (state.phase === "ccg") {
    const winners = state.results
      .filter((r) => r.kind === "ccg")
      .map((r) => (r.hs > r.as ? r.home : r.away));
    for (const tid of winners) {
      pushNews(state, `${state.teams[tid].school} wins the ${state.teams[tid].conference} title.`);
    }
    const slate = buildPostseason(state, winners);
    state.schedule.push(...slate.games);
    state.nextGid += slate.games.length;
    state.cfp = { field: slate.field, results: [], champion: null };
    pushNews(
      state,
      `📋 CFP field revealed — top seeds: ${slate.field.slice(0, 4).map((tid, i) => `${i + 1}) ${state.teams[tid].school}`).join(", ")}${slate.field.includes(state.userTid) ? `. You're in at seed ${slate.field.indexOf(state.userTid) + 1}!` : "."}`,
    );
    signingDay(state);
    state.phase = "cfp";
    state.week = slate.games[0]?.week ?? state.week + 1;
    return;
  }

  // CFP phase: schedule the next round, or finish the season.
  if (state.week >= CFP_NC_WEEK) {
    const nc = state.cfp!.results.find((r) => r.kind === "cfp-nc");
    const champion = nc ? (nc.hs > nc.as ? nc.home : nc.away) : null;
    if (champion !== null) {
      state.cfp!.champion = champion;
      pushNews(state, `🏆 ${state.teams[champion].school} wins the National Championship!`);
    }
    state.offseason = runOffseason(state, champion);
    state.phase = "offseason";
    return;
  }
  const round = nextCfpRound(state);
  state.schedule.push(...round);
  state.nextGid += round.length;
  state.week++;
}

/** Headless offseason: skip retention, make no portal offers (AI still bids). */
export function autoOffseason(state: DynastyState): void {
  if (state.phase !== "offseason") return;
  if (state.offStage === "retention") resolveRetention(state, []);
  let guard = 0;
  while (state.offStage === "portal" && guard++ < 5) {
    submitPortalRound(state, []);
  }
}

/** Leave the offseason: regenerate the world for the next season. */
export function startNextSeason(state: DynastyState): void {
  if (state.phase !== "offseason") return;
  if (state.offStage !== "done") autoOffseason(state);
  state.season++;
  state.year++;
  state.week = 1;
  state.phase = "regular";
  state.results = [];
  state.cfp = null;
  state.offseason = null;
  for (const team of state.teams) {
    team.prevW = team.rec.w;
    team.rec = { w: 0, l: 0, cw: 0, cl: 0, pf: 0, pa: 0 };
    team.elo = Math.round(eloPreseason(team.elo));
  }
  const schedule = generateSchedule(state.teams, state.season, state.seed, state.nextGid);
  state.schedule = schedule;
  state.nextGid = Math.max(...schedule.map((g) => g.id)) + 1;
  state.poll = computePoll(state.teams, []);
  state.rapLeft = WEEKLY_RAP;
  state.pendingVisits = [];
  generateRecruitPool(state, RECRUIT_POOL);
  genMandates(state);
  pushNews(
    state,
    `🗞️ ${state.season} preseason AP No. 1: ${state.teams[state.poll[0].tid].school}. Your board wants: ${state.mandates.map((m) => m.text.toLowerCase()).join(" + ") || "patience"}.`,
  );
}

/** Fast-sim helper: advance until the offseason report is up. */
export function simToSeasonEnd(state: DynastyState): void {
  let guard = 0;
  while (state.phase !== "offseason" && guard++ < 40) {
    advance(state);
  }
}

/** Deterministic fingerprint for calibration/determinism tests. */
export function stateHash(state: DynastyState): number {
  let h = subSeed(state.seed, "hash", state.season, state.week);
  for (const t of state.teams) {
    h = subSeed(h, t.rec.w, t.rec.l, t.elo, t.prestige);
  }
  for (const r of state.results) {
    h = subSeed(h, r.gid, r.hs, r.as);
  }
  for (const r of state.recruits) {
    h = subSeed(h, r.id, r.committed ?? -1, r.leads[0]?.p ?? 0);
  }
  return h;
}
