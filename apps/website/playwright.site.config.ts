import { defineConfig, devices } from "@playwright/test";

const port = 5182;

export default defineConfig({
  testDir: "./e2e-site",
  testMatch: "*.pw.ts",
  outputDir: "./test-results/site",
  timeout: 30_000,
  workers: 1,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // Exercise the assembled assets through the same worker used in production.
    command: `pnpm -w website:build && pnpm exec wrangler dev --local --ip 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: { WRANGLER_SEND_METRICS: "false" },
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 950 } },
    },
  ],
});
