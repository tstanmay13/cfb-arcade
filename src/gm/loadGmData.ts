import type { GmData } from "./engine/types.ts";

/** Lazily fetch the static gm-data.json for the CFB-GM cabinet. Its own bake
    (ADR-0017/0023) — the other cabinets never pay for it. */
export async function loadGmData(): Promise<GmData> {
  const resp = await fetch(`${import.meta.env.BASE_URL}gm-data.json`);
  if (!resp.ok) throw new Error(`gm-data.json failed to load (HTTP ${resp.status})`);
  return (await resp.json()) as GmData;
}
