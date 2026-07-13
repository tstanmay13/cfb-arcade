// Future-season schedule generation (year 2+; year 1 plays the real baked
// 2026 slate). Shape per CFB_GM_DESIGN: 9 pool games via the circle method +
// 1 P4 crossover + 2 shell buy games, weeks 1-13, CCG at week 14. Notre Dame
// schedules inside the ACC pool (mirroring its real ACC slate) with those
// games flagged non-conference.

import type { Rng } from "../../engine/rng.ts";
import { shuffle } from "../../engine/rng.ts";
import type { SchedGame, Team } from "./types.ts";
import { stream, subSeed } from "./streams.ts";

export const REG_WEEKS = 13;
export const CCG_WEEK = 14;
export const POOL_ROUNDS = 9;

/** Scheduling pools: the four P4 conferences, ND folded into the ACC pool. */
function pools(teams: Team[]): Map<string, number[]> {
  const map = new Map<string, number[]>();
  for (const t of teams) {
    if (!t.p4) continue;
    const pool = t.conference === "SEC" || t.conference === "Big Ten" || t.conference === "Big 12"
      ? t.conference
      : "ACC"; // ACC members + Notre Dame
    map.set(pool, [...(map.get(pool) ?? []), t.id]);
  }
  return map;
}

/** Circle-method round-robin rounds for an even-sized pool. */
function roundRobin(ids: number[], rng: Rng): [number, number][][] {
  const arr = shuffle(ids, rng);
  const n = arr.length;
  const rounds: [number, number][][] = [];
  const rot = arr.slice(1);
  for (let r = 0; r < n - 1; r++) {
    const cur = [arr[0], ...rot];
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = cur[i];
      const b = cur[n - 1 - i];
      // Alternate home/away by round parity for rough balance.
      pairs.push(r % 2 === 0 ? [a, b] : [b, a]);
    }
    rounds.push(pairs);
    rot.unshift(rot.pop()!);
  }
  return rounds;
}

export function generateSchedule(
  teams: Team[],
  season: number,
  rootSeed: number,
  firstGid: number,
): SchedGame[] {
  const rng = stream(rootSeed, "sched", season);
  const games: SchedGame[] = [];
  let gid = firstGid;
  const busy = new Map<number, Set<number>>(); // tid → weeks with a game
  const oocLeft = new Map<number, number>(); // tid → OOC games still needed
  const confOf = new Map(teams.map((t) => [t.id, t.conference]));
  const mark = (tid: number, w: number) => {
    if (!busy.has(tid)) busy.set(tid, new Set());
    busy.get(tid)!.add(w);
  };
  const free = (tid: number, w: number) => !(busy.get(tid)?.has(w) ?? false);

  // --- Pool rounds: 9 of the 10 weeks 4..13 (pool-wide bye on the other) ----
  for (const [, ids] of pools(teams)) {
    const rounds = roundRobin(ids, rng).slice(0, POOL_ROUNDS);
    const weeks = shuffle([4, 5, 6, 7, 8, 9, 10, 11, 12, 13], rng).slice(0, POOL_ROUNDS).sort((a, b) => a - b);
    rounds.forEach((pairs, i) => {
      for (const [h, a] of pairs) {
        const conf = confOf.get(h) === confOf.get(a); // ND pool games are non-conf
        games.push({ id: gid++, week: weeks[i], kind: "reg", home: h, away: a, conf });
        mark(h, weeks[i]);
        mark(a, weeks[i]);
      }
    });
    for (const id of ids) oocLeft.set(id, 3);
  }

  // --- OOC weeks 1-3: one P4 crossover + shell buy games -------------------
  const p4Ids = teams.filter((t) => t.p4).map((t) => t.id);
  const shells = teams.filter((t) => !t.p4 && t.conference !== "FCS").map((t) => t.id);
  // Each team attempts its P4 crossover in a seeded week 1..3.
  for (let w = 1; w <= 3; w++) {
    const wanting = shuffle(
      p4Ids.filter((tid) => (subSeed(rootSeed, "xw", season, tid) % 3) + 1 === w && free(tid, w)),
      rng,
    );
    while (wanting.length >= 2) {
      const a = wanting.pop()!;
      // Prefer a cross-conference partner.
      let idx = wanting.findIndex((b) => confOf.get(b) !== confOf.get(a));
      if (idx < 0) idx = wanting.length - 1;
      const b = wanting.splice(idx, 1)[0];
      const [h, aw] = rng() < 0.5 ? [a, b] : [b, a];
      games.push({ id: gid++, week: w, kind: "reg", home: h, away: aw, conf: false });
      mark(h, w);
      mark(aw, w);
      oocLeft.set(h, oocLeft.get(h)! - 1);
      oocLeft.set(aw, oocLeft.get(aw)! - 1);
    }
  }

  // --- Fill remaining OOC needs with shell games in any free week ----------
  for (const tid of p4Ids) {
    let need = oocLeft.get(tid) ?? 0;
    const shellPool = shuffle(shells, stream(rootSeed, "shells", season, tid));
    let si = 0;
    for (let w = 1; w <= REG_WEEKS && need > 0; w++) {
      if (!free(tid, w)) continue;
      const shell = shellPool[si++ % shellPool.length];
      games.push({ id: gid++, week: w, kind: "reg", home: tid, away: shell, conf: false });
      mark(tid, w);
      need--;
    }
    oocLeft.set(tid, 0);
  }

  return games.sort((x, y) => x.week - y.week || x.id - y.id);
}
