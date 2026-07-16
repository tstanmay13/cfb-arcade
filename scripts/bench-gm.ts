// CFB-GM policy benchmark harness (docs/benchmarks/). Plays headless
// multi-decade dynasties under scripted decision profiles that act ONLY on
// user-visible information — a reproducible floor on "managed play" and the
// baseline to diff after any tuning change.
//
//   npm run bench:gm -- run 0 20        # simulate grid cells [0,20) → .bench/
//   npm run bench:gm -- run             # the whole grid (slow, ~35-50 min)
//   npm run bench:gm -- report          # aggregate .bench/*.json
//   npm run bench:gm -- report docs/benchmarks/2026-07-13-baseline.results.json
//
// Grid: 4 policies × 3 prestige tiers × 8 seeds × 30 seasons, plus a
// Brutal-difficulty arm (104 runs, 3,120 seasons). Slices are resumable —
// each `run` writes .bench/bench-<start>.json; `report` merges whatever it
// finds. Compare reports across commits, not within one (seeds are fixed).
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DynastyState, GmData, Recruit } from "../src/gm/engine/types.ts";
import { advance, createDynasty, startNextSeason } from "../src/gm/engine/dynasty.ts";
import {
  advanceOffseasonWeek, effectiveAsk, portalFit, type PortalOffer,
} from "../src/gm/engine/offseason.ts";
import {
  dealBreakerLock, teamNeeds, userAction, userPoints,
} from "../src/gm/engine/recruiting.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(HERE, "..", "public", "gm-data.json");
const BENCH_DIR = join(HERE, "..", ".bench");

const SEASONS = 30;
const SEEDS = [9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008];

interface SeasonRow {
  season: number;
  wins: number;
  losses: number;
  rank: number | null;
  cfp: boolean;
  natty: boolean;
  ccgWin: boolean;
  classRank: number | null;
  prestige: number;
  portalIn: number;
  portalOut: number;
  nextBudget: number;
}

interface RunRow {
  policy: string;
  tier: string;
  school: string;
  seed: number;
  difficulty: number;
  perSeason: SeasonRow[];
  finalRosterOvr: number;
}

// ---------------------------------------------------------------------------
// Policies (visible-info only — stars, locks, leads, asks; never hidden ovr)
// ---------------------------------------------------------------------------

/** One offseason week of recruiting spend from the shared stamina pool
    (ADR-0027: recruiting is offseason-only; costs dm 10 / coach 15 / hc 25). */
function recruitWeek(state: DynastyState, breadth: number): void {
  const uid = state.userTid;
  const needs = teamNeeds(state, state.teams[uid]);
  const cands = state.recruits
    .filter((r: Recruit) => r.committed === null && !r.hidden && !dealBreakerLock(state, r, uid))
    .map((r: Recruit) => {
      const mine = userPoints(r, uid);
      let score = r.stars * 10 + ((needs.get(r.g) ?? 0) > 0 ? 8 : 0);
      if (mine > 0) score += 6;
      if (r.leads[0]?.t === uid) score += 10;
      else if (r.leads.length > 0) score -= 2;
      return { r, score, mine };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, breadth);

  for (const { r, mine } of cands) {
    if (state.stamina < 10) break;
    if (!r.hcUsed && state.stamina >= 25 && mine >= 50) {
      userAction(state, r.id, "hc");
    } else if (state.stamina >= 15) {
      userAction(state, r.id, "coach");
    } else {
      userAction(state, r.id, "dm");
    }
  }
  for (const { r } of cands) {
    if (state.stamina < 10) break;
    userAction(state, r.id, "dm");
  }
}

/** Which flight-risk players to pay (visible info: ask, OVR, budget). */
function retentionPolicy(state: DynastyState, mode: "none" | "all" | "stars"): number[] {
  if (mode === "none") return [];
  let budget = state.teams[state.userTid].nilBudget;
  const paid: number[] = [];
  const cases = [...state.retention].sort(
    (a, b) => state.players[b.pid].ovr - state.players[a.pid].ovr,
  );
  for (const c of cases) {
    const want = mode === "all" ? true : state.players[c.pid].ovr >= 80;
    if (want && c.ask <= budget) {
      paid.push(c.pid);
      budget -= c.ask;
    }
  }
  return paid;
}

/** Portal offers priced off the visible fit discount (the UI's YOUR PRICE). */
function portalPolicy(state: DynastyState, share: number): PortalOffer[] {
  const team = state.teams[state.userTid];
  const needs = teamNeeds(state, team);
  let budget = Math.floor(team.nilBudget * share);
  const offers: PortalOffer[] = [];
  for (const e of state.portal) {
    if (team.roster.length + offers.length >= 84) break;
    const p = state.players[e.pid];
    if (!p) continue;
    if ((needs.get(p.g) ?? 0) <= 0 && p.ovr < 80) continue;
    const price = effectiveAsk(e.ask, portalFit(state, team, p.g));
    const amount = Math.min(budget, Math.round((price * 1.02) / 500) * 500);
    if (amount < price) continue;
    offers.push({ pid: e.pid, amount });
    budget -= amount;
    if (budget < 20000) break;
  }
  return offers;
}

const POLICIES: Record<
  string,
  {
    week: (s: DynastyState) => void;
    retention: (s: DynastyState) => number[];
    portal: (s: DynastyState) => PortalOffer[];
  }
> = {
  autopilot: {
    week: () => {},
    retention: () => [],
    portal: () => [],
  },
  recruiter: {
    week: (s) => recruitWeek(s, 12),
    retention: () => [],
    portal: () => [],
  },
  "portal-gm": {
    week: () => {},
    retention: (s) => retentionPolicy(s, "all"),
    portal: (s) => portalPolicy(s, 0.95),
  },
  balanced: {
    week: (s) => recruitWeek(s, 6),
    retention: (s) => retentionPolicy(s, "stars"),
    portal: (s) => portalPolicy(s, 0.6),
  },
};

// ---------------------------------------------------------------------------
// Run + grid
// ---------------------------------------------------------------------------

function runDynasty(
  data: GmData,
  policyName: string,
  tier: string,
  tid: number,
  school: string,
  seed: number,
  difficulty: number,
): RunRow {
  const policy = POLICIES[policyName];
  const state = createDynasty(data, tid, seed, difficulty);
  const uid = state.userTid;
  const perSeason: SeasonRow[] = [];

  for (let y = 0; y < SEASONS; y++) {
    let guard = 0;
    while (state.phase !== "offseason" && guard++ < 40) {
      advance(state);
    }
    // The 8-week offseason (ADR-0027): recruit every week from the stamina
    // pool; answer retention in week 2 and each portal round in weeks 3-7.
    let wk = 0;
    while (state.offStage !== "done" && wk++ < 12) {
      policy.week(state);
      if (state.offStage === "retention") {
        advanceOffseasonWeek(state, { paidPids: policy.retention(state) });
      } else if (state.offStage === "portal") {
        advanceOffseasonWeek(state, { portalOffers: policy.portal(state) });
      } else {
        advanceOffseasonWeek(state);
      }
    }

    const team = state.teams[uid];
    const honors = state.honors[state.honors.length - 1];
    perSeason.push({
      season: state.season,
      wins: team.rec.w,
      losses: team.rec.l,
      rank: honors?.userPollRank ?? null,
      cfp: state.cfp?.field.includes(uid) ?? false,
      natty: state.cfp?.champion === uid,
      ccgWin: state.results.some(
        (r) => r.kind === "ccg" && ((r.home === uid && r.hs > r.as) || (r.away === uid && r.as > r.hs)),
      ),
      classRank: state.offseason?.classRank ?? null,
      prestige: team.prestige,
      portalIn: state.portalLog.filter((l) => l.startsWith("IN")).length,
      portalOut: state.portalLog.filter((l) => l.startsWith("OUT")).length,
      nextBudget: team.nilBudget,
    });
    startNextSeason(state);
  }

  const roster = state.teams[uid].roster;
  const finalRosterOvr = roster.reduce((a, pid) => a + state.players[pid].ovr, 0) / roster.length;
  return { policy: policyName, tier, school, seed, difficulty, perSeason, finalRosterOvr };
}

function buildCells(data: GmData): [string, string, number, string, number, number][] {
  const p4 = data.teams.filter((t) => t.p4);
  const tiers: [string, (typeof p4)[number]][] = [
    ["blue-blood", p4.filter((t) => t.prestige === 6)[0]],
    ["mid", p4.filter((t) => t.prestige === 3)[0]],
    ["bottom", p4.filter((t) => t.prestige === 1)[0]],
  ];
  const cells: [string, string, number, string, number, number][] = [];
  for (const policyName of Object.keys(POLICIES)) {
    for (const [tier, team] of tiers) {
      for (const seed of SEEDS) cells.push([policyName, tier, team.id, team.school, seed, 0]);
    }
  }
  for (const seed of SEEDS) {
    const [tier, team] = tiers[1];
    cells.push(["balanced", tier, team.id, team.school, seed, 2]);
  }
  return cells;
}

function cmdRun(start: number, end: number): void {
  const data = JSON.parse(readFileSync(DATA_PATH, "utf8")) as GmData;
  const cells = buildCells(data);
  const to = Math.min(end || cells.length, cells.length);
  mkdirSync(BENCH_DIR, { recursive: true });
  const t0 = Date.now();
  const runs: RunRow[] = [];
  cells.slice(start, to).forEach(([policy, tier, tid, school, seed, diff], i) => {
    runs.push(runDynasty(data, policy, tier, tid, school, seed, diff));
    if ((i + 1) % 5 === 0) {
      console.log(`  ${start + i + 1}/${to} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  });
  const out = join(BENCH_DIR, `bench-${start}.json`);
  writeFileSync(out, JSON.stringify(runs));
  console.log(`wrote ${out} (${runs.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

function loadRuns(target: string): RunRow[] {
  if (statSync(target).isFile()) return JSON.parse(readFileSync(target, "utf8")) as RunRow[];
  return readdirSync(target)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => JSON.parse(readFileSync(join(target, f), "utf8")) as RunRow[]);
}

function cmdReport(target: string): void {
  const runs = loadRuns(target);
  console.log(`loaded ${runs.length} runs (${runs.reduce((a, r) => a + r.perSeason.length, 0)} seasons)\n`);
  const TIERS = ["blue-blood", "mid", "bottom"];
  const HORIZONS: [string, number, number][] = [
    ["Y1-5", 0, 5], ["Y6-10", 5, 10], ["Y11-20", 10, 20], ["Y21-30", 20, 30],
  ];
  const line = (seasons: SeasonRow[]) => {
    const n = seasons.length;
    const cr = seasons.map((s) => s.classRank).filter((x): x is number => x != null);
    return (
      `w/yr ${r2(mean(seasons.map((s) => s.wins)))} | CFP ${pct(seasons.filter((s) => s.cfp).length / n)} | ` +
      `top10 ${pct(seasons.filter((s) => s.rank != null && s.rank <= 10).length / n)} | ` +
      `natties ${seasons.filter((s) => s.natty).length} | class#${r1(mean(cr))}`
    );
  };
  const slice = (g: RunRow[], a: number, b: number) => g.flatMap((r) => r.perSeason.slice(a, b));

  console.log("=== POLICY × TIER × HORIZON (Normal) ===");
  for (const tier of TIERS) {
    console.log(`\n--- ${tier.toUpperCase()} (${runs.find((r) => r.tier === tier)?.school}) ---`);
    for (const p of Object.keys(POLICIES)) {
      const g = runs.filter((r) => r.policy === p && r.tier === tier && r.difficulty === 0);
      if (!g.length) continue;
      console.log(`${p}:`);
      for (const [label, a, b] of HORIZONS) console.log(`   ${label.padEnd(7)} ${line(slice(g, a, b))}`);
      console.log(
        `   END     prestige ${r2(mean(g.map((r) => r.perSeason[r.perSeason.length - 1].prestige)))} | roster OVR ${r1(mean(g.map((r) => r.finalRosterOvr)))}`,
      );
    }
  }

  console.log("\n=== THE CLIMB (bottom tier): time-to-milestone ===");
  for (const p of Object.keys(POLICIES)) {
    const g = runs.filter((r) => r.policy === p && r.tier === "bottom" && r.difficulty === 0);
    if (!g.length) continue;
    const first = (pred: (s: SeasonRow) => boolean) =>
      g.map((r) => {
        const i = r.perSeason.findIndex(pred);
        return i >= 0 ? i + 1 : null;
      });
    const fmt = (xs: (number | null)[]) => {
      const hit = xs.filter((x): x is number => x !== null);
      return hit.length ? `${hit.length}/${xs.length} runs, median yr ${median(hit)}` : `0/${xs.length} runs`;
    };
    console.log(
      `${p.padEnd(10)} 9-wins: ${fmt(first((s) => s.wins >= 9))} | first CFP: ${fmt(first((s) => s.cfp))} | first natty: ${fmt(first((s) => s.natty))}`,
    );
  }

  console.log("\n=== DIFFICULTY ARM (balanced @ mid) ===");
  for (const d of [0, 2]) {
    const g = runs.filter((r) => r.policy === "balanced" && r.tier === "mid" && r.difficulty === d);
    if (!g.length) continue;
    console.log(`${d === 0 ? "Normal" : "Brutal"}:`);
    for (const [label, a, b] of HORIZONS) console.log(`   ${label.padEnd(7)} ${line(slice(g, a, b))}`);
  }

  console.log("\n=== LEAGUE SANITY (autopilot pool) ===");
  const auto = runs.filter((r) => r.policy === "autopilot" && r.difficulty === 0).flatMap((r) => r.perSeason);
  const hist = auto.reduce<Record<number, number>>((h, s) => ((h[s.wins] = (h[s.wins] ?? 0) + 1), h), {});
  console.log(
    `team-seasons ${auto.length} · win histogram: ` +
      Object.entries(hist).sort((a, b) => Number(a[0]) - Number(b[0])).map(([w, c]) => `${w}:${c}`).join(" "),
  );
  console.log(`unmanaged portal per season: +${r2(mean(auto.map((s) => s.portalIn)))} / -${r2(mean(auto.map((s) => s.portalOut)))}`);
}

// ---------------------------------------------------------------------------

const [, , cmd, a, b] = process.argv;
if (cmd === "run") {
  cmdRun(Number(a ?? 0), Number(b ?? 0));
} else if (cmd === "report") {
  cmdReport(a ?? BENCH_DIR);
} else {
  console.log("usage: bench-gm.ts run [start end] | report [dir-or-file]");
}
