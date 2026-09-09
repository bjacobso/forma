import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  base: "/playground/",
  plugins: [react(), tailwindcss()],
  build: {
    sourcemap: true,
  },
});
