// Dev utility: drive the game headlessly, capture console errors +
// screenshots at each phase. Not part of the app. Usage:
//   node --no-warnings scripts/screenshot.ts [baseUrl] [outDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5174";
const outDir = process.argv[3] ?? "/tmp/16-0-shots";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: base });
const page = await context.newPage();
const errors: string[] = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(base);
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/01-team-select.png` });

// Pick the first program + start (Classic).
await page.getByRole("button", { name: /alabama/i }).click();
await page.getByRole("button", { name: "START THE DRAFT" }).click();
await page.waitForTimeout(1100); // ticker
await page.screenshot({ path: `${outDir}/02-draft-first-spin.png` });

// Draft loop: pick the first enabled pool row, place into first glowing slot.
for (let i = 0; i < 8; i++) {
  const row = page.locator("section[aria-label='Draft board'] li button:enabled").first();
  await row.waitFor({ state: "visible", timeout: 5000 });
  await row.click();
  const slot = page.locator("section[aria-label='Your team'] button:enabled").first();
  await slot.click();
  if (i === 0) await page.screenshot({ path: `${outDir}/03-first-placement.png` });
  if (i < 7) {
    await page.getByRole("button", { name: "SPIN", exact: true }).click();
    await page.waitForTimeout(1000);
  }
}
await page.waitForTimeout(1100);
await page.screenshot({ path: `${outDir}/04-coach-spin.png` });

// Pick a coach → season animation → results.
const coachRow = page.locator("section[aria-label='Draft board'] li button:enabled").first();
await coachRow.click();
await page.waitForTimeout(1500);
await page.screenshot({ path: `${outDir}/05-season.png` });
await page.getByRole("button", { name: /skip to the end|SEE THE FINAL VERDICT/ }).click();
const verdict = page.getByRole("button", { name: "SEE THE FINAL VERDICT" });
if (await verdict.isVisible().catch(() => false)) await verdict.click();
await page.waitForTimeout(400);
await page.screenshot({ path: `${outDir}/06-results.png`, fullPage: true });

// Copy the Wordle-style result (§10) and read it back from the clipboard.
await page.getByRole("button", { name: "COPY RESULT" }).click();
await page.waitForTimeout(200);
const shareText = await page.evaluate(() => navigator.clipboard.readText());
console.log(`copied result:\n${shareText}`);

console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join("\n")}` : "no console errors");
await browser.close();
