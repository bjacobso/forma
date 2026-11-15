import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/playground/",
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: true,
    rollupOptions: {
      // The docs load reader snippets from /playground/reader-embed.js, so that entry keeps a stable name.
      input: { index: resolve(import.meta.dirname, "index.html"), "reader-embed": resolve(import.meta.dirname, "src/reading/embed.ts") },
      preserveEntrySignatures: "exports-only",
      output: { entryFileNames: chunk => chunk.name === "reader-embed" ? "reader-embed.js" : "assets/[name]-[hash].js" },
    },
  },
});
