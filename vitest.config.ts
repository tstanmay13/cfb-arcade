// Engine + bake-helper tests are pure TypeScript (no DOM, no plugins), so
// vitest gets its own minimal config instead of piggybacking vite.config.ts
// (vite 8/rolldown and vitest's bundled vite have incompatible plugin types).
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
