import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Several suites compile TypeScript or spawn the CLI; parallel agents and
    // builds share the machine, so the 5 s default flakes without a regression.
    testTimeout: 20_000,
  },
});
