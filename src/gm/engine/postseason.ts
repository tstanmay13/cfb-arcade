// Postseason structure: conference championship games, the 12-team CFP
// (4 P4 champs auto-bid + 8 at-large, straight seeding, top-4 byes), and a
// named bowl slate for 6+ win teams (CFB_GM_DESIGN "Postseason").

import type { DynastyState, SchedGame, Team } from "./types.ts";
import { committeeOrder } from "./poll.ts";
import { CCG_WEEK } from "./schedule.ts";

export const CFP_R1_WEEK = 15;
export const CFP_QF_WEEK = 16;
export const CFP_SF_WEEK = 17;
export const CFP_NC_WEEK = 18;

export const REAL_CONFS = ["SEC", "Big Ten", "Big 12", "ACC"];

const BOWL_NAMES = [
  "Citrus Bowl", "Alamo Bowl", "Holiday Bowl", "Gator Bowl", "Sun Bowl",
  "Music City Bowl", "Pinstripe Bowl", "Las Vegas Bowl", "Texas Bowl", "Duke's Mayo Bowl",
  "Liberty Bowl", "Armed Forces Bowl", "Birmingham Bowl", "Independence Bowl",
  "First Responder Bowl", "Pop-Tarts Bowl",
];
const QF_BOWLS = ["Fiesta Bowl", "Peach Bowl", "Rose Bowl", "Sugar Bowl"];
const SF_BOWLS = ["Cotton Bowl", "Orange Bowl"];

/** Conference standings order: conf win% → overall win% → Elo. */
export function confStandings(teams: Team[], conference: string): Team[] {
  return teams
    .filter((t) => t.p4 && t.conference === conference)
    .sort((a, b) => {
      const ap = a.rec.cw + a.rec.cl === 0 ? 0 : a.rec.cw / (a.rec.cw + a.rec.cl);
      const bp = b.rec.cw + b.rec.cl === 0 ? 0 : b.rec.cw / (b.rec.cw + b.rec.cl);
      if (bp !== ap) return bp - ap;
      const aw = a.rec.w / Math.max(1, a.rec.w + a.rec.l);
      const bw = b.rec.w / Math.max(1, b.rec.w + b.rec.l);
      if (bw !== aw) return bw - aw;
      return b.elo - a.elo;
    });
}

export function ccgGames(state: DynastyState): SchedGame[] {
  return REAL_CONFS.map((conf, i) => {
    const [one, two] = confStandings(state.teams, conf);
    return {
      id: state.nextGid + i,
      week: CCG_WEEK,
      kind: "ccg" as const,
      home: one.id,
      away: two.id,
      conf: false,
      name: `${conf} Championship`,
    };
  });
}

export interface PostseasonSlate {
  field: number[];
  games: SchedGame[];
}

/** CFP field + first round + the bowl slate, built after CCGs. */
export function buildPostseason(state: DynastyState, ccgWinners: number[]): PostseasonSlate {
  const order = committeeOrder(state.teams);
  const champs = new Set(ccgWinners);
  const field: number[] = [];
  for (const tid of order) {
    if (champs.has(tid)) field.push(tid);
  }
  for (const tid of order) {
    if (field.length >= 12) break;
    if (!champs.has(tid)) field.push(tid);
  }
  // Straight seeding by committee order.
  field.sort((a, b) => order.indexOf(a) - order.indexOf(b));

  let gid = state.nextGid;
  const games: SchedGame[] = [];
  // First round at the higher seed: 12@5, 11@6, 10@7, 9@8.
  for (let i = 0; i < 4; i++) {
    games.push({
      id: gid++,
      week: CFP_R1_WEEK,
      kind: "cfp-r1",
      home: field[4 + i],
      away: field[11 - i],
      conf: false,
      name: `CFP First Round`,
    });
  }
  // Bowls: 6+ wins, not in the field, by committee order, adjacent pairing.
  const eligible = order.filter((tid) => {
    const t = state.teams[tid];
    return !field.includes(tid) && t.rec.w >= 6;
  });
  for (let b = 0; b + 1 < eligible.length && b / 2 < BOWL_NAMES.length; b += 2) {
    games.push({
      id: gid++,
      week: CFP_R1_WEEK,
      kind: "bowl",
      home: eligible[b],
      away: eligible[b + 1],
      conf: false,
      name: BOWL_NAMES[b / 2],
    });
  }
  return { field, games };
}

/** Next CFP round's games given the current bracket state. */
export function nextCfpRound(state: DynastyState): SchedGame[] {
  const cfp = state.cfp!;
  const { field } = cfp;
  const winner = (a: number, b: number): number | null => {
    const g = cfp.results.find(
      (r) => (r.home === a && r.away === b) || (r.home === b && r.away === a),
    );
    if (!g) return null;
    return g.hs > g.as ? g.home : g.away;
  };
  let gid = state.nextGid;

  const r1Done = cfp.results.filter((r) => r.kind === "cfp-r1").length === 4;
  const qfDone = cfp.results.filter((r) => r.kind === "cfp-qf").length === 4;
  const sfDone = cfp.results.filter((r) => r.kind === "cfp-sf").length === 2;

  if (!r1Done) return [];
  if (cfp.results.filter((r) => r.kind === "cfp-qf").length === 0 && r1Done) {
    // QFs: 1 v W(8/9), 2 v W(7/10), 3 v W(6/11), 4 v W(5/12).
    const pairs: [number, number][] = [
      [field[0], winner(field[7], field[8])!],
      [field[1], winner(field[6], field[9])!],
      [field[2], winner(field[5], field[10])!],
      [field[3], winner(field[4], field[11])!],
    ];
    return pairs.map(([h, a], i) => ({
      id: gid++, week: CFP_QF_WEEK, kind: "cfp-qf" as const, home: h, away: a,
      conf: false, name: QF_BOWLS[i],
    }));
  }
  if (qfDone && cfp.results.filter((r) => r.kind === "cfp-sf").length === 0) {
    const qf = cfp.results.filter((r) => r.kind === "cfp-qf");
    const w = qf.map((g) => (g.hs > g.as ? g.home : g.away));
    return [
      { id: gid++, week: CFP_SF_WEEK, kind: "cfp-sf", home: w[0], away: w[3], conf: false, name: SF_BOWLS[0] },
      { id: gid++, week: CFP_SF_WEEK, kind: "cfp-sf", home: w[1], away: w[2], conf: false, name: SF_BOWLS[1] },
    ];
  }
  if (sfDone && cfp.results.filter((r) => r.kind === "cfp-nc").length === 0) {
    const sf = cfp.results.filter((r) => r.kind === "cfp-sf");
    const w = sf.map((g) => (g.hs > g.as ? g.home : g.away));
    return [
      { id: gid++, week: CFP_NC_WEEK, kind: "cfp-nc", home: w[0], away: w[1], conf: false, name: "National Championship" },
    ];
  }
  return [];
}
