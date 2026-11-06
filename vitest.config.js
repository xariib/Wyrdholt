import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/test/**/*.test.{js,mjs,cjs,ts}", "apps/**/test/**/*.test.{js,mjs,cjs,ts}"],
    environment: "node",
    testTimeout: 60_000,
  },
});
