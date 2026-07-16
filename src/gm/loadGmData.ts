import type { GmData } from "./engine/types.ts";

/** Selectable dynasty start years (M0.2, ADR-0027): 2010–2026, minus the two
    seasons with unusable served ratings (2023 empty, 2014 ~46% coverage). */
export const GM_ANCHOR_YEAR = 2026;
export const GM_START_YEARS: number[] = (() => {
  const ys: number[] = [];
  for (let y = GM_ANCHOR_YEAR; y >= 2010; y--) if (y !== 2023 && y !== 2014) ys.push(y);
  return ys;
})();

/** Lazily fetch a season's static gm-data bake. Each cabinet bakes its own
    JSON (ADR-0017/0023) — the other cabinets never pay for it. 2026 is the
    anchor file; historical starts load their own per-year file. */
export async function loadGmData(year: number = GM_ANCHOR_YEAR): Promise<GmData> {
  const file = year === GM_ANCHOR_YEAR ? "gm-data.json" : `gm-data-${year}.json`;
  const resp = await fetch(`${import.meta.env.BASE_URL}${file}`);
  if (!resp.ok) throw new Error(`${file} failed to load (HTTP ${resp.status})`);
  return (await resp.json()) as GmData;
}
