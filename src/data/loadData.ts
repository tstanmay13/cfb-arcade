import type { GameData } from "./types.ts";

/** BOOT (§2): fetch the static data.json once and hold it in memory. */
export async function loadData(): Promise<GameData> {
  const resp = await fetch(`${import.meta.env.BASE_URL}data.json`);
  if (!resp.ok) throw new Error(`data.json failed to load (HTTP ${resp.status})`);
  return (await resp.json()) as GameData;
}
