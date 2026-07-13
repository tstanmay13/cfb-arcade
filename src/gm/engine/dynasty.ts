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
import { selectLineup, traitsFromElo, traitsFromLineup, type Lineup } from "./lineup.ts";
import { simGame, type SideInput } from "./game.ts";
import { eloDelta, eloPreseason } from "./elo.ts";
import { computePoll } from "./poll.ts";
import { generateSchedule, REG_WEEKS } from "./schedule.ts";
import { buildPostseason, ccgGames, nextCfpRound, CFP_NC_WEEK } from "./postseason.ts";
import { runOffseason } from "./offseason.ts";
import { rangeInt } from "./streams.ts";

const ROSTER_MINIMUMS: [PosGroup, number][] = [
  ["QB", 3], ["RB", 4], ["WR", 6], ["TE", 3], ["OL", 10],
  ["DL", 8], ["LB", 6], ["CB", 5], ["S", 4], ["K", 1], ["P", 1],
];
const CREATE_CAP = 85;

export function createDynasty(data: GmData, userTid: number, seed: number): DynastyState {
  const teams: Team[] = data.teams.map((t) => ({
    ...t,
    roster: [],
    rec: { w: 0, l: 0, cw: 0, cl: 0, pf: 0, pa: 0 },
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
  };
  state.poll = computePoll(teams, []);
  return state;
}

function pushNews(state: DynastyState, text: string): void {
  state.news.unshift({ season: state.season, week: state.week, text });
  state.news.splice(60);
}

function sideFor(state: DynastyState, tid: number): SideInput {
  const team = state.teams[tid];
  let lineup: Lineup | null = null;
  let traits;
  if (team.p4) {
    lineup = selectLineup(team.roster.map((id) => state.players[id]));
    traits = traitsFromLineup(lineup);
  } else {
    traits = traitsFromElo(team.elo);
  }
  return { tid, school: team.school, traits, lineup };
}

function applyResult(state: DynastyState, game: SchedGame, keepDetail: boolean): GameResult {
  const rng = stream(state.seed, "game", state.season, game.id);
  const home = sideFor(state, game.home);
  const away = sideFor(state, game.away);
  const neutral = game.kind !== "reg";
  const homeTeam = state.teams[game.home];
  const awayTeam = state.teams[game.away];
  const out = simGame(home, away, rng, {
    neutral,
    rivalry: !!game.conf && game.week >= 12,
    hostileNoise: !neutral && homeTeam.p4 && homeTeam.prestige >= 5,
  });

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
  return result;
}

function simCurrentWeek(state: DynastyState): void {
  // Injured players heal one week at the top of each sim week.
  for (const p of Object.values(state.players)) {
    if (p.inj > 0) p.inj--;
  }
  const games = state.schedule.filter((g) => g.week === state.week);
  for (const game of games) {
    const isUser = game.home === state.userTid || game.away === state.userTid;
    const result = applyResult(state, game, isUser);
    if (state.cfp && game.kind.startsWith("cfp")) {
      state.cfp.results.push(result);
    }
  }
  state.poll = computePoll(state.teams, state.poll);
}

/** Advance the dynasty by one sim step (a week, or a postseason round). */
export function advance(state: DynastyState): void {
  if (state.phase === "offseason") return;

  simCurrentWeek(state);

  if (state.phase === "regular") {
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

/** Leave the offseason: regenerate the world for the next season. */
export function startNextSeason(state: DynastyState): void {
  if (state.phase !== "offseason") return;
  state.season++;
  state.year++;
  state.week = 1;
  state.phase = "regular";
  state.results = [];
  state.cfp = null;
  state.offseason = null;
  for (const team of state.teams) {
    team.rec = { w: 0, l: 0, cw: 0, cl: 0, pf: 0, pa: 0 };
    team.elo = Math.round(eloPreseason(team.elo));
  }
  const schedule = generateSchedule(state.teams, state.season, state.seed, state.nextGid);
  state.schedule = schedule;
  state.nextGid = Math.max(...schedule.map((g) => g.id)) + 1;
  state.poll = computePoll(state.teams, []);
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
  return h;
}
