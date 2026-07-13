// Bake public/gm-data.json for the CFB-GM dynasty cabinet (ADR-0023): the real
// 2026 preseason universe — 68 P4 programs with projected rosters/ratings, G5 +
// FCS shell opponents with Elo strengths from real 2025 results, and the real
// 2026 regular-season schedule. Supabase-only via the public anon key; no
// warehouse dependency (works from a clean clone).
//
// Run: npm run build:gm
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GmData, GmPlayerSeed, GmSchedGame, GmTeam, PosGroup } from "../src/gm/engine/types.ts";
import { ELO_BASE, ELO_FCS, eloDelta, eloPreseason } from "../src/gm/engine/elo.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(HERE, "..", "public", "gm-data.json");
const SEASON = 2026;
const P4_CONFS = new Set(["SEC", "Big Ten", "Big 12", "ACC"]);
const P4_INDEPENDENTS = new Set(["Notre Dame"]);
/** Max real players baked per P4 team (dynasty creation trims to 85). */
const ROSTER_CAP = 92;
/** Positional minimums honored before best-available fill. */
const POS_MINIMUMS: [PosGroup, number][] = [
  ["QB", 3], ["RB", 4], ["WR", 6], ["TE", 3], ["OL", 10],
  ["DL", 8], ["LB", 6], ["CB", 5], ["S", 4], ["K", 1], ["P", 1],
];

const SUPABASE_URL =
  process.env.CFB_SUPABASE_URL ?? "https://owwjabhinvwoaarjbmgm.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.CFB_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93d2phYmhpbnZ3b2FhcmpibWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMjcxNjgsImV4cCI6MjA5ODYwMzE2OH0.sIQ5UlK9aOl60CUL7cqWH9NHiaDxgJMNIOkpo44tme8";

async function rest(pathAndQuery: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}&limit=${page}&offset=${offset}`;
    let rows: Record<string, unknown>[] | null = null;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        const resp = await fetch(url, {
          headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
          signal: AbortSignal.timeout(60_000),
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
        rows = (await resp.json()) as Record<string, unknown>[];
        break;
      } catch (err) {
        if (attempt === 3) throw err;
        await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
    out.push(...rows!);
    if (rows!.length < page) return out;
  }
}

/** Granular CFBD position → engine group. Returns null for unusable (LS). */
function toGroup(position: string, posGroup: string, athIndex: number): PosGroup | null {
  const p = (position || "").toUpperCase().trim();
  const MAP: Record<string, PosGroup> = {
    QB: "QB", RB: "RB", FB: "RB", HB: "RB", TB: "RB", WR: "WR", TE: "TE",
    OL: "OL", OT: "OL", OG: "OL", G: "OL", C: "OL", IOL: "OL",
    DL: "DL", DE: "DL", DT: "DL", NT: "DL", EDGE: "DL",
    LB: "LB", ILB: "LB", OLB: "LB", MLB: "LB",
    CB: "CB", NB: "CB", DB: "CB", S: "S", FS: "S", SS: "S",
    PK: "K", K: "K", P: "P",
  };
  if (p === "LS") return null;
  if (p === "ATH" || p === "") {
    const g = MAP[(posGroup || "").toUpperCase()] ?? (["WR", "CB", "LB"] as PosGroup[])[athIndex % 3];
    return g;
  }
  return MAP[p] ?? MAP[(posGroup || "").toUpperCase()] ?? null;
}

interface TeamRow { school: string; conference: string | null; mascot: string | null; color: string | null; alternate_color: string | null }
interface RatingRow { athlete_id: string; player: string; team: string; position: string; pos_group: string; overall: number }
interface RosterRow { athlete_id: string; class_year: number | null }
interface GameRow { season: number; week: number; home_team: string; away_team: string; home_points: number | null; away_points: number | null }

async function main(): Promise<void> {
  console.log("Baking gm-data.json …");

  const teamRows = (await rest(
    `cfb_teams?select=school,conference,mascot,color,alternate_color&season=eq.${SEASON}&is_current=is.true`,
  )) as unknown as TeamRow[];

  const ratingRows = (await rest(
    `cfb_player_ratings?select=athlete_id,player,team,position,pos_group,overall&season=eq.${SEASON}&is_current=is.true`,
  )) as unknown as RatingRow[];

  const rosterRows = (await rest(
    `cfb_rosters?select=athlete_id,class_year&season=eq.${SEASON - 1}&is_current=is.true`,
  )) as unknown as RosterRow[];

  const sched26 = (await rest(
    `cfb_games?select=season,week,home_team,away_team,home_points,away_points&season=eq.${SEASON}&season_type=eq.regular`,
  )) as unknown as GameRow[];

  const games25 = (await rest(
    `cfb_games?select=season,week,home_team,away_team,home_points,away_points&season=eq.${SEASON - 1}&completed=is.true&order=week.asc`,
  )) as unknown as GameRow[];

  const histGames = (await rest(
    `cfb_games?select=home_team,away_team&season=gte.2010&season=lte.${SEASON - 1}&completed=is.true`,
  )) as unknown as { home_team: string; away_team: string }[];

  // --- Elo from real 2025 results (FCS opponents fixed, never updated) ------
  const elo = new Map<string, number>(teamRows.map((t) => [t.school, ELO_BASE]));
  for (const g of games25) {
    if (g.home_points === null || g.away_points === null || g.home_points === g.away_points) continue;
    const homeWon = g.home_points > g.away_points;
    const [wTeam, lTeam] = homeWon ? [g.home_team, g.away_team] : [g.away_team, g.home_team];
    const wElo = elo.get(wTeam) ?? ELO_FCS;
    const lElo = elo.get(lTeam) ?? ELO_FCS;
    const delta = eloDelta(wElo, lElo, Math.abs(g.home_points - g.away_points), homeWon);
    if (elo.has(wTeam)) elo.set(wTeam, wElo + delta);
    if (elo.has(lTeam)) elo.set(lTeam, lElo - delta);
  }

  // --- Teams: P4 full-sim + FBS shells, then FCS shells found in schedule ---
  const isP4 = (t: TeamRow) =>
    P4_CONFS.has(t.conference ?? "") || P4_INDEPENDENTS.has(t.school);
  const teams: GmTeam[] = [];
  const idOf = new Map<string, number>();
  const sorted = [...teamRows].sort(
    (a, b) => Number(isP4(b)) - Number(isP4(a)) || a.school.localeCompare(b.school),
  );
  for (const t of sorted) {
    idOf.set(t.school, teams.length);
    teams.push({
      id: teams.length,
      school: t.school,
      mascot: t.mascot,
      conference: t.conference ?? "Independent",
      p4: isP4(t),
      color: t.color,
      altColor: t.alternate_color,
      elo: Math.round(eloPreseason(elo.get(t.school) ?? ELO_BASE)),
      prestige: 0,
    });
  }

  // Prestige tiers from preseason Elo rank among the P4.
  const p4Sorted = teams.filter((t) => t.p4).sort((a, b) => b.elo - a.elo);
  p4Sorted.forEach((t, i) => {
    t.prestige = i < 5 ? 6 : i < 16 ? 5 : i < 32 ? 4 : i < 48 ? 3 : i < 60 ? 2 : 1;
  });

  // Real rivalries: most-played P4 matchups since 2010 (mutualized top pairs).
  const pairCount = new Map<string, number>();
  for (const g of histGames) {
    const a = idOf.get(g.home_team);
    const b = idOf.get(g.away_team);
    if (a === undefined || b === undefined || !teams[a].p4 || !teams[b].p4) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
  }
  const topPartner = new Map<number, [number, number][]>();
  for (const [key, n] of pairCount) {
    if (n < 8) continue; // rivalry needs history
    const [a, b] = key.split("|").map(Number);
    topPartner.set(a, [...(topPartner.get(a) ?? []), [b, n]]);
    topPartner.set(b, [...(topPartner.get(b) ?? []), [a, n]]);
  }
  const rivals = new Map<number, Set<number>>();
  for (const [tid, partners] of topPartner) {
    partners.sort((x, y) => y[1] - x[1]);
    for (const [other] of partners.slice(0, 2)) {
      if (!rivals.has(tid)) rivals.set(tid, new Set());
      if (!rivals.has(other)) rivals.set(other, new Set());
      rivals.get(tid)!.add(other);
      rivals.get(other)!.add(tid);
    }
  }
  for (const t of teams) {
    if (t.p4) t.rivals = [...(rivals.get(t.id) ?? [])].sort((a, b) => a - b);
  }

  // --- Schedule: real 2026 regular season, P4-involved games only -----------
  const schedule: GmSchedGame[] = [];
  for (const g of sched26) {
    const homeP4 = idOf.has(g.home_team) && teams[idOf.get(g.home_team)!].p4;
    const awayP4 = idOf.has(g.away_team) && teams[idOf.get(g.away_team)!].p4;
    if (!homeP4 && !awayP4) continue;
    for (const school of [g.home_team, g.away_team]) {
      if (!idOf.has(school)) {
        idOf.set(school, teams.length);
        teams.push({
          id: teams.length, school, mascot: null, conference: "FCS", p4: false,
          color: null, altColor: null, elo: ELO_FCS, prestige: 0,
        });
      }
    }
    schedule.push({ w: g.week, h: idOf.get(g.home_team)!, a: idOf.get(g.away_team)! });
  }
  schedule.sort((x, y) => x.w - y.w || x.h - y.h);

  // --- P4 rosters from projected ratings + 2025 class years -----------------
  const clsOf = new Map<string, number>();
  for (const r of rosterRows) {
    const c = r.class_year ?? 0;
    if (c >= 1 && c <= 4) clsOf.set(r.athlete_id, Math.min(4, c + 1));
  }
  const byTeam = new Map<number, GmPlayerSeed[]>();
  let athIndex = 0;
  for (const r of ratingRows) {
    const tid = idOf.get(r.team);
    if (tid === undefined || !teams[tid].p4) continue;
    const g = toGroup(r.position, r.pos_group, athIndex++);
    if (!g) continue;
    const seed: GmPlayerSeed = {
      t: tid,
      n: r.player,
      p: (r.position || g).toUpperCase(),
      g,
      o: Math.max(40, Math.min(99, r.overall)),
      c: clsOf.get(r.athlete_id) ?? 1,
    };
    byTeam.set(tid, [...(byTeam.get(tid) ?? []), seed]);
  }

  const players: GmPlayerSeed[] = [];
  for (const [tid, all] of [...byTeam].sort((a, b) => a[0] - b[0])) {
    all.sort((a, b) => b.o - a.o || a.n.localeCompare(b.n));
    const kept = new Set<GmPlayerSeed>();
    for (const [group, min] of POS_MINIMUMS) {
      for (const p of all.filter((x) => x.g === group).slice(0, min)) kept.add(p);
    }
    for (const p of all) {
      if (kept.size >= ROSTER_CAP) break;
      kept.add(p);
    }
    const roster = [...kept].sort((a, b) => b.o - a.o || a.n.localeCompare(b.n));
    players.push(...roster);
    if (roster.length < 60) {
      console.warn(`  thin roster: ${teams[tid].school} has only ${roster.length} rated players`);
    }
  }

  const data: GmData = { version: 1, season: SEASON, teams, players, schedule };
  writeFileSync(OUT_PATH, JSON.stringify(data));

  const p4Count = teams.filter((t) => t.p4).length;
  const kb = (JSON.stringify(data).length / 1024).toFixed(0);
  console.log(`  teams: ${teams.length} (${p4Count} P4 full-sim, ${teams.length - p4Count} shells)`);
  console.log(`  players: ${players.length} across ${byTeam.size} P4 rosters`);
  console.log(`  schedule: ${schedule.length} P4-involved games, weeks ${schedule[0]?.w}–${schedule[schedule.length - 1]?.w}`);
  console.log(`  top-5 preseason Elo: ${p4Sorted.slice(0, 5).map((t) => `${t.school} ${t.elo}`).join(", ")}`);
  console.log(`  wrote ${OUT_PATH} (${kb} KB)`);
}

await main();
