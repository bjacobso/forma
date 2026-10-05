import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bootstrapFromFiles } from "../src/Descriptor.js";
import { ontologyPreludeStack } from "../src/Preludes.js";

const preludes = new URL("../../../preludes/", import.meta.url);

describe("bootstrapping preludes", () => {
  it("loads no Node.js module until it reads files", () => {
    const module = readFileSync(new URL("../src/descriptor/bootstrap.ts", import.meta.url), "utf8");
    expect(module).not.toMatch(/from "node:/);
  });

  it("reads prelude files with Node.js", () => {
    const [compiler, domain, ...additional] = ontologyPreludeStack.map(
      (name) => new URL(name, preludes).pathname,
    );
    const prelude = bootstrapFromFiles(compiler!, domain!, ...additional);
    expect(prelude.descriptions.get("define-entity")).toBeDefined();
  });
});
