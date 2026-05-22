import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    anthropic: "src/anthropic/index.ts",
    openai: "src/openai/index.ts",
    google: "src/google/index.ts",
    react: "src/react/index.ts",
    cli: "src/cli.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  target: "es2022",
  external: ["react"],
});
