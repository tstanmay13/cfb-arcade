// Bake public/seasons.json for the "Guess the Season" cabinet: every in-game
// program's real season slates (completed games from the warehouse `games`
// table), the season's conference, and a star-player hint (top-rated player
// from `player_ratings`). Reads cfb.db directly via node:sqlite (ADR-0025) —
// owner-side; collaborators use the committed seasons.json.
//
// Run: npm run build:seasons
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeasonEntry, SeasonGame, SeasonsCatalog } from "../src/engine/guessSeason.ts";
import { displayShort } from "./lib.ts";
import { openWarehouse, placeholders } from "./warehouse.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CONTENT_DIR = join(HERE, "content");
const OUT_PATH = join(HERE, "..", "public", "seasons.json");
const SEASONS = Array.from({ length: 16 }, (_, i) => 2010 + i); // 2010..2025
const MIN_GAMES = 6; // keep COVID-shortened slates, drop empty/partial seasons

interface GameRow {
  season: number;
  week: number;
  season_type: string;
  home_team: string;
  away_team: string;
  home_points: number | null;
  away_points: number | null;
}

function main(): void {
  console.log("Baking seasons.json …");
  const programs = readdirSync(CONTENT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(join(CONTENT_DIR, f), "utf8")) as {
      school_id: string;
      cfbd_name: string;
      name: string;
    });
  const names = programs.map((p) => p.cfbd_name);
  const db = openWarehouse();

  // Season-scoped conference from the warehouse.
  const teamRows = db
    .prepare(
      `SELECT school, season, conference FROM teams
        WHERE school IN ${placeholders(names.length)} AND season IN (${SEASONS.join(",")})`,
    )
    .all(...names) as unknown as { school: string; season: number; conference: string | null }[];
  const confOf = new Map(teamRows.map((r) => [`${r.school}|${r.season}`, r.conference ?? "FBS"]));

  // Star hint: top-rated real player per team-season.
  const starRows = db
    .prepare(
      `SELECT team, season, player, position, overall FROM player_ratings
        WHERE team IN ${placeholders(names.length)} AND season IN (${SEASONS.join(",")})
          AND projected = 0 AND is_current = 1 AND overall >= 80
        ORDER BY nkey`,
    )
    .all(...names) as unknown as { team: string; season: number; player: string; position: string; overall: number }[];
  const starOf = new Map<string, { name: string; pos: string; ovr: number }>();
  for (const r of starRows) {
    const key = `${r.team}|${r.season}`;
    const prev = starOf.get(key);
    if (!prev || r.overall > prev.ovr) {
      starOf.set(key, { name: displayShort(r.player), pos: r.position || "?", ovr: r.overall });
    }
  }

  const entries: SeasonEntry[] = [];
  const gamesStmt = db.prepare(
    `SELECT season, week, season_type, home_team, away_team, home_points, away_points
       FROM games
      WHERE season IN (${SEASONS.join(",")}) AND completed = 1
        AND (home_team = ? OR away_team = ?)
      ORDER BY nkey`,
  );
  for (const program of programs) {
    const gameRows = gamesStmt.all(program.cfbd_name, program.cfbd_name) as unknown as GameRow[];

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

  db.close();
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

main();
