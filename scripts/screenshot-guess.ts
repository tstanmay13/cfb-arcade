// Verification harness for the Guess the Season cabinet (ADR-0017). Drives a
// full WIN and a full LOSS headlessly, asserts the Wordle-style share text lands
// on the clipboard, and fails on any console error. It reads seasons.json + the
// engine's daily-pick to know the answer, so it can play a real solve. Usage:
//   node --no-warnings scripts/screenshot-guess.ts [baseUrl] [outDir]
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dailyIndex, puzzleNumber, type SeasonsCatalog } from "../src/engine/guessSeason.ts";

const base = process.argv[2] ?? "http://localhost:5199";
const outDir = process.argv[3] ?? "/tmp/guess-season-shots";
mkdirSync(outDir, { recursive: true });

const HERE = dirname(fileURLToPath(import.meta.url));
const catalog = JSON.parse(readFileSync(join(HERE, "..", "public", "seasons.json"), "utf8")) as SeasonsCatalog;

const now = new Date();
const answer = catalog.entries[dailyIndex(catalog.entries.length, now)];
const puzzle = puzzleNumber(now);
const seasons = catalog.entries.map((e) => e.season);
const minYear = Math.min(...seasons);
const maxYear = Math.max(...seasons);
const allYears = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
const allTeams = [...new Set(catalog.entries.map((e) => e.team))];

console.log(`Daily #${puzzle}: answer = ${answer.team} ${answer.season} (${answer.record})`);

const browser = await chromium.launch();
const allErrors: string[] = [];

// Global-stats traffic (ADR-0019) is intercepted: result POSTs are captured and
// BLOCKED so harness runs never pollute the real arcade_results table, and the
// aggregate RPC is stubbed so the stats modal renders deterministic numbers.
const reported: { tag: string; body: Record<string, unknown> }[] = [];
const STUB_GLOBAL = {
  plays: 128,
  wins: 96,
  win_pct: 75.0,
  guess_distribution: { "1": 4, "2": 18, "3": 30, "4": 24, "5": 14, "6": 6 },
  avg_guesses: 3.4,
  // v2 keys (migration 0008)
  players: 41,
  avg_hints: 1.25,
  median_time_seconds: 102,
  top_guesses: [
    { guess: "georgia 2021", n: 40 },
    { guess: "ohio_state 2014", n: 22 },
    { guess: "alabama 2020", n: 17 },
  ],
};
const STUB_OVERVIEW = {
  all_time: { plays: 500, wins: 300, players: 88, win_pct: 60.0 },
  today: { plays: 12, players: 9, wins: 7 },
  series: Array.from({ length: 14 }, (_, i) => ({
    day: new Date(Date.now() - (13 - i) * 86_400_000).toISOString().slice(0, 10),
    plays: 5 + ((i * 7) % 26),
    players: 3 + ((i * 5) % 15),
    wins: 2 + ((i * 3) % 11),
  })),
};

function wire(page: Page, tag: string): void {
  page.on("console", (m) => {
    if (m.type() === "error") allErrors.push(`[${tag}] ${m.text()}`);
  });
  page.on("pageerror", (e) => allErrors.push(`[${tag}] ${String(e)}`));
}

/** From the title screen into the (freshly loaded) Guess the Season board. */
async function openArcade(context: BrowserContext, tag: string): Promise<Page> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  await context.route("**/rest/v1/arcade_results", async (route) => {
    reported.push({ tag, body: route.request().postDataJSON() as Record<string, unknown> });
    await route.fulfill({ status: 201, body: "" });
  });
  await context.route("**/rest/v1/rpc/arcade_daily_stats", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STUB_GLOBAL) }),
  );
  await context.route("**/rest/v1/rpc/arcade_overview", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(STUB_OVERVIEW) }),
  );
  const page = await context.newPage();
  wire(page, tag);
  await page.goto(base);
  await page.getByRole("button", { name: /GUESS THE SEASON/i }).click();
  await page.getByText(new RegExp(`DAILY #${puzzle}\\b`)).waitFor();
  await page.locator("section[aria-label='The mystery season']").waitFor();
  return page;
}

/** The stats sheet auto-opens after a finish; verify it, snapshot it, close it. */
async function checkStatsModal(page: Page, tag: string, shot: string | null): Promise<void> {
  const dialog = page.locator("[role='dialog'][aria-label='Guess the Season stats']");
  await dialog.waitFor({ timeout: 6000 });
  const text = (await dialog.textContent()) ?? "";
  assert(text.includes(`DAILY #${puzzle}`), `[${tag}] stats sheet shows today's puzzle number`);
  assert(/75%/.test(text) && /128/.test(text), `[${tag}] stats sheet shows the (stubbed) global solve rate`);
  assert(text.includes("GUESS DISTRIBUTION"), `[${tag}] stats sheet has the you-vs-everyone distribution`);
  // v2 (migration 0008): distinct players, median time, popular guesses
  // (visible here because the harness just finished today's daily), and the
  // 14-day national traffic strip from arcade_overview.
  assert(/41\s*players/i.test(text), `[${tag}] stats sheet shows the distinct-player count`);
  assert(text.includes("median 1:42"), `[${tag}] stats sheet shows the median solve time`);
  assert(text.includes("TODAY'S POPULAR GUESSES"), `[${tag}] stats sheet lists popular guesses post-finish`);
  assert(/georgia 2021/i.test(text), `[${tag}] popular guesses render prettified slugs (underscores stripped)`);
  assert(text.includes("LAST 14 DAYS"), `[${tag}] stats sheet has the daily-runs strip`);
  assert(/88\s*players all-time/i.test(text), `[${tag}] overview totals render`);
  if (shot) {
    await page.waitForTimeout(250);
    await page.screenshot({ path: `${outDir}/${shot}`, fullPage: true });
  }
  await dialog.getByRole("button", { name: "Close stats" }).click();
  await dialog.waitFor({ state: "detached" });
}

async function guess(page: Page, teamName: string, year: number): Promise<void> {
  const sect = page.locator("section[aria-label='Make a guess']");
  await sect.getByRole("button", { name: teamName, exact: true }).click();
  await sect.getByRole("button", { name: String(year), exact: true }).click();
  await sect.getByRole("button", { name: /^GUESS:/ }).click();
}

function assert(cond: boolean, msg: string): void {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

// ---------------------------------------------------------------------------
// 1) WIN — guess the daily answer on the first try.
// ---------------------------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  const page = await openArcade(context, "win");
  await page.screenshot({ path: `${outDir}/01-board.png`, fullPage: true });

  await guess(page, answer.team, answer.season);
  const result = page.locator("section[aria-label='Result']");
  await result.waitFor();
  await page.waitForTimeout(450); // let the chip-in animation settle before capture
  await page.screenshot({ path: `${outDir}/02-win.png`, fullPage: true });

  const heading = (await result.locator("h2").textContent()) ?? "";
  assert(/SOLVED IN 1\/6/.test(heading), `win reveal shows "SOLVED IN 1/6" (got: ${heading.trim()})`);
  assert(
    (await result.textContent())?.includes(`${answer.team}`) ?? false,
    "win reveal names the program",
  );

  // Global report fired (and was intercepted), then the stats sheet auto-opens.
  await checkStatsModal(page, "win", "05-stats.png");
  const winReport = reported.find((r) => r.tag === "win")?.body;
  assert(winReport !== undefined, "win result was reported to arcade_results");
  assert(winReport!.game === "guess_season" && winReport!.won === true, "win report has game + won");
  assert(winReport!.guess_count === 1 && winReport!.puzzle_number === puzzle, "win report has count + puzzle");
  assert(String(winReport!.player_hash ?? "").length >= 8, "win report carries an anonymous player_hash");

  // Header button re-opens the sheet on demand.
  await page.getByRole("button", { name: "📊 STATS" }).click();
  await checkStatsModal(page, "win-reopen", null);

  await page.getByRole("button", { name: "COPY RESULT" }).click();
  await page.getByRole("button", { name: "COPIED ✓" }).waitFor();
  const shareWin = await page.evaluate(() => navigator.clipboard.readText());
  console.log(`  clipboard (win):\n${shareWin.split("\n").map((l) => "    " + l).join("\n")}`);
  assert(shareWin.includes(`GUESS THE SEASON #${puzzle}`), "share text has the puzzle header");
  assert(shareWin.includes("1/6"), "share text has the 1/6 score");
  assert(shareWin.includes("🟩🟩"), "share text has the all-green winning row");

  await context.close();
}

// ---------------------------------------------------------------------------
// 2) LOSS — six deliberately wrong guesses (always a wrong program).
// ---------------------------------------------------------------------------
{
  const context = await browser.newContext({ viewport: { width: 900, height: 1200 } });
  const page = await openArcade(context, "loss");

  const wrongTeams = allTeams.filter((t) => t !== answer.team).slice(0, 6);
  const wrongYears = allYears.filter((y) => y !== answer.season).slice(0, 6);
  assert(wrongTeams.length === 6, "have 6 wrong programs to guess");
  for (let i = 0; i < 6; i++) {
    await guess(page, wrongTeams[i], wrongYears[i]);
    if (i === 1) {
      // Mid-play: two feedback rows + the first unlocked hints on screen.
      await page.waitForTimeout(450);
      await page.screenshot({ path: `${outDir}/03-playing.png`, fullPage: true });
    }
  }

  const result = page.locator("section[aria-label='Result']");
  await result.waitFor();
  await page.waitForTimeout(450); // let the chip-in animation settle before capture
  await page.screenshot({ path: `${outDir}/04-loss.png`, fullPage: true });

  const heading = (await result.locator("h2").textContent()) ?? "";
  assert(/OUT OF GUESSES/.test(heading), `loss reveal shows "OUT OF GUESSES" (got: ${heading.trim()})`);
  assert((await result.textContent())?.includes(`${answer.season}`) ?? false, "loss reveal shows the answer year");

  await checkStatsModal(page, "loss", null);
  const lossReport = reported.find((r) => r.tag === "loss")?.body;
  assert(lossReport !== undefined, "loss result was reported to arcade_results");
  assert(lossReport!.won === false && lossReport!.guess_count === 6, "loss report has won=false + 6 guesses");

  await page.getByRole("button", { name: "COPY RESULT" }).click();
  await page.getByRole("button", { name: "COPIED ✓" }).waitFor();
  const shareLoss = await page.evaluate(() => navigator.clipboard.readText());
  console.log(`  clipboard (loss):\n${shareLoss.split("\n").map((l) => "    " + l).join("\n")}`);
  assert(shareLoss.includes("X/6"), "loss share text has the X/6 score");

  await context.close();
}

await browser.close();

if (allErrors.length) {
  console.error(`\nCONSOLE ERRORS (${allErrors.length}):\n${allErrors.join("\n")}`);
  process.exit(1);
}
console.log(`\n✅ All Guess the Season checks passed. Screenshots in ${outDir}`);
