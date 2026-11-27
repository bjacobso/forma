import { describe, expect, it } from "vitest";
import {
  buildDefinitionIndexFromSources,
  type DefinitionIndexSource,
} from "../../src/store/index-builder.js";
import {
  exportSnapshotToSources,
  importSourcesAsTransaction,
  type ProjectionSnapshot,
} from "../../src/store/projection.js";
import type { DefHash, DefinitionIndex, DefinitionRecord, PresentationMeta } from "../../src/store/types.js";

function snapshotFromIndex(
  index: DefinitionIndex,
  hash = "snap:v1:base",
): ProjectionSnapshot {
  const bindings = new Map<string, DefHash>();
  for (const record of index.definitions.values()) {
    bindings.set(record.qualifiedName, record.hash);
  }
  return {
    hash,
    parent: null,
    bindings,
    metadata: new Map(index.metadata),
    languageProfile: index.languageProfile,
  };
}

describe("RFC 0029 Stage 2: lossless .lisp / Git projection", () => {
  it("round-trips unchanged definitions verbatim without losing formatting, comments, docstrings, or source spans", () => {
    const sources: DefinitionIndexSource[] = [
      {
        id: "math.lisp",
        source: `(define (add   x
               y)
  "Adds two integers"
  ; preserve this inline comment
  (+   x
       y))

(define (double n)
  "Doubles a number"
  (add n n))
`,
      },
    ];

    const index = buildDefinitionIndexFromSources(sources);
    const snapshot = snapshotFromIndex(index);

    // Export without originalSources: uses PresentationMeta.authoredSource & span order
    const exported = exportSnapshotToSources(snapshot, index);
    expect(exported).toHaveLength(1);
    expect(exported[0]!.id).toBe("math.lisp");
    expect(exported[0]!.source).toBe(sources[0]!.source);

    // Re-indexing preserves exact spans and DefHashes
    const reindexed = buildDefinitionIndexFromSources(exported);
    for (const [qName, hash] of snapshot.bindings) {
      expect(reindexed.bindings.get(qName)).toBe(hash);
      expect(reindexed.metadata.get(hash)?.span).toEqual(index.metadata.get(hash)?.span);
      expect(reindexed.metadata.get(hash)?.docstring).toBe(index.metadata.get(hash)?.docstring);
    }

    // Re-importing produces a zero-operation minimal delta
    const proposal = importSourcesAsTransaction(snapshot, index, exported);
    expect(proposal.baseSnapshot).toBe(snapshot.hash);
    expect(proposal.operationClass).toBe("impl-edit");
    expect(proposal.operations).toEqual([]);
  });

  it("preserves file-level comments, whitespace, and exact spans on unchanged modules and partial edits when originalSources is provided", () => {
    const originalMath = `; ==========================================
; Module header comment — must stay intact
; ==========================================

(define (add x y)
  ; comment inside add
  (+ x y))

; Inter-definition comment
(define (mul x y)
  (* x y))
`;

    const sources: DefinitionIndexSource[] = [{ id: "math.lisp", source: originalMath }];
    const baseIndex = buildDefinitionIndexFromSources(sources);
    const baseSnapshot = snapshotFromIndex(baseIndex);

    // 1. Unchanged module: byte-for-byte identical
    const unchangedExport = exportSnapshotToSources(baseSnapshot, baseIndex, {
      originalSources: sources,
    });
    expect(unchangedExport[0]!.source).toBe(originalMath);

    // 2. Partial edit: update only `mul`, keep `add` and all surrounding comments intact
    const updatedIndex = buildDefinitionIndexFromSources([
      {
        id: "math.lisp",
        source: `(define (add x y)
  ; comment inside add
  (+ x y))

(define (mul x y)
  (* x (* y 1)))
`,
      },
    ]);
    const mulNewHash = updatedIndex.bindings.get("math.lisp::mul")!;
    const mergedDefs = new Map(baseIndex.definitions);
    mergedDefs.set(mulNewHash, updatedIndex.definitions.get(mulNewHash)!);
    const mergedMeta = new Map(baseIndex.metadata);
    mergedMeta.set(mulNewHash, updatedIndex.metadata.get(mulNewHash)!);

    const nextBindings = new Map(baseSnapshot.bindings);
    nextBindings.set("math.lisp::mul", mulNewHash);
    const nextSnapshot: ProjectionSnapshot = {
      ...baseSnapshot,
      hash: "snap:v1:next",
      parent: baseSnapshot.hash,
      bindings: nextBindings,
      metadata: mergedMeta,
    };
    const mergedIndex: DefinitionIndex = {
      ...baseIndex,
      definitions: mergedDefs,
      metadata: mergedMeta,
    };

    const partialExport = exportSnapshotToSources(nextSnapshot, mergedIndex, {
      originalSources: sources,
    });
    const out = partialExport[0]!.source;

    // File header, inter-definition comment, and `add` span remain untouched
    expect(out).toContain("; Module header comment — must stay intact");
    expect(out).toContain("; Inter-definition comment");
    const addSpan = baseIndex.metadata.get(baseSnapshot.bindings.get("math.lisp::add")!)!.span!;
    expect(out.slice(addSpan.start, addSpan.end)).toBe(
      originalMath.slice(addSpan.start, addSpan.end),
    );
    expect(out).toContain("(* x (* y 1))");
  });

  it("projects O(1) renamed bindings cleanly, rewriting free caller references while respecting shadowed locals", () => {
    const sources: DefinitionIndexSource[] = [
      {
        id: "math.lisp",
        source: `(define (add x y)
  "Adds two values"
  ; keep comment
  (+ x y))

(define (double n)
  (add n n))

(define (shadowed add)
  (+ add 1))
`,
      },
    ];

    const baseIndex = buildDefinitionIndexFromSources(sources);
    const baseSnapshot = snapshotFromIndex(baseIndex);
    const addHash = baseSnapshot.bindings.get("math.lisp::add")!;

    // Simulate an O(1) rename in the snapshot: `add` -> `sum` without rehashing `double`
    const renamedBindings = new Map(baseSnapshot.bindings);
    renamedBindings.delete("math.lisp::add");
    renamedBindings.set("math.lisp::sum", addHash);
    const renamedSnapshot: ProjectionSnapshot = {
      ...baseSnapshot,
      hash: "snap:v1:renamed",
      parent: baseSnapshot.hash,
      bindings: renamedBindings,
    };

    const exported = exportSnapshotToSources(renamedSnapshot, baseIndex);
    const text = exported[0]!.source;

    // Declaration header renamed while preserving docstring and inline comment
    expect(text).toContain('(define (sum x y)\n  "Adds two values"\n  ; keep comment\n  (+ x y))');
    // Free reference in `double` updated from `add` to `sum`
    expect(text).toContain("(define (double n)\n  (sum n n))");
    // Local parameter named `add` in `shadowed` MUST NOT be rewritten
    expect(text).toContain("(define (shadowed add)\n  (+ add 1))");

    // Re-importing the renamed projection against `baseSnapshot` yields ONLY a single `rename` op
    const proposal = importSourcesAsTransaction(baseSnapshot, baseIndex, exported);
    expect(proposal.operationClass).toBe("impl-edit");
    expect(proposal.operations).toEqual([
      {
        kind: "rename",
        from: "math.lisp::add",
        to: "math.lisp::sum",
        displayName: "sum",
      },
    ]);
  });

  it("emits cleanly formatted source for synthesized definitions without authoredSource", () => {
    const synthHash = "def:v1:0000000000000000000000000000000000000000000000000000000000000001";
    const meta: PresentationMeta = {
      displayName: "greeting",
      qualifiedName: "synth.lisp::greeting",
      moduleId: "synth.lisp",
      docstring: "Synthesized greeting",
    };
    const record: DefinitionRecord = {
      hash: synthHash,
      kind: "define",
      canonicalForm: "synth",
      qualifiedName: "synth.lisp::greeting",
      name: "greeting",
      moduleId: "synth.lisp",
      signature: "String",
      requirements: [],
      errors: [],
      languageProfile: "forma-core-v1",
      dependencies: [],
      formDependencies: [],
      opaqueRefs: [],
      meta,
    };
    const index: DefinitionIndex = {
      definitions: new Map([[synthHash, record]]),
      bindings: new Map([
        ["synth.lisp::greeting", synthHash],
        ["greeting", synthHash],
      ]),
      byName: new Map([["greeting", [synthHash]]]),
      dependents: new Map([[synthHash, []]]),
      metadata: new Map([[synthHash, meta]]),
      languageProfile: "forma-core-v1",
    };
    const snapshot = snapshotFromIndex(index);

    const exported = exportSnapshotToSources(snapshot, index);
    expect(exported).toHaveLength(1);
    expect(exported[0]!.id).toBe("synth.lisp");
    expect(exported[0]!.source).toContain('(define greeting "Synthesized greeting")');

    // Synthesized source must parse and index cleanly
    const reindexed = buildDefinitionIndexFromSources(exported);
    expect(reindexed.bindings.get("synth.lisp::greeting")).toBeDefined();
  });

  it("imports edited .lisp sources as minimal add, update, rename, move, and remove operations", () => {
    const baseSources: DefinitionIndexSource[] = [
      {
        id: "a.lisp",
        source: `(define (keep x) (+ x 1))

(define (modify x) (+ x 2))

(define (old-name x) (* x 3))

(define (movable x) (- x 4))

(define (obsolete x) (+ x 5))
`,
      },
      {
        id: "b.lisp",
        source: `(define (other x) (+ x 10))
`,
      },
    ];

    const baseIndex = buildDefinitionIndexFromSources(baseSources);
    const baseSnapshot = snapshotFromIndex(baseIndex);

    const editedSources: DefinitionIndexSource[] = [
      {
        id: "a.lisp",
        source: `
; formatting & comment edit only on keep -> must produce ZERO ops for keep!
(define (keep   x)
  "Now documented"
  (+   x   1))

(define (modify x) (+ x 20))

(define (new-name x) (* x 3))

(define (added x) (* x 9))
`,
      },
      {
        id: "b.lisp",
        source: `(define (other x) (+ x 10))

(define (movable x) (- x 4))
`,
      },
    ];

    const proposal = importSourcesAsTransaction(baseSnapshot, baseIndex, editedSources, {
      branch: "feature/edits",
      message: "Import edited .lisp files",
      author: "agent-1",
    });

    expect(proposal.branch).toBe("feature/edits");
    expect(proposal.baseSnapshot).toBe(baseSnapshot.hash);
    expect(proposal.message).toBe("Import edited .lisp files");
    expect(proposal.author).toBe("agent-1");
    expect(proposal.operationClass).toBe("impl-edit");

    // Verify exact minimal delta (no op for `keep` or `other`)
    const kinds = proposal.operations.map((op) => {
      switch (op.kind) {
        case "rename":
          return `rename:${op.from}->${op.to}`;
        case "move":
          return `move:${op.from}->${op.toModuleId}`;
        default:
          return `${op.kind}:${op.qualifiedName}`;
      }
    });

    expect(kinds).toEqual([
      "rename:a.lisp::old-name->a.lisp::new-name",
      "move:a.lisp::movable->b.lisp",
      "add:a.lisp::added",
      "update:a.lisp::modify",
      "remove:a.lisp::obsolete",
    ]);

    // When `includeMetadataOnlyUpdates` is enabled, formatting/docstring edits on `keep` emit an update
    const withMeta = importSourcesAsTransaction(baseSnapshot, baseIndex, editedSources, {
      includeMetadataOnlyUpdates: true,
    });
    expect(
      withMeta.operations.some((op) => op.kind === "update" && op.qualifiedName === "a.lisp::keep"),
    ).toBe(true);
  });

  it("classifies test, refined-contract, and law edits as requirement-edit vs impl-edit", () => {
    const baseSources: DefinitionIndexSource[] = [
      {
        id: "domain.lisp",
        source: `(define (inc x) (+ x 1))

(type PositiveInt (refine Int (fn [n] (> n 0))))

(define inc-monotonic (law (> (inc 1) 1)))

(test "inc adds one" (= (inc 1) 2))
`,
      },
    ];

    const baseIndex = buildDefinitionIndexFromSources(baseSources, { typecheck: false });
    const baseSnapshot = snapshotFromIndex(baseIndex);

    // 1. Pure implementation edit -> "impl-edit"
    const implEdited: DefinitionIndexSource[] = [
      {
        id: "domain.lisp",
        source: baseSources[0]!.source.replace("(+ x 1)", "(+ 1 x)"),
      },
    ];
    const implProposal = importSourcesAsTransaction(baseSnapshot, baseIndex, implEdited, {
      indexOptions: { typecheck: false },
    });
    expect(implProposal.operationClass).toBe("impl-edit");
    expect(implProposal.operations).toHaveLength(1);
    expect(implProposal.operations[0]!.kind).toBe("update");

    // 2. Editing a `test` -> "requirement-edit"
    const testEdited: DefinitionIndexSource[] = [
      {
        id: "domain.lisp",
        source: baseSources[0]!.source.replace("(= (inc 1) 2)", "(= (inc 2) 3)"),
      },
    ];
    const testProposal = importSourcesAsTransaction(baseSnapshot, baseIndex, testEdited, {
      indexOptions: { typecheck: false },
    });
    expect(testProposal.operationClass).toBe("requirement-edit");

    // 3. Deleting a `test` -> "requirement-edit"
    const testRemoved: DefinitionIndexSource[] = [
      {
        id: "domain.lisp",
        source: baseSources[0]!.source.replace('(test "inc adds one" (= (inc 1) 2))', ""),
      },
    ];
    const testRemoveProposal = importSourcesAsTransaction(baseSnapshot, baseIndex, testRemoved, {
      indexOptions: { typecheck: false },
    });
    expect(testRemoveProposal.operationClass).toBe("requirement-edit");
    expect(testRemoveProposal.operations).toEqual([
      { kind: "remove", qualifiedName: "domain.lisp::inc adds one" },
    ]);

    // 4. Editing a refined contract -> "requirement-edit"
    const contractEdited: DefinitionIndexSource[] = [
      {
        id: "domain.lisp",
        source: baseSources[0]!.source.replace("(> n 0)", "(>= n 0)"),
      },
    ];
    const contractProposal = importSourcesAsTransaction(baseSnapshot, baseIndex, contractEdited, {
      indexOptions: { typecheck: false },
    });
    expect(contractProposal.operationClass).toBe("requirement-edit");

    // 5. Editing a verification `law` -> "requirement-edit"
    const lawEdited: DefinitionIndexSource[] = [
      {
        id: "domain.lisp",
        source: baseSources[0]!.source.replace("(> (inc 1) 1)", "(>= (inc 1) 1)"),
      },
    ];
    const lawProposal = importSourcesAsTransaction(baseSnapshot, baseIndex, lawEdited, {
      indexOptions: { typecheck: false },
    });
    expect(lawProposal.operationClass).toBe("requirement-edit");
  });
});
