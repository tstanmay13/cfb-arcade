// Build-time data bake for The 16-0 Draft (design doc §4.5, ADR-0010/0011).
//
// Sources, in order of authority:
//   1. The local warehouse (the platform repo's cfb.db, read directly via
//      node:sqlite — ADR-0025) — the REAL modern ("2020s") era: the same
//      is_current slice of player_ratings / player_season_stats / teams /
//      rosters that the old Supabase serving layer carried.
//   2. scripts/content/*.json — hand/LLM-authored historical eras + coaches,
//      OVR-calibrated against the real modern scale (§4.5 rubric).
//
// Owner-only by design (ADR-0025): baking needs the warehouse next to this
// repo (restore it with `cfb restore` in the platform repo, or point
// CFB_DB_PATH at a cfb.db). Collaborators build against the committed
// public/data.json — Supabase is runtime stats only (ADR-0019) and no longer
// serves game data to this bake. Anything missing from the warehouse is an
// ingest/ratings problem, warned loudly — never silently backfilled.
//
// Output: public/data.json — the static file the game loads on boot.
// The running game NEVER touches a database for game data (design pillar #4).
//
// Run: npm run build:data   (Node >= 24, zero deps)
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
  calibrationMap,
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

// Seasons with clean real player data (stats + positions + rosters). CFBD has
// a hard cliff below 2010: 2006-09 stats are thin and rosters carry no
// positions; 2005 and earlier is scores-only. So 2010s + 2020s are REAL eras
// and everything older stays authored (§4.5 / ADR-0014).
const FIRST_REAL_SEASON = 2010;
const LAST_REAL_SEASON = 2025;
const MODERN_SEASONS = Array.from(
  { length: LAST_REAL_SEASON - FIRST_REAL_SEASON + 1 },
  (_, i) => FIRST_REAL_SEASON + i,
);
const decadeOf = (season: number): Decade => (season >= 2020 ? "2020s" : "2010s");

// Eras removed from the shipped game (authored-only, no real data behind
// them — user decision: real data only). Content files keep their rows as
// dormant source — deleting a decade from this set brings it back at the
// next bake.
const EXCLUDED_DECADES = new Set<Decade>(["1980s", "1990s", "2000s"]);

// The warehouse lives in the sibling platform repo (same env var name the
// platform itself uses, src/config.ts). Read-only: the bake never writes it.
const CFB_DB_PATH =
  process.env.CFB_DB_PATH ?? join(HERE, "..", "..", "cfb", "cfb.db");

function openWarehouse(): DatabaseSync {
  if (!existsSync(CFB_DB_PATH)) {
    throw new Error(
      `warehouse not found at ${CFB_DB_PATH} — restore it in the platform repo ` +
        "(`node --no-warnings src/cli.ts restore`, needs the R2_* creds) or set " +
        "CFB_DB_PATH to an existing cfb.db.",
    );
  }
  return new DatabaseSync(CFB_DB_PATH, { readOnly: true });
}

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

// One "?" per value — every user-adjacent string (team names, athlete ids) is
// bound, never spliced into the SQL.
const placeholders = (n: number) =>
  `(${Array.from({ length: n }, () => "?").join(",")})`;

// ---------------------------------------------------------------------------
// Modern slice from the warehouse
// ---------------------------------------------------------------------------
interface TeamBranding {
  conference: string | null;
  mascot: string | null;
  color: string | null;
  alternate_color: string | null;
}

interface RatingRow {
  athlete_id: string;
  player: string;
  team: string;
  position: string;
  pos_group: string;
  overall: number;
  season: number;
}

interface StatRow {
  athlete_id: string;
  season: number;
  category: string;
  stat_type: string;
  stat: string;
}

function fetchModernPlayers(programs: ProgramContent[]): {
  players: Player[];
  conferences: Map<string, string>;
  branding: Map<string, TeamBranding>;
} {
  const names = programs.map((p) => p.cfbd_name);
  const byName = new Map(programs.map((p) => [p.cfbd_name, p]));
  const db = openWarehouse();

  // 1. Team branding / conference — the same promoted columns push.ts served.
  const teamRows = db
    .prepare(
      `SELECT school, conference, mascot, color, alternate_color
         FROM teams
        WHERE season = 2025 AND school IN ${placeholders(names.length)}`,
    )
    .all(...names) as unknown as ({ school: string } & TeamBranding)[];
  const branding = new Map(teamRows.map((r) => [r.school, r]));
  const missingBranding = names.filter((n) => !branding.get(n)?.color);
  if (missingBranding.length > 0) {
    console.warn(
      `  WARN: no 2025 colors for ${missingBranding.join(", ")} — falling back to ` +
        `defaults. Fix from the platform side: \`cfb ingest --year 2025 --datasets teams\`.`,
    );
  }
  const conferences = new Map<string, string>();
  for (const [school, b] of branding) {
    if (b.conference) conferences.set(school, b.conference);
  }

  // 2. Ratings for every real season, floor applied in the query. Same slice
  //    the serving layer carried: current, non-projected rows only.
  const ratingRows = db
    .prepare(
      `SELECT athlete_id, player, team, position, pos_group, overall, season
         FROM player_ratings
        WHERE team IN ${placeholders(names.length)}
          AND season IN (${MODERN_SEASONS.join(",")})
          AND projected = 0 AND is_current = 1
          AND overall >= ${OVR_FLOOR}
          AND pos_group IN ('QB','RB','WR','DL','LB','DB')
        ORDER BY nkey`,
    )
    .all(...names) as unknown as RatingRow[];
  const missingSeasons = MODERN_SEASONS.filter(
    (s) => !ratingRows.some((r) => r.season === s),
  );
  if (missingSeasons.length > 0) {
    console.warn(
      `  note: no ratings for seasons ${missingSeasons.join(",")} — those years ` +
        `stay out of the pool until the platform ingests + rates them.`,
    );
  }

  // Best season per athlete across ALL real seasons (overall desc, then later
  // season) — the athlete lands in the decade of that best season, so a human
  // never appears in two decade cells.
  const best = new Map<string, RatingRow>();
  for (const r of ratingRows) {
    if (!r.athlete_id || !r.player) continue;
    const prev = best.get(r.athlete_id);
    if (!prev || r.overall > prev.overall || (r.overall === prev.overall && r.season > prev.season)) {
      best.set(r.athlete_id, r);
    }
  }

  // Top-N per {team, decade, game position}.
  type Mapped = RatingRow & { primary: GamePosition; secondary: GamePosition | null };
  const byCellPos = new Map<string, Mapped[]>();
  for (const r of best.values()) {
    const mapped = mapDbPosition(r.pos_group, r.position);
    if (!mapped) continue;
    const key = `${r.team}|${decadeOf(r.season)}|${mapped.primary}`;
    const list = byCellPos.get(key) ?? [];
    list.push({ ...r, ...mapped });
    byCellPos.set(key, list);
  }
  const kept: Mapped[] = [];
  for (const [key, list] of byCellPos) {
    const pos = key.split("|")[2] as GamePosition;
    list.sort((a, b) => b.overall - a.overall || a.athlete_id.localeCompare(b.athlete_id));
    kept.push(...list.slice(0, TOP_N[pos]));
  }

  // 3. Stat lines for each kept athlete's chosen season. One bound query —
  //    SQLite takes thousands of parameters, no URL-length chunking needed.
  const ids = kept.map((k) => k.athlete_id);
  const pivots = new Map<string, StatPivot>(); // athlete|season -> pivot
  const statRows =
    ids.length === 0
      ? []
      : (db
          .prepare(
            `SELECT athlete_id, season, category, stat_type, stat
               FROM player_season_stats
              WHERE athlete_id IN ${placeholders(ids.length)}
                AND season IN (${MODERN_SEASONS.join(",")})
                AND category IN ('passing','rushing','receiving','defensive','interceptions')
                AND is_current = 1
              ORDER BY nkey`,
          )
          .all(...ids) as unknown as StatRow[]);
  for (const s of statRows) {
    const key = `${s.athlete_id}|${s.season}`;
    const pivot = pivots.get(key) ?? {};
    (pivot[s.category] ??= {})[s.stat_type] = Number(s.stat) || 0;
    pivots.set(key, pivot);
  }

  // 4. Jerseys from rosters (cosmetic — empty string when absent). Ordered by
  //    season so an athlete's latest jersey wins; nkey breaks same-season ties
  //    deterministically.
  const jerseys = new Map<string, string>();
  const jerseyRows =
    ids.length === 0
      ? []
      : (db
          .prepare(
            `SELECT athlete_id, jersey
               FROM rosters
              WHERE athlete_id IN ${placeholders(ids.length)} AND jersey IS NOT NULL
              ORDER BY season, nkey`,
          )
          .all(...ids) as unknown as { athlete_id: string; jersey: string | number }[]);
  for (const r of jerseyRows) jerseys.set(r.athlete_id, String(r.jersey));
  if (jerseys.size === 0) {
    console.warn("  WARN: no jerseys in the warehouse — run `cfb ingest --datasets rosters` from the platform.");
  }
  db.close();

  // 5. Assemble Player objects (decade = decade of the athlete's best season).
  const players: Player[] = [];
  for (const k of kept) {
    const program = byName.get(k.team)!;
    const decade = decadeOf(k.season);
    const pivot = pivots.get(`${k.athlete_id}|${k.season}`) ?? {};
    players.push({
      player_id: playerId(k.primary, k.player, program.school_id, decade),
      name: k.player,
      display_short: displayShort(k.player),
      jersey_number: jerseys.get(k.athlete_id) ?? "",
      primary_position: k.primary,
      secondary_position: k.secondary,
      school: program.name,
      school_id: program.school_id,
      decade,
      historical_conference:
        program.conferences[decade] ?? conferences.get(k.team) ?? "FBS",
      is_historic_powerhouse: program.powerhouse_eras.includes(decade),
      hidden_ovr: k.overall,
      stats: statBlockFor(k.primary, pivot),
    });
  }
  // CFBD occasionally assigns one human two athlete_ids across seasons, which
  // collides on our name-based player_id — keep the better-rated row.
  const byId = new Map<string, Player>();
  for (const p of players) {
    const prev = byId.get(p.player_id);
    if (!prev || p.hidden_ovr > prev.hidden_ovr) byId.set(p.player_id, p);
  }
  return { players: [...byId.values()], conferences, branding };
}

// ---------------------------------------------------------------------------
// Assemble + validate + write
// ---------------------------------------------------------------------------
function contentPlayers(programs: ProgramContent[]): Player[] {
  return programs.flatMap((program) => {
    return program.players
      .filter((p) => !EXCLUDED_DECADES.has(p.decade))
      .map((p) => ({
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
    }));
  });
}

function contentCoaches(
  programs: ProgramContent[],
  modernConfs: Map<string, string>,
): Coach[] {
  return programs.flatMap((program) =>
    program.coaches
      .filter((c) => !EXCLUDED_DECADES.has(c.decade))
      .map((c) => ({
      coach_id: coachId(c.name, program.school_id, c.decade),
      name: c.name,
      display_short: displayShort(c.name),
      school: program.name,
      school_id: program.school_id,
      decade: c.decade,
      historical_conference:
        program.conferences[c.decade] ??
        (c.decade === "2020s" ? modernConfs.get(program.cfbd_name) ?? "FBS" : "FBS"),
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

function main(): void {
  console.log("Baking data.json …");
  const programs = loadContent();
  console.log(`  programs: ${programs.length}`);

  const { players: modern, conferences, branding } = fetchModernPlayers(programs);
  console.log(`  modern (real) players: ${modern.length}`);

  const authored = contentPlayers(programs);
  console.log(`  authored players: ${authored.length}`);

  // Union, with REAL rows winning same-human collisions (user decision: real
  // data only). An authored row survives only when no real row qualifies —
  // e.g. Cam Newton, whose 2010 CFBD rows carry no position and can't be
  // rated (ADR-0014's data cliff inside the decade).
  const realKeys = new Set(
    modern.map((p) => `${p.name.toLowerCase()}|${p.school_id}|${p.decade}`),
  );
  const superseded: string[] = [];
  const authoredKept = authored.filter((p) => {
    const key = `${p.name.toLowerCase()}|${p.school_id}|${p.decade}`;
    if (realKeys.has(key)) {
      superseded.push(p.name);
      return false;
    }
    return true;
  });
  if (superseded.length > 0) {
    console.log(
      `  real rows supersede authored (${superseded.length}): ${superseded.join(", ")}`,
    );
  }
  if (authoredKept.length > 0) {
    console.log(
      `  authored rows without a real counterpart kept (${authoredKept.length}): ` +
        authoredKept.map((p) => p.name).join(", "),
    );
  }

  const players = [...modern, ...authoredKept];

  // Anti-inflation recalibration (ADR-0016): quantile-remap hidden_ovr per
  // position so §4.5 scarcity holds within the DRAFT POOL (rank-preserving —
  // §12 correlation invariant untouched). Tuned via scripts/balance.ts.
  const byPos = new Map<string, number[]>();
  for (const p of players) {
    byPos.set(p.primary_position, [...(byPos.get(p.primary_position) ?? []), p.hidden_ovr]);
  }
  const remap = calibrationMap(byPos);
  for (const p of players) {
    p.hidden_ovr = remap.get(p.primary_position)!.get(p.hidden_ovr)!;
  }
  const post = players.map((p) => p.hidden_ovr);
  console.log(
    `  recalibrated OVRs: >=96 ${post.filter((o) => o >= 96).length} · ` +
      `>=90 ${post.filter((o) => o >= 90).length} · median ${[...post].sort((a, b) => a - b)[Math.floor(post.length / 2)]}`,
  );
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
      is_historic_powerhouse:
        program.powerhouse_eras.filter((d) => !EXCLUDED_DECADES.has(d)).length > 0,
      powerhouse_eras: program.powerhouse_eras.filter((d) => !EXCLUDED_DECADES.has(d)),
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

main();
