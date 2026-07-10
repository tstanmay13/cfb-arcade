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

function wire(page: Page, tag: string): void {
  page.on("console", (m) => {
    if (m.type() === "error") allErrors.push(`[${tag}] ${m.text()}`);
  });
  page.on("pageerror", (e) => allErrors.push(`[${tag}] ${String(e)}`));
}

/** From the title screen into the (freshly loaded) Guess the Season board. */
async function openArcade(context: BrowserContext, tag: string): Promise<Page> {
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
  const page = await context.newPage();
  wire(page, tag);
  await page.goto(base);
  await page.getByRole("button", { name: /GUESS THE SEASON/i }).click();
  await page.getByText(new RegExp(`DAILY #${puzzle}\\b`)).waitFor();
  await page.locator("section[aria-label='The mystery season']").waitFor();
  return page;
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
