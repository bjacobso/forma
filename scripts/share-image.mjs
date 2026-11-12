// Offline regeneration: requires librsvg's rsvg-convert on PATH.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
execFileSync("rsvg-convert", [
  "--output", fileURLToPath(new URL("../docs/public/og-image.png", import.meta.url)),
  fileURLToPath(new URL("../docs/public/og-image.svg", import.meta.url)),
], { stdio: "inherit" });
