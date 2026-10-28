import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Live evaluations against a running ReadyState server (`npm run eval`).
 * Kept apart from `npm test`: they call a real model, take minutes and cost
 * tokens. Options are environment variables; see scripts/eval/README.md.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["scripts/eval/**/*.eval.ts"],
    testTimeout: 60 * 60 * 1000,
    fileParallelism: false,
  },
});
