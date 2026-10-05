import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Property tests run longer when FORMA_PROPERTY_SCALE raises their counts.
    ...(process.env["FORMA_PROPERTY_SCALE"] ? { testTimeout: 600_000 } : {}),
  },
});
