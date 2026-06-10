import { defineConfig } from "vitest/config";

// Unit tests cover the app's pure logic only (no DOM/React/sql.js), so the
// default Node environment is enough. The Playwright e2e specs live in ./e2e
// and use *.spec.ts; restricting includes to src/**/*.test.ts keeps the two
// runners from picking up each other's files.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["e2e/**", "node_modules/**", "dist/**"],
  },
});
