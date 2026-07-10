// Mobile-viewport (390px) playthrough check for §8.4: placement sheet,
// sticky action bar, compact field.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const base = process.argv[2] ?? "http://localhost:5174";
const outDir = process.argv[3] ?? "/tmp/16-0-shots";
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(base);
await page.getByRole("button", { name: /texas/i }).click();
await page.getByRole("button", { name: "START THE DRAFT" }).click();
await page.waitForTimeout(1100);
const row = page.locator("section[aria-label='Draft board'] li button:enabled").first();
await row.click();
await page.screenshot({ path: `${outDir}/m1-placement-sheet.png` });
// Place via the mobile sheet button.
await page
  .locator("div.lg\\:hidden button", { hasText: /^(QB|RB|WR1|WR2|DL|LB|CB|S)$/ })
  .first()
  .click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${outDir}/m2-after-place.png` });
console.log(errors.length ? `ERRORS:\n${errors.join("\n")}` : "no page errors");
await browser.close();
