import { cp, mkdir, rm } from "node:fs/promises";

const output = new URL("../dist-site/", import.meta.url);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(new URL("../dist-docs/", import.meta.url), output, { recursive: true });
await cp(new URL("../apps/website/dist/", import.meta.url), new URL("playground/", output), {
  recursive: true,
});
