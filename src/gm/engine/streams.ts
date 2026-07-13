// Hierarchical seed derivation (CFB_GM_DESIGN "Determinism"): every subsystem
// draws from its own stream derived from the dynasty seed, so a user action in
// one system can never perturb another's outcomes. Same seed + same decisions
// = identical dynasty.

import { mulberry32, type Rng } from "../../engine/rng.ts";

/** xmur3-style string/number mixer → 32-bit sub-seed. */
export function subSeed(root: number, ...labels: (string | number)[]): number {
  let h = root >>> 0;
  const mix = (v: number) => {
    h = Math.imul(h ^ v, 2654435761);
    h = (h << 13) | (h >>> 19);
    h = Math.imul(h, 5) + 0xe6546b64;
  };
  for (const label of labels) {
    if (typeof label === "number") {
      mix(label | 0);
    } else {
      for (let i = 0; i < label.length; i++) mix(label.charCodeAt(i));
    }
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return h >>> 0;
}

/** RNG stream for a labeled subsystem, e.g. stream(seed, "game", 2026, gid). */
export function stream(root: number, ...labels: (string | number)[]): Rng {
  return mulberry32(subSeed(root, ...labels));
}

/** Integer in [min, max] inclusive. */
export function rangeInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** Clamp helper used across the engine. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
