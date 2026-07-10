// Bake public/seasons.json for the "Guess the Season" cabinet: every in-game
// program's real season slates (completed games from cfb_games), the season's
// conference, and a star-player hint (top-rated player from cfb_player_ratings).
// Supabase-only — everything it needs is already served (ADR-0014).
//
// Run: npm run build:seasons
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeasonEntry, SeasonGame, SeasonsCatalog } from "../src/engine/guessSeason.ts";
import { displayShort } from "./lib.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(HERE, "content");
const OUT_PATH = join(HERE, "..", "public", "seasons.json");
const SEASONS = Array.from({ length: 16 }, (_, i) => 2010 + i); // 2010..2025
const MIN_GAMES = 6; // keep COVID-shortened slates, drop empty/partial seasons

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

const quoteList = (vals: string[]) => `(${vals.map((v) => `"${v}"`).join(",")})`;

interface GameRow {
  season: number;
  week: number;
  season_type: string;
  home_team: string;
  away_team: string;
  home_points: number | null;
  away_points: number | null;
  completed: boolean;
}

async function main(): Promise<void> {
  console.log("Baking seasons.json …");
  const programs = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CONTENT_DIR, f), "utf8")) as {
      school_id: string;
      cfbd_name: string;
      name: string;
    });
  const names = programs.map((p) => p.cfbd_name);

  // Season-scoped conference from cfb_teams.
  const teamRows = (await rest(
    `cfb_teams?select=school,season,conference&school=in.${quoteList(names)}&season=in.(${SEASONS.join(",")})`,
  )) as unknown as { school: string; season: number; conference: string | null }[];
  const confOf = new Map(teamRows.map((r) => [`${r.school}|${r.season}`, r.conference ?? "FBS"]));

  // Star hint: top-rated real player per team-season.
  const starRows = (await rest(
    `cfb_player_ratings?select=team,season,player,position,overall` +
      `&team=in.${quoteList(names)}&season=in.(${SEASONS.join(",")})` +
      `&projected=is.false&is_current=is.true&overall=gte.80&order=nkey.asc`,
  )) as unknown as { team: string; season: number; player: string; position: string; overall: number }[];
  const starOf = new Map<string, { name: string; pos: string; ovr: number }>();
  for (const r of starRows) {
    const key = `${r.team}|${r.season}`;
    const prev = starOf.get(key);
    if (!prev || r.overall > prev.ovr) {
      starOf.set(key, { name: displayShort(r.player), pos: r.position || "?", ovr: r.overall });
    }
  }

  const entries: SeasonEntry[] = [];
  for (const program of programs) {
    const gameRows = (await rest(
      `cfb_games?select=season,week,season_type,home_team,away_team,home_points,away_points,completed` +
        `&season=in.(${SEASONS.join(",")})&completed=is.true` +
        `&or=(home_team.eq."${program.cfbd_name}",away_team.eq."${program.cfbd_name}")`,
    )) as unknown as GameRow[];

    const bySeason = new Map<number, GameRow[]>();
    for (const g of gameRows) {
      if (g.home_points === null || g.away_points === null) continue;
      bySeason.set(g.season, [...(bySeason.get(g.season) ?? []), g]);
    }

    for (const [season, rows] of bySeason) {
      const star = starOf.get(`${program.cfbd_name}|${season}`);
      if (!star) continue; // no rated players that season → not guessable
      rows.sort(
        (a, b) =>
          Number(a.season_type === "postseason") - Number(b.season_type === "postseason") ||
          a.week - b.week,
      );
      const games: SeasonGame[] = rows.map((g, i) => {
        const home = g.home_team === program.cfbd_name;
        const us = home ? g.home_points! : g.away_points!;
        const them = home ? g.away_points! : g.home_points!;
        return {
          n: i + 1,
          res: us > them ? "W" : "L",
          us,
          them,
          opp: home ? g.away_team : g.home_team,
          post: g.season_type === "postseason",
        };
      });
      if (games.length < MIN_GAMES) continue;
      const wins = games.filter((g) => g.res === "W").length;
      entries.push({
        school_id: program.school_id,
        team: program.name,
        season,
        conference: confOf.get(`${program.cfbd_name}|${season}`) ?? "FBS",
        record: `${wins}-${games.length - wins}`,
        games,
        star,
      });
    }
  }

  entries.sort((a, b) => a.school_id.localeCompare(b.school_id) || a.season - b.season);
  const catalog: SeasonsCatalog = {
    version: 1,
    generated_at: new Date().toISOString(),
    entries,
  };
  const perTeam = new Map<string, number>();
  for (const e of entries) perTeam.set(e.school_id, (perTeam.get(e.school_id) ?? 0) + 1);
  console.log(`  entries: ${entries.length} across ${perTeam.size} programs`);
  for (const [t, n] of [...perTeam].sort()) console.log(`    ${t.padEnd(16)} ${n} seasons`);
  writeFileSync(OUT_PATH, JSON.stringify(catalog));
  console.log(`  wrote ${OUT_PATH} (${(JSON.stringify(catalog).length / 1024).toFixed(0)} KB)`);
}

await main();
