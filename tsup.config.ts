import { defineConfig } from "tsup";

// Phase 0 ships the core runtime only. Subpath entries (./react, ./server,
// ./anthropic, ...) are added as those surfaces land.
export default defineConfig({
  entry: {
    index: "src/index.ts",
    anthropic: "src/anthropic/index.ts",
    openai: "src/openai/index.ts",
    google: "src/google/index.ts",
    server: "src/server/index.ts",
    react: "src/react/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
});
