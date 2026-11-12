import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { bootstrapFromFiles } from "../src/Node.js";
import { ontologyPreludeStack } from "../src/Preludes.js";
import { bootstrapFromSources, ElaborationFailure } from "../src/Descriptor.js";
import { closestName } from "../src/Diagnostic.js";

const preludes = new URL("../../../preludes/", import.meta.url);

describe("bootstrapping preludes", () => {
  it("lists named family files and their allowed children without parsing their text", () => {
    const prelude = bootstrapFromSources([
      { sourceId: "types.lisp", source: "(type Leaf {:value Int}) (type Branch {:items (List Leaf)}) (type children Leaf)" },
      { sourceId: "leaves.lisp", source: "(form (leaf value) :types {:value Int} :ir Leaf {:value value})" },
      { sourceId: "branches.lisp", source: "(form (branch items ...) :types {:items (List children)} :ir Branch {:items items})" },
    ]);
    expect(prelude.descriptions.names()).toEqual(["Leaf", "Branch", "children", "leaf", "branch"]);
    expect([...prelude.descriptions.get("branch")!.surface!.holes.keys()]).toEqual(["items"]);
    expect(prelude.descriptions.getChildForms("branch", "items").map(f => f.name)).toEqual(["leaf"]);
    expect(prelude.descriptions.getChildForms("leaf", "value")).toEqual([]);
    expect(closestName("brnch", prelude.descriptions.names())).toBe("branch");
    expect(prelude.descriptions.get("branch")!.surface!.body.loc.sourceId).toBe("branches.lisp");
  });

  it("locates a malformed definition in the third named file", () => {
    const source = "; third file\n(__form-descriptor broken (:construct-fn missing))";
    try {
      bootstrapFromSources([
        { sourceId: "first.lisp", source: "(type Value Int)" },
        { sourceId: "second.lisp", source: "(type Other String)" },
        { sourceId: "third.lisp", source },
      ]);
      expect.fail("invalid prelude must fail bootstrap");
    } catch (error) {
      expect(error).toBeInstanceOf(ElaborationFailure);
      const diagnostic = (error as ElaborationFailure).diagnostics.find(d => d.code === "descriptor/unresolved-hook")!;
      expect(diagnostic.span?.sourceId).toBe("third.lisp");
      expect(source.slice(diagnostic.span!.startOffset, diagnostic.span!.endOffset)).toBe("(:construct-fn missing)");
    }
  });

  it("keeps Node.js modules out of the browser bootstrap", () => {
    const module = readFileSync(new URL("../src/descriptor/bootstrap.ts", import.meta.url), "utf8");
    expect(module).not.toMatch(/from "node:/);
  });

  it("reads prelude files with Node.js", () => {
    const [compiler, domain, ...additional] = ontologyPreludeStack.map(
      (name) => new URL(name, preludes).pathname,
    );
    const prelude = bootstrapFromFiles(compiler!, domain!, ...additional);
    expect(prelude.descriptions.get("entity")).toBeDefined();
  });
});
