import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const clientRoot = fileURLToPath(new URL("./client", import.meta.url));
const clientOutput = fileURLToPath(new URL("./dist/public", import.meta.url));
const serverTarget = "http://127.0.0.1:8090";

export default defineConfig({
  root: clientRoot,
  plugins: [react()],
  build: {
    outDir: clientOutput,
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/api": serverTarget,
      "/health": serverTarget
    }
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    restoreMocks: true
  }
});
