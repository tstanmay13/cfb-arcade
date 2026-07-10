import type { SeasonsCatalog } from "../engine/guessSeason.ts";

/** Lazily fetch the static seasons.json for the Guess the Season cabinet. Kept
    separate from data.json (ADR-0017) so the draft game never pays for it. */
export async function loadSeasons(): Promise<SeasonsCatalog> {
  const resp = await fetch(`${import.meta.env.BASE_URL}seasons.json`);
  if (!resp.ok) throw new Error(`seasons.json failed to load (HTTP ${resp.status})`);
  return (await resp.json()) as SeasonsCatalog;
}
