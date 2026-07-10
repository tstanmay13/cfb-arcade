// Seeded RNG (§2 runState.seed): every random draw in the engines goes through
// one of these so a run is fully reproducible from its seed. Never use
// Math.random() in engine code.

export type Rng = () => number;

/** mulberry32 — tiny, fast, good-enough PRNG. Returns floats in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fresh unpredictable seed for a new run (the one non-seeded draw). */
export function newSeed(): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    return crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
}

/** Pick uniformly from a non-empty array. */
export function pick<T>(arr: T[], rng: Rng): T {
  return arr[Math.floor(rng() * arr.length)];
}

/** Weighted pick over {key: weight} — §6.2 outcome roll. */
export function weightedPick(weights: Record<string, number>, rng: Rng): string {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let roll = rng() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** Fisher-Yates shuffle (copy) — deterministic given the rng. */
export function shuffle<T>(arr: T[], rng: Rng): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
