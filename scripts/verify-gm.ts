// Full browser regression: lineup choice, season stats, failed-save recovery,
// retention autosave, and a dynasty rollover. Stats traffic is always blocked.
// node --no-warnings scripts/verify-gm.ts [baseUrl] [outDir]
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { chromium, type Page } from "playwright";
import type { DynastyState } from "../src/gm/engine/types.ts";

const base = process.argv[2] ?? "http://127.0.0.1:5199";
const out = process.argv[3] ?? "/private/tmp/cfb-quality-gm";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
await context.route("**/rest/v1/**", route => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
await context.addInitScript(() => {
  localStorage.setItem("cfbgm:tour-done", "1");
  // Pin the new-dynasty seed; engine random streams remain unchanged.
  Object.defineProperty(crypto, "getRandomValues", { value: (a: Uint32Array) => { a.fill(12345); return a; } });
});
const page = await context.newPage();
page.setDefaultTimeout(10000);
page.on("pageerror", e => errors.push(e.message));
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
let draftReads = 0;
await page.route("**/data.json", route => { draftReads++; return route.abort(); });

async function snapshot(page: Page): Promise<DynastyState> {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("cfbgm");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction("snapshots").objectStore("snapshots").getAll();
      get.onsuccess = () => { db.close(); resolve(get.result[0].state); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }));
}
const saved = async () => {
  await page.getByText("All changes saved on this device", { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const controls = document.querySelector("fieldset");
    return controls && !controls.disabled && document.body.textContent?.includes("All changes saved on this device");
  });
};
async function action(name: string | RegExp) {
  await page.getByRole("button", { name, exact: typeof name === "string" }).click();
  await saved();
}
try {
  await page.goto(`${base}/gm`);
  await page.getByRole("button", { name: "NEW DYNASTY" }).click();
  await page.getByRole("button", { name: /Alabama.*Elo/ }).click();
  await saved();
  assert.equal(draftReads, 0, "GM must open independently of the draft data file");
  let state = await snapshot(page);
  assert.equal(state.seed, 12345);
  await action("STATS");
  await page.getByText(/No passing yards recorded yet/).waitFor();
  await action("ROSTER");
  const qbs = state.teams[state.userTid].roster.map(id => state.players[id]).filter(p => p.g === "QB").sort((a,b) => a.ovr - b.ovr);
  const chosen = qbs[0];
  const row = page.getByRole("row").filter({ hasText: chosen.name }).first();
  await row.getByRole("button", { name: "Pin as starter", exact: true }).click();
  await saved();
  state = await snapshot(page);
  assert.equal(state.teams[state.userTid].pins?.[0], chosen.id);
  const chart = page.locator('[data-tour="depth-chart"]');
  await chart.getByRole("button", { name: new RegExp(chosen.name) }).filter({ hasText: "starter" }).waitFor();
  await page.screenshot({ path: `${out}/01-depth-chart.png`, fullPage: true });

  // Inject one real IndexedDB write failure. The game must expose it, retain
  // the simulated week in memory, and persist exactly once after retry.
  await page.evaluate(() => {
    const root = window as typeof window & { failSave?: boolean };
    root.failSave = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(...args: Parameters<typeof put>) {
      if (this.name === "snapshots" && root.failSave) throw new DOMException("Test quota exceeded", "QuotaExceededError");
      return put.apply(this, args);
    };
  });
  const before = await snapshot(page);
  await page.getByRole("button", { name: "SIM WEEK 1", exact: true }).click();
  await page.getByText("Unsaved changes", { exact: true }).waitFor();
  assert.equal((await snapshot(page)).week, before.week, "failed transaction must leave the saved week intact");
  assert.equal(await page.getByRole("button", { name: /SIM WEEK 2/, exact: true }).isEnabled(), false);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "Download recovery save", exact: true }).click();
  const recovery = await downloadEvent;
  await recovery.saveAs(`${out}/recovery.json`);
  const recovered = JSON.parse(readFileSync(`${out}/recovery.json`, "utf8"));
  assert.equal(recovered.kind, "cfbgm-dynasty");
  assert.equal(recovered.state.week, 2, "recovery export contains the unsaved week");
  await page.screenshot({ path: `${out}/02-save-recovery.png`, fullPage: true });
  await page.evaluate(() => { (window as typeof window & { failSave?: boolean }).failSave = false; });
  await action("Retry save");
  state = await snapshot(page);
  assert.equal(state.week, 2);
  assert.ok(state.results.length > 0);
  const resultCount = state.results.length;
  await page.reload();
  await page.getByRole("button", { name: "CONTINUE", exact: true }).click();
  await saved();
  assert.equal((await snapshot(page)).results.length, resultCount);

  await action("STATS");
  await page.getByRole("table").waitFor();
  await page.getByRole("combobox", { name: "Scope" }).selectOption("team");
  assert.ok(await page.getByRole("row").count() > 1);
  await page.getByRole("row").nth(1).getByRole("button").click();
  await page.getByRole("dialog").waitFor();
  await action("CLOSE");
  await page.screenshot({ path: `${out}/03-season-leaders.png`, fullPage: true });

  await action(/PLAY GAME/);
  await page.getByRole("button", { name: "NEXT DRIVE ▶", exact: true }).click();
  await page.getByRole("button", { name: "SIM TO FINAL", exact: true }).click();
  await action("APPLY RESULT & CLOSE");
  assert.equal((await snapshot(page)).results.length, resultCount + 1, "watched game commits once");
  await action("SIM WHOLE SEASON");
  state = await snapshot(page);
  assert.equal(state.phase, "offseason");
  assert.equal(state.offWeek, 1);
  await page.getByRole("region", { name: "Offseason calendar" }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${out}/04-mobile-offseason.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "mobile layout must not overflow");
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Management actions must persist their costs and actual attribute gains.
  await action("ROSTER");
  state = await snapshot(page);
  const prospect = state.teams[state.userTid].roster.map(id => state.players[id]).find(p => p.ovr < p.ceil)!;
  assert.ok(prospect);
  await page.getByRole("row").filter({ hasText: prospect.name }).first().click();
  await action("📈 DEVELOP · 25");
  let managed = await snapshot(page);
  assert.ok(managed.players[prospect.id].ovr > prospect.ovr);
  assert.ok(Object.keys(prospect.attrs).some(key => managed.players[prospect.id].attrs[key] > prospect.attrs[key]));
  assert.equal(managed.stamina, state.stamina - 25);
  await action("CLOSE");
  await action("RECRUITING");
  await page.getByRole("row").nth(1).click();
  await action("🔍 SCOUT I · 20");
  managed = await snapshot(page);
  assert.ok(managed.recruits.some(r => r.scouted === 1));
  assert.equal(managed.stamina, state.stamina - 45);
  await action("OFFSEASON REPORT");
  // The report's advance button moves into the retention week.
  await action("▶ ADVANCE TO RETENTION");
  state = await snapshot(page);
  assert.equal(state.offStage, "retention");
  const court = page.getByRole("button", { name: /COURT ·/ }).first();
  assert.ok(await court.count(), "seeded dynasty must exercise retention courting");
  {
    const stamina = state.stamina;
    await court.click();
    await saved();
    state = await snapshot(page);
    assert.ok(state.retention.some(c => c.courted));
    assert.equal(state.stamina, stamina - 20);
    await page.reload();
    await action("CONTINUE");
    assert.ok((await snapshot(page)).retention.some(c => c.courted), "courting survives reload before advancing");
  }
  await action("SIM OFFSEASON");
  const finished = await snapshot(page);
  assert.equal(finished.offStage, "done");
  await action(/START 2027 SEASON/);
  state = await snapshot(page);
  assert.equal(state.season, 2027);
  assert.equal(state.phase, "regular");
  assert.equal(state.teams[state.userTid].roster.length, 85);
  const archived = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open("cfbgm");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const count = db.transaction("archive").objectStore("archive").count();
      count.onsuccess = () => { db.close(); resolve(count.result); };
      count.onerror = () => { db.close(); reject(count.error); };
    };
  }));
  assert.equal(archived, finished.offseason!.archive.length, "rollover archives departures exactly once");
  await page.screenshot({ path: `${out}/05-year-two.png`, fullPage: true });
  const restoreContext = await browser.newContext();
  const restorePage = await restoreContext.newPage();
  restorePage.on("pageerror", e => errors.push(e.message));
  await restorePage.goto(`${base}/gm`);
  await restorePage.getByRole("button", { name: "IMPORT SAVE", exact: true }).waitFor();
  await restorePage.locator('input[type="file"]').setInputFiles(`${out}/recovery.json`);
  await restorePage.getByText("All changes saved on this device", { exact: true }).waitFor();
  const restored = await snapshot(restorePage);
  assert.equal(restored.week, 2);
  assert.equal(restored.seed, 12345);
  assert.equal(restored.results.length, resultCount);
  await restoreContext.close();
  assert.deepEqual(errors, []);
  console.log("PASS: GM independent loading, lineup preference, stats, save failure/retry, reload, retention persistence, mobile layout, watch mode, development, scouting and year-two rollover/archive");
} catch (error) {
  await page.screenshot({ path: `${out}/failure.png`, fullPage: true });
  console.error((await page.locator("body").innerText()).slice(-4000));
  throw error;
} finally {
  await browser.close();
}
