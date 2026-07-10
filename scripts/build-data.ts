// Build-time data bake for The 16-0 Draft (design doc §4.5, ADR-0010/0011).
//
// Sources, in order of authority:
//   1. Supabase serving layer (cfb_player_ratings / cfb_player_season_stats /
//      cfb_teams / cfb_rosters) — the REAL modern ("2020s") era. Read-only via
//      the anon key (RLS-protected, safe to embed).
//   2. scripts/content/*.json — hand/LLM-authored historical eras + coaches,
//      OVR-calibrated against the real modern scale (§4.5 rubric).
//   3. ../cfb.db (local warehouse) — bake-time fallback for team colors /
//      jerseys until the serving layer carries them (push --full --tables
//      teams,rosters after supabase/migrations/0004).
//
// Output: game/public/data.json — the static file the game loads on boot.
// The running game NEVER touches Supabase (design pillar #4).
//
// Run: npm run build:data   (Node >= 24, zero deps)
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
import type {
  Coach,
  CoachTier,
  Decade,
  GameData,
  GamePosition,
  Player,
  StatBlock,
  Team,
} from "../src/data/types.ts";
import { DECADES } from "../src/data/types.ts";
import {
  OVR_FLOOR,
  TOP_N,
  coachId,
  displayShort,
  mapDbPosition,
  pearson,
  playerId,
  statBlockFor,
  type StatPivot,
} from "./lib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(HERE, "content");
const OUT_PATH = join(HERE, "..", "public", "data.json");
const LOCAL_DB = join(HERE, "..", "..", "cfb.db");
const MODERN_DECADE: Decade = "2020s";
const MODERN_SEASONS = [2024, 2025];

// Anon (publishable) key — safe to embed by design; RLS allows read-only.
const SUPABASE_URL =
  process.env.CFB_SUPABASE_URL ?? "https://owwjabhinvwoaarjbmgm.supabase.co";
const SUPABASE_ANON_KEY =
  process.env.CFB_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im93d2phYmhpbnZ3b2FhcmpibWdtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODMwMjcxNjgsImV4cCI6MjA5ODYwMzE2OH0.sIQ5UlK9aOl60CUL7cqWH9NHiaDxgJMNIOkpo44tme8";

// ---------------------------------------------------------------------------
// Content files (authored historical eras + coaches + program config)
// ---------------------------------------------------------------------------
interface ContentPlayer {
  name: string;
  jersey_number: string;
  primary_position: GamePosition;
  secondary_position: GamePosition | null;
  decade: Decade;
  hidden_ovr: number;
  stats: StatBlock;
}
interface ContentCoach {
  name: string;
  decade: Decade;
  coach_tier: CoachTier;
  stats: StatBlock;
}
interface ProgramContent {
  school_id: string;
  cfbd_name: string;
  name: string;
  mascot: string;
  powerhouse_eras: Decade[];
  conferences: Partial<Record<Decade, string>>;
  coaches: ContentCoach[];
  players: ContentPlayer[];
}

function loadContent(): ProgramContent[] {
  return readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(CONTENT_DIR, f), "utf8")));
}

// ---------------------------------------------------------------------------
// Supabase REST (PostgREST) paging reader
// ---------------------------------------------------------------------------
async function rest(pathAndQuery: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const url = `${SUPABASE_URL}/rest/v1/${pathAndQuery}&limit=${page}&offset=${offset}`;
    const resp = await fetch(url, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    });
    if (!resp.ok) {
      throw new Error(
        `Supabase GET failed HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`,
      );
    }
    const rows = (await resp.json()) as Record<string, unknown>[];
    out.push(...rows);
    if (rows.length < page) return out;
  }
}

const quoteList = (vals: string[]) =>
  `(${vals.map((v) => `"${v}"`).join(",")})`;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

// ---------------------------------------------------------------------------
// Local-warehouse fallback (colors/jerseys until the push lands)
// ---------------------------------------------------------------------------
interface TeamBranding {
  conference: string | null;
  mascot: string | null;
  color: string | null;
  alternate_color: string | null;
}

function localBranding(cfbdNames: string[]): Map<string, TeamBranding> {
  const map = new Map<string, TeamBranding>();
  if (!existsSync(LOCAL_DB)) return map;
  // Lazy import so the script still runs on a machine without the warehouse.
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(LOCAL_DB, { readOnly: true });
  const rows = db
    .prepare(
      `SELECT school, conference, json_extract(data,'$.mascot') AS mascot,
              json_extract(data,'$.color') AS color,
              json_extract(data,'$.alternateColor') AS alternate_color
       FROM teams WHERE season=2025 AND school IN (${cfbdNames.map(() => "?").join(",")})`,
    )
    .all(...cfbdNames) as unknown as ({ school: string } & TeamBranding)[];
  db.close();
  for (const r of rows) map.set(r.school, r);
  return map;
}

function localJerseys(athleteIds: string[]): Map<string, string> {
  const map = new Map<string, string>();
  if (!existsSync(LOCAL_DB) || athleteIds.length === 0) return map;
  const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
  const db = new DatabaseSync(LOCAL_DB, { readOnly: true });
  for (const ids of chunk(athleteIds, 500)) {
    const rows = db
      .prepare(
        `SELECT athlete_id, CAST(json_extract(data,'$.jersey') AS TEXT) AS jersey, season
         FROM rosters WHERE athlete_id IN (${ids.map(() => "?").join(",")})
           AND json_extract(data,'$.jersey') IS NOT NULL
         ORDER BY season ASC`,
      )
      .all(...ids) as unknown as { athlete_id: string; jersey: string }[];
    for (const r of rows) map.set(r.athlete_id, r.jersey); // later seasons win
  }
  db.close();
  return map;
}

// ---------------------------------------------------------------------------
// Modern slice from Supabase
// ---------------------------------------------------------------------------
interface RatingRow {
  athlete_id: string;
  player: string;
  team: string;
  position: string;
  pos_group: string;
  overall: number;
  season: number;
}

async function fetchModernPlayers(programs: ProgramContent[]): Promise<{
  players: Player[];
  conferences: Map<string, string>;
  branding: Map<string, TeamBranding>;
}> {
  const names = programs.map((p) => p.cfbd_name);
  const byName = new Map(programs.map((p) => [p.cfbd_name, p]));

  // 1. Team branding / conference (serving layer first, warehouse fallback).
  const teamRows = (await rest(
    `cfb_teams?select=school,conference,mascot,color,alternate_color&season=eq.2025&school=in.${quoteList(names)}`,
  )) as unknown as ({ school: string } & TeamBranding)[];
  const branding = new Map(teamRows.map((r) => [r.school, r]));
  const missingBranding = names.filter((n) => !branding.get(n)?.color);
  if (missingBranding.length > 0) {
    const local = localBranding(missingBranding);
    if (local.size > 0) {
      console.warn(
        `  note: colors for ${local.size} team(s) came from the local warehouse — ` +
          `run \`node --no-warnings src/cli.ts push --full --tables teams,rosters\` ` +
          `to serve them from Supabase.`,
      );
      for (const [school, b] of local) {
        const existing = branding.get(school);
        branding.set(school, {
          conference: existing?.conference ?? b.conference,
          mascot: existing?.mascot ?? b.mascot,
          color: existing?.color ?? b.color,
          alternate_color: existing?.alternate_color ?? b.alternate_color,
        });
      }
    }
  }
  const conferences = new Map<string, string>();
  for (const [school, b] of branding) {
    if (b.conference) conferences.set(school, b.conference);
  }

  // 2. Ratings (real seasons only), floor applied server-side.
  const ratingRows = (await rest(
    `cfb_player_ratings?select=athlete_id,player,team,position,pos_group,overall,season` +
      `&team=in.${quoteList(names)}&season=in.(${MODERN_SEASONS.join(",")})` +
      `&projected=is.false&is_current=is.true&overall=gte.${OVR_FLOOR}` +
      `&pos_group=in.(QB,RB,WR,DL,LB,DB)&order=nkey.asc`,
  )) as unknown as RatingRow[];

  // Best season per athlete (overall desc, then later season).
  const best = new Map<string, RatingRow>();
  for (const r of ratingRows) {
    if (!r.athlete_id || !r.player) continue;
    const prev = best.get(r.athlete_id);
    if (!prev || r.overall > prev.overall || (r.overall === prev.overall && r.season > prev.season)) {
      best.set(r.athlete_id, r);
    }
  }

  // Top-N per {team, game position}.
  type Mapped = RatingRow & { primary: GamePosition; secondary: GamePosition | null };
  const byTeamPos = new Map<string, Mapped[]>();
  for (const r of best.values()) {
    const mapped = mapDbPosition(r.pos_group, r.position);
    if (!mapped) continue;
    const key = `${r.team}|${mapped.primary}`;
    const list = byTeamPos.get(key) ?? [];
    list.push({ ...r, ...mapped });
    byTeamPos.set(key, list);
  }
  const kept: Mapped[] = [];
  for (const [key, list] of byTeamPos) {
    const pos = key.split("|")[1] as GamePosition;
    list.sort((a, b) => b.overall - a.overall || a.athlete_id.localeCompare(b.athlete_id));
    kept.push(...list.slice(0, TOP_N[pos]));
  }

  // 3. Stat lines for kept athletes (both seasons; chosen season picked here).
  const ids = kept.map((k) => k.athlete_id);
  const pivots = new Map<string, StatPivot>(); // athlete|season -> pivot
  for (const idChunk of chunk(ids, 120)) {
    const statRows = (await rest(
      `cfb_player_season_stats?select=athlete_id,season,category,stat_type,stat` +
        `&athlete_id=in.${quoteList(idChunk)}&season=in.(${MODERN_SEASONS.join(",")})` +
        `&category=in.(passing,rushing,receiving,defensive,interceptions)&is_current=is.true&order=nkey.asc`,
    )) as unknown as { athlete_id: string; season: number; category: string; stat_type: string; stat: string }[];
    for (const s of statRows) {
      const key = `${s.athlete_id}|${s.season}`;
      const pivot = pivots.get(key) ?? {};
      (pivot[s.category] ??= {})[s.stat_type] = Number(s.stat) || 0;
      pivots.set(key, pivot);
    }
  }

  // 4. Jerseys (serving layer; warehouse fallback if the column isn't live yet).
  const jerseys = new Map<string, string>();
  let jerseyColumnLive = true;
  for (const idChunk of chunk(ids, 200)) {
    let rows: { athlete_id: string; season: number; jersey: string | null }[];
    try {
      rows = (await rest(
        `cfb_rosters?select=athlete_id,season,jersey&athlete_id=in.${quoteList(idChunk)}&jersey=not.is.null&order=season.asc`,
      )) as unknown as typeof rows;
    } catch {
      jerseyColumnLive = false;
      break;
    }
    for (const r of rows) if (r.jersey != null) jerseys.set(r.athlete_id, String(r.jersey));
  }
  if (!jerseyColumnLive || jerseys.size === 0) {
    const local = localJerseys(ids);
    for (const [id, j] of local) if (!jerseys.has(id)) jerseys.set(id, j);
    if (local.size > 0) {
      console.warn(
        "  note: jerseys came from the local warehouse — push teams,rosters to serve them.",
      );
    }
  }

  // 5. Assemble Player objects.
  const players: Player[] = [];
  for (const k of kept) {
    const program = byName.get(k.team)!;
    const pivot = pivots.get(`${k.athlete_id}|${k.season}`) ?? {};
    players.push({
      player_id: playerId(k.primary, k.player, program.school_id, MODERN_DECADE),
      name: k.player,
      display_short: displayShort(k.player),
      jersey_number: jerseys.get(k.athlete_id) ?? "",
      primary_position: k.primary,
      secondary_position: k.secondary,
      school: program.name,
      school_id: program.school_id,
      decade: MODERN_DECADE,
      historical_conference:
        program.conferences[MODERN_DECADE] ?? conferences.get(k.team) ?? "FBS",
      is_historic_powerhouse: program.powerhouse_eras.includes(MODERN_DECADE),
      hidden_ovr: k.overall,
      stats: statBlockFor(k.primary, pivot),
    });
  }
  return { players, conferences, branding };
}

// ---------------------------------------------------------------------------
// Assemble + validate + write
// ---------------------------------------------------------------------------
function contentPlayers(programs: ProgramContent[]): Player[] {
  return programs.flatMap((program) =>
    program.players.map((p) => ({
      player_id: playerId(p.primary_position, p.name, program.school_id, p.decade),
      name: p.name,
      display_short: displayShort(p.name),
      jersey_number: p.jersey_number,
      primary_position: p.primary_position,
      secondary_position: p.secondary_position ?? null,
      school: program.name,
      school_id: program.school_id,
      decade: p.decade,
      historical_conference: program.conferences[p.decade] ?? "FBS",
      is_historic_powerhouse: program.powerhouse_eras.includes(p.decade),
      hidden_ovr: p.hidden_ovr,
      stats: p.stats,
    })),
  );
}

function contentCoaches(
  programs: ProgramContent[],
  modernConfs: Map<string, string>,
): Coach[] {
  return programs.flatMap((program) =>
    program.coaches.map((c) => ({
      coach_id: coachId(c.name, program.school_id, c.decade),
      name: c.name,
      display_short: displayShort(c.name),
      school: program.name,
      school_id: program.school_id,
      decade: c.decade,
      historical_conference:
        program.conferences[c.decade] ??
        (c.decade === MODERN_DECADE ? modernConfs.get(program.cfbd_name) ?? "FBS" : "FBS"),
      coach_tier: c.coach_tier,
      stats: c.stats,
    })),
  );
}

function validate(data: GameData): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const p of data.players) {
    if (seen.has(p.player_id)) problems.push(`duplicate player_id ${p.player_id}`);
    seen.add(p.player_id);
    if (p.hidden_ovr < 0 || p.hidden_ovr > 100) problems.push(`${p.player_id}: ovr ${p.hidden_ovr}`);
    if (!DECADES.includes(p.decade)) problems.push(`${p.player_id}: bad decade ${p.decade}`);
  }
  for (const c of data.coaches) {
    if (seen.has(c.coach_id)) problems.push(`duplicate coach_id ${c.coach_id}`);
    seen.add(c.coach_id);
  }
  for (const t of data.teams) {
    if (!/^#[0-9a-fA-F]{6}$/.test(t.mainHex)) problems.push(`${t.school_id}: bad mainHex ${t.mainHex}`);
    if (t.eras_present.length === 0) problems.push(`${t.school_id}: no eras`);
  }
  // §12 correlation invariant: hidden_ovr must move with the headline stat.
  const byPos = new Map<GamePosition, { ovr: number[]; s1: number[] }>();
  for (const p of data.players) {
    const acc = byPos.get(p.primary_position) ?? { ovr: [], s1: [] };
    acc.ovr.push(p.hidden_ovr);
    acc.s1.push(p.stats.stat_1);
    byPos.set(p.primary_position, acc);
  }
  for (const [pos, { ovr, s1 }] of byPos) {
    const r = pearson(ovr, s1);
    if (r < 0.15) {
      console.warn(
        `  WARN §12: ${pos} hidden_ovr↔stat_1 correlation weak (r=${r.toFixed(2)}) — review authored stats.`,
      );
    }
  }
  return problems;
}

async function main(): Promise<void> {
  console.log("Baking data.json …");
  const programs = loadContent();
  console.log(`  programs: ${programs.length}`);

  const { players: modern, conferences, branding } = await fetchModernPlayers(programs);
  console.log(`  modern (real) players: ${modern.length}`);

  const historical = contentPlayers(programs);
  console.log(`  authored historical players: ${historical.length}`);

  const players = [...modern, ...historical];
  const coaches = contentCoaches(programs, conferences);

  const teams: Team[] = programs.map((program) => {
    const b = branding.get(program.cfbd_name);
    const eras = DECADES.filter((d) =>
      players.some((p) => p.school_id === program.school_id && p.decade === d),
    );
    return {
      school_id: program.school_id,
      name: program.name,
      mascot: program.mascot || b?.mascot || "",
      mainHex: b?.color ?? "#333333",
      accentHex: b?.alternate_color ?? "#ffffff",
      eras_present: eras,
      is_historic_powerhouse: program.powerhouse_eras.length > 0,
      powerhouse_eras: program.powerhouse_eras,
    };
  });

  const data: GameData = {
    version: 1,
    generated_at: new Date().toISOString(),
    teams,
    players,
    coaches,
  };

  const problems = validate(data);
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ERROR: ${p}`);
    process.exit(1);
  }

  // Cell census — how deep each {team, era} spin target is.
  const cells = new Map<string, number>();
  for (const p of players) {
    const key = `${p.school_id} ${p.decade}`;
    cells.set(key, (cells.get(key) ?? 0) + 1);
  }
  console.log(`  cells: ${cells.size} (${players.length} players, ${coaches.length} coaches)`);
  for (const [cell, n] of [...cells].sort()) console.log(`    ${cell.padEnd(22)} ${n}`);

  writeFileSync(OUT_PATH, JSON.stringify(data));
  console.log(`  wrote ${OUT_PATH} (${(JSON.stringify(data).length / 1024).toFixed(0)} KB)`);
}

await main();
