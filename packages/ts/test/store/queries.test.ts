import { describe, expect, it } from "vitest";
import {
  findDependencies,
  findDependents,
  getDefinition,
  queryByCapability,
  queryByError,
  resolveDefinitionHash,
  resolveDefinitionHashes,
  type DefHash,
  type DefinitionIndex,
  type DefinitionRecord,
  type EvidenceSummary,
  type PresentationMeta,
} from "../../src/store/queries.js";

function makeRecord(
  partial: Partial<DefinitionRecord> & {
    readonly hash: DefHash;
    readonly name: string;
    readonly moduleId?: string;
  },
): DefinitionRecord {
  const moduleId = partial.moduleId ?? "app.lisp";
  const qualifiedName = partial.qualifiedName ?? `${moduleId}#${partial.name}`;
  const meta: PresentationMeta = partial.meta ?? {
    displayName: partial.name,
    qualifiedName,
    moduleId,
    authoredSource: `(define ${partial.name} ...)`,
  };
  return {
    hash: partial.hash,
    kind: partial.kind ?? "define",
    canonicalForm: partial.canonicalForm ?? `(define ${partial.name})`,
    qualifiedName,
    name: partial.name,
    moduleId,
    ...(partial.signature !== undefined ? { signature: partial.signature } : {}),
    ...(partial.canonicalSignature !== undefined
      ? { canonicalSignature: partial.canonicalSignature }
      : {}),
    requirements: partial.requirements ?? [],
    errors: partial.errors ?? [],
    languageProfile: partial.languageProfile ?? "forma-core-v1",
    dependencies: partial.dependencies ?? [],
    formDependencies: partial.formDependencies ?? [],
    opaqueRefs: partial.opaqueRefs ?? [],
    ...(partial.scc !== undefined ? { scc: partial.scc } : {}),
    meta,
  };
}

function buildIndex(
  records: readonly DefinitionRecord[],
  options?: {
    readonly omitDependents?: boolean;
    readonly metadataOverrides?: ReadonlyMap<DefHash, PresentationMeta>;
  },
): DefinitionIndex {
  const definitions = new Map<DefHash, DefinitionRecord>();
  const bindings = new Map<string, DefHash>();
  const byName = new Map<string, DefHash[]>();
  const dependents = new Map<DefHash, DefHash[]>();
  const metadata = new Map<DefHash, PresentationMeta>();

  for (const record of records) {
    definitions.set(record.hash, record);
    bindings.set(record.qualifiedName, record.hash);
    const list = byName.get(record.name) ?? [];
    list.push(record.hash);
    byName.set(record.name, list);
    metadata.set(record.hash, options?.metadataOverrides?.get(record.hash) ?? record.meta);
  }

  if (!options?.omitDependents) {
    for (const record of records) {
      for (const dep of [...record.dependencies, ...record.formDependencies]) {
        const list = dependents.get(dep) ?? [];
        if (!list.includes(record.hash)) list.push(record.hash);
        dependents.set(dep, list);
      }
    }
  }

  return {
    definitions,
    bindings,
    byName,
    dependents,
    metadata,
    languageProfile: "forma-core-v1",
  };
}

describe("store read-only semantic queries", () => {
  const hUser = "def:v1:user";
  const hNotFound = "def:v1:not-found";
  const hValidation = "def:v1:validation";
  const hUsersSvc = "def:v1:users-svc";
  const hAuditSvc = "def:v1:audit-svc";
  const hForm = "def:v1:route-form";
  const hFindUser = "def:v1:find-user";
  const hSaveUser = "def:v1:save-user";
  const hHandleRequest = "def:v1:handle-request";

  const records: readonly DefinitionRecord[] = [
    makeRecord({
      hash: hUser,
      kind: "type",
      name: "User",
      moduleId: "domain.lisp",
      signature: "{:id String :name String}",
      meta: {
        displayName: "User",
        qualifiedName: "domain.lisp#User",
        moduleId: "domain.lisp",
        authoredSource: "(type User {:id String :name String})",
        docstring: "Core user record.",
      },
    }),
    makeRecord({
      hash: hNotFound,
      kind: "error",
      name: "NotFound",
      moduleId: "domain.lisp",
      signature: "(error NotFound {:id String})",
    }),
    makeRecord({
      hash: hValidation,
      kind: "error",
      name: "ValidationError",
      moduleId: "domain.lisp",
      signature: "(error ValidationError {:message String})",
    }),
    makeRecord({
      hash: hUsersSvc,
      kind: "service",
      name: "Users",
      moduleId: "services.lisp",
      dependencies: [hUser],
    }),
    makeRecord({
      hash: hAuditSvc,
      kind: "service",
      name: "Audit",
      moduleId: "services.lisp",
    }),
    makeRecord({
      hash: hForm,
      kind: "form",
      name: "route",
      moduleId: "http.lisp",
    }),
    makeRecord({
      hash: hFindUser,
      kind: "define",
      name: "find-user",
      moduleId: "app.lisp",
      signature: "(-> String (Effect User [NotFound] [Users.find]))",
      requirements: ["Users.find"],
      errors: ["NotFound"],
      dependencies: [hUser, hNotFound, hUsersSvc],
    }),
    makeRecord({
      hash: hSaveUser,
      kind: "define",
      name: "save-user",
      moduleId: "app.lisp",
      signature: "(-> User (Effect User [ValidationError] [Users.save Audit.log]))",
      requirements: ["Users.save", "Audit.log"],
      errors: ["ValidationError"],
      dependencies: [hUser, hValidation, hUsersSvc, hAuditSvc],
    }),
    makeRecord({
      hash: hHandleRequest,
      kind: "define",
      name: "handle-request",
      moduleId: "api.lisp",
      signature: "(-> String (Effect User [NotFound ValidationError] [Users.find Users.save Audit.log]))",
      requirements: ["Users.find", "Users.save", "Audit.log"],
      errors: ["NotFound", "ValidationError"],
      dependencies: [hFindUser, hSaveUser],
      formDependencies: [hForm],
    }),
  ];

  const index = buildIndex(records);

  it("getDefinition resolves by DefHash, qualified name, and short name with evidence and metadata", () => {
    const evidenceMap = new Map<DefHash, EvidenceSummary>([
      [
        hFindUser,
        {
          defHash: hFindUser,
          kinds: ["typecheck", "artifact"],
          records: [{ kind: "typecheck", ok: true }],
        },
      ],
    ]);

    const byHash = getDefinition(index, hFindUser, { evidence: evidenceMap });
    expect(byHash).toMatchObject({
      hash: hFindUser,
      kind: "define",
      name: "find-user",
      qualifiedName: "app.lisp#find-user",
      signature: "(-> String (Effect User [NotFound] [Users.find]))",
      requirements: ["Users.find"],
      errors: ["NotFound"],
      dependencies: [hUser, hNotFound, hUsersSvc],
      evidence: { defHash: hFindUser, kinds: ["typecheck", "artifact"] },
    });

    expect(getDefinition(index, "app.lisp#find-user")?.hash).toBe(hFindUser);
    expect(getDefinition(index, "find-user")?.hash).toBe(hFindUser);
    expect(getDefinition(index, "domain.lisp#User")).toMatchObject({
      authoredSource: "(type User {:id String :name String})",
      docstring: "Core user record.",
    });
    expect(getDefinition(index, "missing")).toBeUndefined();
    expect(getDefinition(index, "")).toBeUndefined();
  });

  it("getDefinition prefers index.metadata overrides and reports ambiguous short names", () => {
    const hA = "def:v1:a-id";
    const hB = "def:v1:b-id";
    const dupIndex = buildIndex(
      [
        makeRecord({ hash: hB, name: "id", moduleId: "b.lisp" }),
        makeRecord({ hash: hA, name: "id", moduleId: "a.lisp" }),
      ],
      {
        metadataOverrides: new Map([
          [
            hA,
            {
              displayName: "id",
              qualifiedName: "a.lisp#id",
              moduleId: "a.lisp",
              authoredSource: "(define id [x] x)",
              docstring: "Updated docstring",
            },
          ],
        ]),
      },
    );

    expect(resolveDefinitionHashes(dupIndex, "id")).toEqual([hA, hB]);
    expect(resolveDefinitionHash(dupIndex, "id")).toBe(hA);
    const details = getDefinition(dupIndex, "id");
    expect(details).toMatchObject({
      hash: hA,
      docstring: "Updated docstring",
      ambiguousMatches: [hA, hB],
    });
    expect(getDefinition(dupIndex, "b.lisp#id")?.ambiguousMatches).toBeUndefined();
  });

  it("findDependents returns direct and transitive dependents in deterministic order", () => {
    expect(findDependents(index, hUser).map((r) => r.name)).toEqual([
      "find-user",
      "save-user",
      "Users",
    ]);
    expect(findDependents(index, hUser, { transitive: true }).map((r) => r.name)).toEqual([
      "handle-request",
      "find-user",
      "save-user",
      "Users",
    ]);
    // Works by name as well as hash, and includes form dependents.
    expect(findDependents(index, "route").map((r) => r.name)).toEqual(["handle-request"]);
    expect(findDependents(index, "handle-request")).toEqual([]);
    expect(findDependents(index, "nonexistent")).toEqual([]);
  });

  it("findDependents falls back to scanning definitions when index.dependents is empty", () => {
    const noPrecomputed = buildIndex(records, { omitDependents: true });
    expect(findDependents(noPrecomputed, hNotFound, { transitive: true }).map((r) => r.name)).toEqual([
      "handle-request",
      "find-user",
    ]);
  });

  it("findDependencies returns direct and transitive dependencies with optional form filtering", () => {
    expect(findDependencies(index, hHandleRequest).map((r) => r.name)).toEqual([
      "find-user",
      "save-user",
      "route",
    ]);
    expect(
      findDependencies(index, hHandleRequest, { includeFormDependencies: false }).map(
        (r) => r.name,
      ),
    ).toEqual(["find-user", "save-user"]);
    expect(
      findDependencies(index, hHandleRequest, { transitive: true }).map((r) => r.name),
    ).toEqual([
      "find-user",
      "save-user",
      "NotFound",
      "User",
      "ValidationError",
      "route",
      "Audit",
      "Users",
    ]);
    expect(findDependencies(index, "nonexistent")).toEqual([]);
  });

  it("handles mutual recursion SCC cycles without infinite loops", () => {
    const hEven = "def:v1:even";
    const hOdd = "def:v1:odd";
    const hCaller = "def:v1:caller";
    const scc = { sccHash: "scc:v1:parity", memberCount: 2 };
    const cyclicIndex = buildIndex([
      makeRecord({
        hash: hEven,
        name: "even?",
        dependencies: [hOdd],
        scc: { ...scc, memberIndex: 0 },
      }),
      makeRecord({
        hash: hOdd,
        name: "odd?",
        dependencies: [hEven],
        scc: { ...scc, memberIndex: 1 },
      }),
      makeRecord({
        hash: hCaller,
        name: "check-parity",
        dependencies: [hEven],
      }),
    ]);

    expect(findDependents(cyclicIndex, hEven, { transitive: true }).map((r) => r.name)).toEqual([
      "check-parity",
      "odd?",
    ]);
    expect(
      findDependents(cyclicIndex, hEven, { transitive: true, includeSelf: true }).map(
        (r) => r.name,
      ),
    ).toEqual(["check-parity", "even?", "odd?"]);
    expect(findDependencies(cyclicIndex, hEven, { transitive: true }).map((r) => r.name)).toEqual([
      "odd?",
    ]);
    expect(
      findDependencies(cyclicIndex, hEven, { transitive: true, includeSelf: true }).map(
        (r) => r.name,
      ),
    ).toEqual(["even?", "odd?"]);
  });

  it("queryByCapability matches exact operations, service prefixes, and wildcards", () => {
    expect(queryByCapability(index, "Users.find").map((r) => r.name)).toEqual([
      "handle-request",
      "find-user",
    ]);
    expect(queryByCapability(index, "Users").map((r) => r.name)).toEqual([
      "handle-request",
      "find-user",
      "save-user",
    ]);
    expect(queryByCapability(index, "Audit.*").map((r) => r.name)).toEqual([
      "handle-request",
      "save-user",
    ]);
    expect(queryByCapability(index, "Missing")).toEqual([]);
    expect(queryByCapability(index, "   ")).toEqual([]);
  });

  it("queryByError matches exact and module-qualified error names", () => {
    expect(queryByError(index, "NotFound").map((r) => r.name)).toEqual([
      "handle-request",
      "find-user",
    ]);
    expect(queryByError(index, "ValidationError").map((r) => r.name)).toEqual([
      "handle-request",
      "save-user",
    ]);
    const qualifiedIndex = buildIndex([
      makeRecord({
        hash: "def:v1:q1",
        name: "op",
        errors: ["domain/NotFound"],
      }),
    ]);
    expect(queryByError(qualifiedIndex, "NotFound").map((r) => r.name)).toEqual(["op"]);
    expect(queryByError(qualifiedIndex, "domain/NotFound").map((r) => r.name)).toEqual(["op"]);
    expect(queryByError(qualifiedIndex, "other/NotFound")).toEqual([]);
    expect(queryByError(index, "")).toEqual([]);
  });
});
