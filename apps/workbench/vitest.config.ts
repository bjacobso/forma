import { defineConfig } from "vitest/config";

// Unit tests need none of the app's Vite plugins.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
