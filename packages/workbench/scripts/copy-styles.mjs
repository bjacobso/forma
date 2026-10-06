import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
copyFileSync(resolve(root, "src/styles.css"), resolve(root, "dist/styles.css"));
