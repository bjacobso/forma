import { defineConfig } from "vitest/config";

export default defineConfig({
  // These exercise the actual runtime while the repository runs its other
  // compiler suites concurrently, rather than only testing pure projections.
  test: { testTimeout: 20000 },
});
