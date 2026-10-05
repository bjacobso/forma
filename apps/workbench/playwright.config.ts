import { defineConfig, devices } from "@playwright/test";

const port = 5181;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "*.pw.ts",
  outputDir: "./test-results",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
  },
  webServer: {
    // A fresh server: the Foldkit plugin pushes a kept model into pages after hot updates.
    command: `pnpm exec vite --host 127.0.0.1 --port ${port} --strictPort`,
    url: `http://127.0.0.1:${port}/`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 950 } },
    },
  ],
});
