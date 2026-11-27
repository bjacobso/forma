import { describe, expect, it } from "vitest";
import { AnalysisWorkspace } from "../../src/analysis/workspace.js";
import { resolveModuleGraph, sourceModuleResolver } from "../../src/modules/graph.js";
import {
  buildDefinitionIndexFromModuleGraph,
  buildDefinitionIndexFromSources,
  buildDefinitionIndexFromWorkspace,
} from "../../src/store/index-builder.js";
import {
  DEF_HASH_VERSION,
  SCC_HASH_VERSION,
  type OpaqueBoundaryRef,
} from "../../src/store/types.js";

function singleDefHash(source: string, name: string, options = {}) {
  const index = buildDefinitionIndexFromSources([{ id: "main.lisp", source }], options);
  const hash = index.bindings.get(name);
  expect(hash, `expected definition '${name}' in index`).toBeDefined();
  const record = index.definitions.get(hash!);
  expect(record).toBeDefined();
  return { hash: hash!, record: record!, index };
}

describe("RFC 0029 Stage 0: canonical DefHash & DefinitionIndex", () => {
  it("produces tagged SHA-256 DefHash values and is invariant to formatting and comments", () => {
    const clean = singleDefHash(`(define (add x y) (+ x y))`, "add");
    const formatted = singleDefHash(
      `
      ; Leading comment explaining add
      (define (add   x
                     y)
        ; Inline comment
        (+   x
             y))
      `,
      "add",
    );

    expect(clean.hash).toMatch(new RegExp(`^${DEF_HASH_VERSION}:[0-9a-f]{64}$`));
    expect(formatted.hash).toBe(clean.hash);
    expect(formatted.record.meta.authoredSource).not.toBe(clean.record.meta.authoredSource);
  });

  it("excludes leading docstrings and :doc metadata from DefHash while keeping returned strings semantic", () => {
    const noDoc = singleDefHash(`(define (add x y) (+ x y))`, "add");
    const withDoc1 = singleDefHash(`(define (add x y) "Adds two numbers" (+ x y))`, "add");
    const withDoc2 = singleDefHash(`(define (add x y) "Sums x and y" (+ x y))`, "add");

    expect(withDoc1.hash).toBe(noDoc.hash);
    expect(withDoc2.hash).toBe(noDoc.hash);
    expect(withDoc1.record.meta.docstring).toBe("Adds two numbers");
    expect(withDoc2.record.meta.docstring).toBe("Sums x and y");

    // Returning a string literal IS semantic and must change DefHash
    const greet1 = singleDefHash(`(define (greet x) "hello")`, "greet");
    const greet2 = singleDefHash(`(define (greet x) "goodbye")`, "greet");
    expect(greet1.hash).not.toBe(greet2.hash);

    // :doc metadata on a form descriptor is presentation metadata and excluded from DefHash
    const form1 = singleDefHash(
      `(form (widget name :doc "First doc") {:name name})`,
      "widget",
      { typecheck: false },
    );
    const form2 = singleDefHash(
      `(form (widget name :doc "Updated doc") {:name name})`,
      "widget",
      { typecheck: false },
    );
    expect(form1.hash).toBe(form2.hash);
  });

  it("is alpha-equivalent across local parameter, let-binding, and display-name renames", () => {
    const a = singleDefHash(
      `(define (calc x y) (let [sum (+ x y) dbl (* sum 2)] (+ dbl x)))`,
      "calc",
    );
    const b = singleDefHash(
      `(define (compute p q) (let [s (+ p q) d (* s 2)] (+ d p)))`,
      "compute",
    );

    expect(b.hash).toBe(a.hash);
    expect(a.record.meta.displayName).toBe("calc");
    expect(b.record.meta.displayName).toBe("compute");

    // Swapping which parameter is returned MUST change DefHash
    const first = singleDefHash(`(define (pick x y) x)`, "pick");
    const second = singleDefHash(`(define (pick x y) y)`, "pick");
    expect(first.hash).not.toBe(second.hash);
  });

  it("canonicalizes record field order in both values and type annotations", () => {
    const rec1 = singleDefHash(`(define (mk x y) {:a x :b y})`, "mk");
    const rec2 = singleDefHash(`(define (mk p q) {:b q :a p})`, "mk");
    expect(rec2.hash).toBe(rec1.hash);

    const typed1 = singleDefHash(
      `
      (: mk (-> Int String {:a Int :b String}))
      (define (mk x y) {:a x :b y})
      `,
      "mk",
    );
    const typed2 = singleDefHash(
      `
      (: mk (-> Int String {:b String :a Int}))
      (define (mk p q) {:b q :a p})
      `,
      "mk",
    );
    expect(typed2.hash).toBe(typed1.hash);
  });

  it("changes DefHash on semantic, signature, dependency, prelude/form, or languageProfile changes", () => {
    const add = singleDefHash(`(define (op x y) (+ x y))`, "op");
    const sub = singleDefHash(`(define (op x y) (- x y))`, "op");
    expect(add.hash).not.toBe(sub.hash);

    // Signature change
    const intSig = singleDefHash(
      `
      (: id (-> Int Int))
      (define (id x) x)
      `,
      "id",
    );
    const strSig = singleDefHash(
      `
      (: id (-> String String))
      (define (id x) x)
      `,
      "id",
    );
    expect(intSig.hash).not.toBe(strSig.hash);

    // Dependency body change propagates to caller's DefHash
    const idx1 = buildDefinitionIndexFromSources([
      {
        id: "app.lisp",
        source: `
          (define (helper x) (+ x 1))
          (define (caller y) (helper y))
        `,
      },
    ]);
    const idx2 = buildDefinitionIndexFromSources([
      {
        id: "app.lisp",
        source: `
          (define (helper x) (+ x 2))
          (define (caller y) (helper y))
        `,
      },
    ]);
    expect(idx1.bindings.get("helper")).not.toBe(idx2.bindings.get("helper"));
    expect(idx1.bindings.get("caller")).not.toBe(idx2.bindings.get("caller"));

    // Language profile change invalidates DefHash
    const prof1 = singleDefHash(`(define (f x) (+ x 1))`, "f", { languageProfile: "forma-core-v1" });
    const prof2 = singleDefHash(`(define (f x) (+ x 1))`, "f", { languageProfile: "forma-core-v2" });
    expect(prof1.hash).not.toBe(prof2.hash);

    // Prelude change propagates to dependent document definition
    const pre1 = buildDefinitionIndexFromSources([
      { id: "prelude.lisp", source: `(define (inc n) (+ n 1))` },
      { id: "app.lisp", source: `(define (inc2 x) (inc (inc x)))` },
    ]);
    const pre2 = buildDefinitionIndexFromSources([
      { id: "prelude.lisp", source: `(define (inc n) (+ n 10))` },
      { id: "app.lisp", source: `(define (inc2 x) (inc (inc x)))` },
    ]);
    expect(pre1.bindings.get("inc2")).not.toBe(pre2.bindings.get("inc2"));
  });

  it("hashes mutually recursive and self-recursive SCCs deterministically regardless of member names or order", () => {
    const mutual1 = buildDefinitionIndexFromSources([
      {
        id: "parity.lisp",
        source: `
          (define (even? n) (if (= n 0) true (odd? (- n 1))))
          (define (odd? n) (if (= n 0) false (even? (- n 1))))
        `,
      },
    ]);

    // Rename both members, rename parameters, AND swap declaration order
    const mutual2 = buildDefinitionIndexFromSources([
      {
        id: "parity.lisp",
        source: `
          (define (is-odd k) (if (= k 0) false (is-even (- k 1))))
          (define (is-even m) (if (= m 0) true (is-odd (- m 1))))
        `,
      },
    ]);

    const even1 = mutual1.definitions.get(mutual1.bindings.get("even?")!)!;
    const odd1 = mutual1.definitions.get(mutual1.bindings.get("odd?")!)!;
    const even2 = mutual2.definitions.get(mutual2.bindings.get("is-even")!)!;
    const odd2 = mutual2.definitions.get(mutual2.bindings.get("is-odd")!)!;

    expect(even1.scc).toBeDefined();
    expect(odd1.scc).toBeDefined();
    expect(even1.scc!.sccHash).toMatch(new RegExp(`^${SCC_HASH_VERSION}:[0-9a-f]{64}$`));
    expect(even1.scc!.sccHash).toBe(odd1.scc!.sccHash);
    expect(even1.scc!.memberCount).toBe(2);
    expect(even1.scc!.memberIndex).not.toBe(odd1.scc!.memberIndex);

    // Invariant across renaming + reordering
    expect(even2.scc!.sccHash).toBe(even1.scc!.sccHash);
    expect(even2.hash).toBe(even1.hash);
    expect(odd2.hash).toBe(odd1.hash);

    // Mutating one member changes sccHash and both member DefHashes
    const mutualMutated = buildDefinitionIndexFromSources([
      {
        id: "parity.lisp",
        source: `
          (define (even? n) (if (= n 0) true (odd? (- n 2))))
          (define (odd? n) (if (= n 0) false (even? (- n 1))))
        `,
      },
    ]);
    const evenMut = mutualMutated.definitions.get(mutualMutated.bindings.get("even?")!)!;
    const oddMut = mutualMutated.definitions.get(mutualMutated.bindings.get("odd?")!)!;
    expect(evenMut.scc!.sccHash).not.toBe(even1.scc!.sccHash);
    expect(evenMut.hash).not.toBe(even1.hash);
    expect(oddMut.hash).not.toBe(odd1.hash);

    // Self-recursion: renaming function keeps DefHash identical
    const fact1 = singleDefHash(`(define (fact n) (if (= n 0) 1 (* n (fact (- n 1)))))`, "fact");
    const fact2 = singleDefHash(`(define (factorial k) (if (= k 0) 1 (* k (factorial (- k 1)))))`, "factorial");
    expect(fact1.record.scc?.memberCount).toBe(1);
    expect(fact2.hash).toBe(fact1.hash);
  });

  it("pins opaque external/builtin boundaries by signature and runtimeDigest", () => {
    const boundaryV1 = new Map<string, OpaqueBoundaryRef>([
      [
        "ext-fetch",
        {
          kind: "external-package",
          name: "ext-fetch",
          signature: "(-> String String)",
          runtimeDigest: "npm:undici@7.0.0#sha256-aaa",
        },
      ],
    ]);
    const boundaryV2 = new Map<string, OpaqueBoundaryRef>([
      [
        "ext-fetch",
        {
          kind: "external-package",
          name: "ext-fetch",
          signature: "(-> String String)",
          runtimeDigest: "npm:undici@7.1.0#sha256-bbb",
        },
      ],
    ]);

    const src = `(define (load url) (ext-fetch url))`;
    const r1 = singleDefHash(src, "load", { typecheck: false, opaqueBoundaries: boundaryV1 });
    const r2 = singleDefHash(src, "load", { typecheck: false, opaqueBoundaries: boundaryV2 });

    expect(r1.record.opaqueRefs).toHaveLength(1);
    expect(r1.record.opaqueRefs[0]!.name).toBe("ext-fetch");
    expect(r1.hash).not.toBe(r2.hash);
  });

  it("builds dependency and reverse-dependent graphs, extracts Effect requirements/errors, and indexes ModuleGraph & AnalysisWorkspace", () => {
    const graphIndex = buildDefinitionIndexFromSources([
      {
        id: "domain.lisp",
        source: `
          (define (base x) (+ x 1))
          (define (mid x) (base x))
          (define (top x) (mid x))
        `,
      },
    ]);

    const baseHash = graphIndex.bindings.get("base")!;
    const midHash = graphIndex.bindings.get("mid")!;
    const topHash = graphIndex.bindings.get("top")!;

    expect(graphIndex.definitions.get(midHash)!.dependencies).toEqual([baseHash]);
    expect(graphIndex.definitions.get(topHash)!.dependencies).toEqual([midHash]);
    expect(graphIndex.dependents.get(baseHash)).toEqual([midHash]);
    expect(graphIndex.dependents.get(midHash)).toEqual([topHash]);
    expect(graphIndex.dependents.get(topHash)).toEqual([]);

    // Effect requirements & errors extraction (with real Forma Effect syntax & typechecking)
    const effectIndex = buildDefinitionIndexFromSources([
      {
        id: "service.lisp",
        source: `
          (error NotFound {:id String})
          (service Db
            (: get (-> String (Effect String [NotFound]))))
          (: fetch-user (-> String (Effect String [NotFound] [Db.get])))
          (define (fetch-user id)
            (do! [u (Db.get id)]
              (if (= u "")
                (fail (NotFound {:id id}))
                u)))
        `,
      },
    ]);
    const fetchHash = effectIndex.bindings.get("fetch-user")!;
    const fetchRec = effectIndex.definitions.get(fetchHash)!;
    expect(fetchRec.requirements).toContain("Db.get");
    expect(fetchRec.errors).toContain("NotFound");

    // ModuleGraph cross-module indexing
    const mainSource = {
      id: "/main.lisp",
      source: `
          (import "./math.lisp" [double])
          (export quad)
          (define (quad n) (double (double n)))
        `,
    };
    const resolver = sourceModuleResolver([
      {
        id: "/math.lisp",
        source: `
          (export double)
          (define (double x) (+ x x))
        `,
      },
      mainSource,
    ]);
    const moduleGraph = resolveModuleGraph(mainSource, resolver);
    const modIndex = buildDefinitionIndexFromModuleGraph(moduleGraph);
    const doubleHash = modIndex.bindings.get("/math.lisp::double")!;
    const quadHash = modIndex.bindings.get("/main.lisp::quad")!;
    expect(doubleHash).toBeDefined();
    expect(quadHash).toBeDefined();
    expect(modIndex.definitions.get(quadHash)!.dependencies).toContain(doubleHash);
    expect(modIndex.dependents.get(doubleHash)).toContain(quadHash);

    // AnalysisWorkspace indexing
    const ws = new AnalysisWorkspace();
    ws.setPrelude("prelude.lisp", `(define (twice x) (+ x x))`);
    ws.setDocument("app.lisp", `(define (four x) (twice (twice x)))`);
    const wsIndex = buildDefinitionIndexFromWorkspace(ws);
    const twiceHash = wsIndex.bindings.get("twice")!;
    const fourHash = wsIndex.bindings.get("four")!;
    expect(wsIndex.definitions.get(fourHash)!.dependencies).toContain(twiceHash);
    expect(wsIndex.dependents.get(twiceHash)).toContain(fourHash);
  });
});
