import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// Builds the Studio SPA into ../dist/studio, which the `oya dev` CLI serves.
export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  base: "./", // relative asset paths so it works served from any origin/path
  build: {
    outDir: fileURLToPath(new URL("../dist/studio", import.meta.url)),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
