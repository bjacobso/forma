import { describe, expect, it } from "vitest";
import {
  checkPureMigration,
  diffContractSnapshots,
  type CodecInfo,
  type ContractOperationSig,
  type ContractSnapshot,
  type ContractTypeNode,
} from "../../src/contracts/index.js";

const JSON_REJECT: CodecInfo = {
  name: "json",
  version: "1.0",
  unknownFieldPolicy: "reject",
};

const JSON_IGNORE: CodecInfo = {
  name: "json",
  version: "1.0",
  unknownFieldPolicy: "ignore",
};

function str(refinement?: Extract<ContractTypeNode, { kind: "primitive" }>["stringRefinement"]): ContractTypeNode {
  return {
    kind: "primitive",
    primitive: "string",
    ...(refinement ? { stringRefinement: refinement } : {}),
  };
}

function int(interval?: Extract<ContractTypeNode, { kind: "primitive" }>["interval"]): ContractTypeNode {
  return {
    kind: "primitive",
    primitive: "integer",
    ...(interval ? { interval } : {}),
  };
}

function num(interval?: Extract<ContractTypeNode, { kind: "primitive" }>["interval"]): ContractTypeNode {
  return {
    kind: "primitive",
    primitive: "number",
    ...(interval ? { interval } : {}),
  };
}

function payloadSnap(
  revision: string,
  rootType: string,
  types: NonNullable<ContractSnapshot["types"]>,
  opts?: Partial<ContractSnapshot>,
): ContractSnapshot {
  return {
    revision,
    codec: JSON_REJECT,
    rootType,
    types,
    ...opts,
  };
}

function opSnap(
  revision: string,
  operations: readonly ContractOperationSig[],
  opts?: Partial<ContractSnapshot>,
): ContractSnapshot {
  return {
    revision,
    codec: JSON_REJECT,
    operations,
    ...opts,
  };
}

// ---------------------------------------------------------------------------
// Stage 1: Directional contract diffs
// ---------------------------------------------------------------------------

describe("RFC 0027 Stage 1: diffContractSnapshots", () => {
  it("treats reordered record fields as compatible in both directions", () => {
    const oldSnap = payloadSnap("v1", "User", {
      User: {
        kind: "record",
        fields: [
          { name: "id", type: str() },
          { name: "age", type: int({ min: 0, max: 150 }) },
          { name: "active", type: { kind: "primitive", primitive: "boolean" } },
        ],
      },
    });
    const newSnap = payloadSnap("v2", "User", {
      User: {
        kind: "record",
        fields: [
          { name: "active", type: { kind: "primitive", primitive: "boolean" } },
          { name: "id", type: str() },
          { name: "age", type: int({ min: 0, max: 150 }) },
        ],
      },
    });

    const report = diffContractSnapshots(oldSnap, newSnap);
    expect(report.verdict).toBe("compatible");
    expect(report.directions.backward).toBe("compatible");
    expect(report.directions.forward).toBe("compatible");
    expect(report.issues).toHaveLength(0);
  });

  it("classifies metadata-only changes separately even when irContractId changes", () => {
    const oldSnap = payloadSnap(
      "v1",
      "User",
      {
        User: {
          id: "decl:user",
          name: "User",
          metadata: { doc: "A user record" },
          type: {
            kind: "record",
            fields: [
              { name: "id", type: str(), metadata: { doc: "Old doc" } },
            ],
          },
        },
      },
      { irContractId: "sha256:old-id", metadata: { author: "alice" } },
    );
    const newSnap = payloadSnap(
      "v2",
      "User",
      {
        User: {
          id: "decl:user",
          name: "User",
          metadata: { doc: "Updated user documentation" },
          type: {
            kind: "record",
            fields: [
              { name: "id", type: str(), metadata: { doc: "New doc" } },
            ],
          },
        },
      },
      { irContractId: "sha256:new-id", metadata: { author: "bob" } },
    );

    const report = diffContractSnapshots(oldSnap, newSnap);
    expect(report.verdict).toBe("compatible");
    expect(report.contractIdChanged).toBe(true);
    expect(report.metadataOnlyChange).toBe(true);
    expect(report.metadataChanges.length).toBeGreaterThanOrEqual(3);
    expect(report.metadataChanges.some((m) => m.path === "type:User.id" && m.key === "doc")).toBe(
      true,
    );
  });

  it("matches renamed declarations by stable id or explicit renameMap, never by similar spelling alone", () => {
    // 1. Type declaration rename via explicit renameMap -> wire-compatible & metadata-only
    const oldTypeSnap = payloadSnap(
      "v1",
      "User",
      {
        User: {
          name: "User",
          type: { kind: "record", fields: [{ name: "id", type: str() }] },
        },
      },
      { irContractId: "id:1" },
    );
    const newTypeSnap = payloadSnap(
      "v2",
      "Account",
      {
        Account: {
          name: "Account",
          type: { kind: "record", fields: [{ name: "id", type: str() }] },
        },
      },
      { irContractId: "id:2" },
    );

    const typeRenameReport = diffContractSnapshots(oldTypeSnap, newTypeSnap, {
      renameMap: { User: "Account" },
    });
    expect(typeRenameReport.verdict).toBe("compatible");
    expect(typeRenameReport.metadataOnlyChange).toBe(true);

    // 2. Field rename with explicit fieldRenames -> reported as FIELD_RENAMED with spans
    const oldFieldSnap = payloadSnap("v1", "Profile", {
      Profile: {
        kind: "record",
        fields: [
          {
            name: "fullName",
            type: str(),
            span: { file: "v1.forma", startLine: 3 },
          },
        ],
      },
    });
    const newFieldSnap = payloadSnap("v2", "Profile", {
      Profile: {
        kind: "record",
        fields: [
          {
            name: "displayName",
            type: str(),
            span: { file: "v2.forma", startLine: 5 },
          },
        ],
      },
    });

    const explicitFieldReport = diffContractSnapshots(oldFieldSnap, newFieldSnap, {
      fieldRenames: { Profile: { fullName: "displayName" } },
    });
    expect(explicitFieldReport.verdict).toBe("incompatible");
    const renameIssue = explicitFieldReport.issues.find((i) => i.code === "FIELD_RENAMED");
    expect(renameIssue).toBeDefined();
    expect(renameIssue?.oldSpan?.file).toBe("v1.forma");
    expect(renameIssue?.newSpan?.file).toBe("v2.forma");

    // 3. Similar spelling (userName vs username) WITHOUT id or renameMap -> NEVER guessed as rename
    const oldSpelling = payloadSnap("v1", "Login", {
      Login: {
        kind: "record",
        fields: [{ name: "userName", type: str() }],
      },
    });
    const newSpelling = payloadSnap("v2", "Login", {
      Login: {
        kind: "record",
        fields: [{ name: "username", type: str() }],
      },
    });

    const spellingReport = diffContractSnapshots(oldSpelling, newSpelling);
    expect(spellingReport.verdict).toBe("incompatible");
    expect(spellingReport.issues.some((i) => i.code === "FIELD_RENAMED")).toBe(false);
    expect(spellingReport.issues.some((i) => i.code === "UNKNOWN_FIELD_REJECTED")).toBe(true);
    expect(spellingReport.issues.some((i) => i.code === "REQUIRED_FIELD_MISSING")).toBe(true);
  });

  it("terminates on recursive and mutually recursive types and still catches nested breaks", () => {
    const oldRec = payloadSnap("v1", "TreeNode", {
      TreeNode: {
        kind: "record",
        fields: [
          { name: "value", type: int({ min: 0, max: 100 }) },
          { name: "children", type: { kind: "array", element: { kind: "ref", target: "TreeNode" } } },
        ],
      },
    });
    const newRecCompat = payloadSnap("v2", "TreeNode", {
      TreeNode: {
        kind: "record",
        fields: [
          { name: "value", type: int({ min: 0, max: 200 }) },
          { name: "children", type: { kind: "array", element: { kind: "ref", target: "TreeNode" } } },
          { name: "label", type: str(), optional: true },
        ],
      },
    });

    const okReport = diffContractSnapshots(oldRec, newRecCompat);
    expect(okReport.verdict).toBe("compatible");
    expect(okReport.directions.backward).toBe("compatible");
    expect(okReport.directions.forward).toBe("incompatible");

    // Narrowing inside recursive node must be detected
    const newRecBroken = payloadSnap("v2", "TreeNode", {
      TreeNode: {
        kind: "record",
        fields: [
          { name: "value", type: int({ min: 10, max: 50 }) },
          { name: "children", type: { kind: "array", element: { kind: "ref", target: "TreeNode" } } },
        ],
      },
    });
    const brokenReport = diffContractSnapshots(oldRec, newRecBroken);
    expect(brokenReport.verdict).toBe("incompatible");
    expect(brokenReport.issues.some((i) => i.code === "INTERVAL_NARROWED")).toBe(true);
  });

  it("checks numeric and string refinement inclusion directionally for requests and responses", () => {
    const oldOp: ContractOperationSig = {
      name: "updateScore",
      request: {
        kind: "record",
        fields: [
          { name: "score", type: int({ min: 10, max: 50 }) },
          { name: "code", type: str({ minLength: 3, maxLength: 5 }) },
        ],
      },
      response: {
        kind: "record",
        fields: [
          { name: "rank", type: int({ min: 1, max: 100 }) },
        ],
      },
      errors: [],
      requirements: [],
    };

    // Widening request + narrowing response -> backward compatible!
    const newCompatOp: ContractOperationSig = {
      ...oldOp,
      request: {
        kind: "record",
        fields: [
          { name: "score", type: int({ min: 0, max: 100 }) },
          { name: "code", type: str({ minLength: 1, maxLength: 10 }) },
        ],
      },
      response: {
        kind: "record",
        fields: [
          { name: "rank", type: int({ min: 1, max: 50 }) },
        ],
      },
    };
    const compatReport = diffContractSnapshots(opSnap("v1", [oldOp]), opSnap("v2", [newCompatOp]));
    expect(compatReport.verdict).toBe("compatible");
    expect(compatReport.directions.request).toBe("compatible");
    expect(compatReport.directions.response).toBe("compatible");
    expect(compatReport.directions.forward).toBe("incompatible");

    // Narrowing request + widening response -> backward incompatible on both!
    const newBrokenOp: ContractOperationSig = {
      ...oldOp,
      request: {
        kind: "record",
        fields: [
          { name: "score", type: int({ min: 20, max: 40 }) },
          { name: "code", type: str({ minLength: 4, maxLength: 5 }) },
        ],
      },
      response: {
        kind: "record",
        fields: [
          { name: "rank", type: int({ min: 0, max: 200 }) },
        ],
      },
    };
    const brokenReport = diffContractSnapshots(opSnap("v1", [oldOp]), opSnap("v2", [newBrokenOp]));
    expect(brokenReport.verdict).toBe("incompatible");
    expect(brokenReport.directions.request).toBe("incompatible");
    expect(brokenReport.directions.response).toBe("incompatible");
    expect(brokenReport.issues.some((i) => i.code === "INTERVAL_NARROWED" && i.role === "request")).toBe(true);
    expect(brokenReport.issues.some((i) => i.code === "STRING_LENGTH_NARROWED" && i.role === "request")).toBe(true);
    expect(brokenReport.issues.some((i) => i.code === "INTERVAL_NARROWED" && i.role === "response")).toBe(true);
  });

  it("checks tagged union additions directionally (safe in request, breaking in response)", () => {
    const unionV1: ContractTypeNode = {
      kind: "tagged-union",
      tagField: "kind",
      variants: [
        { tag: "email", payload: { kind: "record", fields: [{ name: "to", type: str() }] } },
      ],
    };
    const unionV2: ContractTypeNode = {
      kind: "tagged-union",
      tagField: "kind",
      variants: [
        { tag: "email", payload: { kind: "record", fields: [{ name: "to", type: str() }] } },
        { tag: "sms", payload: { kind: "record", fields: [{ name: "phone", type: str() }] } },
      ],
    };

    const oldSnap = opSnap("v1", [
      { name: "notify", request: unionV1, response: unionV1, errors: [], requirements: [] },
    ]);
    const newReqExpanded = opSnap("v2", [
      { name: "notify", request: unionV2, response: unionV1, errors: [], requirements: [] },
    ]);
    const newRespExpanded = opSnap("v2", [
      { name: "notify", request: unionV1, response: unionV2, errors: [], requirements: [] },
    ]);

    const reqRep = diffContractSnapshots(oldSnap, newReqExpanded);
    expect(reqRep.verdict).toBe("compatible");
    expect(reqRep.directions.request).toBe("compatible");

    const respRep = diffContractSnapshots(oldSnap, newRespExpanded);
    expect(respRep.verdict).toBe("incompatible");
    expect(respRep.directions.response).toBe("incompatible");
    expect(respRep.issues.some((i) => i.code === "TAG_NOT_ACCEPTED" && i.role === "response")).toBe(true);
  });

  it("distinguishes optional (absent) from nullable (null) orthogonally", () => {
    const optionalNotNullable: ContractTypeNode = {
      kind: "record",
      fields: [{ name: "nickname", type: str(), optional: true, nullable: false }],
    };
    const requiredNullable: ContractTypeNode = {
      kind: "record",
      fields: [{ name: "nickname", type: str(), optional: false, nullable: true }],
    };

    const r1 = diffContractSnapshots(
      payloadSnap("v1", "P", { P: optionalNotNullable }),
      payloadSnap("v2", "P", { P: requiredNullable }),
    );
    expect(r1.verdict).toBe("incompatible");
    expect(r1.issues.some((i) => i.code === "FIELD_OPTIONALITY_NARROWED")).toBe(true);

    const r2 = diffContractSnapshots(
      payloadSnap("v1", "P", { P: requiredNullable }),
      payloadSnap("v2", "P", { P: optionalNotNullable }),
    );
    expect(r2.verdict).toBe("incompatible");
    expect(r2.issues.some((i) => i.code === "FIELD_NULLABILITY_NARROWED")).toBe(true);

    // Option representation mismatch (nullable vs absent)
    const optNullable: ContractTypeNode = { kind: "option", inner: str(), representation: "nullable" };
    const optAbsent: ContractTypeNode = { kind: "option", inner: str(), representation: "absent" };
    const r3 = diffContractSnapshots(
      payloadSnap("v1", "O", { O: optNullable }),
      payloadSnap("v2", "O", { O: optAbsent }),
    );
    expect(r3.verdict).toBe("incompatible");
    expect(r3.issues.some((i) => i.code === "OPTION_REPRESENTATION_MISMATCH")).toBe(true);
  });

  it("respects both unknown-field policies ('reject' vs 'ignore')", () => {
    const reqV1: ContractTypeNode = {
      kind: "record",
      fields: [
        { name: "id", type: str() },
        { name: "legacyFlag", type: { kind: "primitive", primitive: "boolean" } },
      ],
    };
    const reqV2: ContractTypeNode = {
      kind: "record",
      fields: [{ name: "id", type: str() }],
    };

    const oldOp: ContractOperationSig = {
      name: "submit",
      request: reqV1,
      response: { kind: "record", fields: [{ name: "ok", type: { kind: "primitive", primitive: "boolean" } }] },
      errors: [],
      requirements: [],
    };
    const newOp: ContractOperationSig = {
      ...oldOp,
      request: reqV2,
    };

    // Under "reject", removing a request field breaks old clients that still send legacyFlag
    const rejectReport = diffContractSnapshots(
      opSnap("v1", [oldOp], { codec: JSON_REJECT }),
      opSnap("v2", [newOp], { codec: JSON_REJECT }),
    );
    expect(rejectReport.verdict).toBe("incompatible");
    expect(rejectReport.issues.some((i) => i.code === "UNKNOWN_FIELD_REJECTED")).toBe(true);

    // Under "ignore", new server ignores legacyFlag -> backward compatible
    const ignoreReport = diffContractSnapshots(
      opSnap("v1", [oldOp], { codec: JSON_IGNORE }),
      opSnap("v2", [newOp], { codec: JSON_IGNORE }),
    );
    expect(ignoreReport.verdict).toBe("compatible");
    expect(ignoreReport.directions.request).toBe("compatible");
    expect(ignoreReport.assumptions.some((a) => a.includes("ignores unknown field"))).toBe(true);
  });

  it("detects error-set expansion and requirement-set expansion", () => {
    const oldOp: ContractOperationSig = {
      name: "charge",
      request: { kind: "record", fields: [{ name: "amount", type: int({ min: 1 }) }] },
      response: { kind: "record", fields: [{ name: "receiptId", type: str() }] },
      errors: [{ name: "Declined" }],
      requirements: ["Payments.charge"],
    };
    const newOp: ContractOperationSig = {
      ...oldOp,
      errors: [{ name: "Declined" }, { name: "RateLimited" }],
      requirements: ["Payments.charge", "Fraud.check"],
    };

    const report = diffContractSnapshots(opSnap("v1", [oldOp]), opSnap("v2", [newOp]));
    expect(report.verdict).toBe("incompatible");
    expect(report.directions.request).toBe("compatible");
    expect(report.directions.response).toBe("compatible");
    expect(report.directions.errors).toBe("incompatible");
    expect(report.directions.requirements).toBe("incompatible");
    expect(report.issues.some((i) => i.code === "ERROR_SET_EXPANDED")).toBe(true);
    expect(report.issues.some((i) => i.code === "REQUIREMENT_SET_EXPANDED")).toBe(true);
  });

  it("returns 'unknown' (never silently 'compatible') for missing graphs, unsupported codecs, opaque nodes, regex implication, and generic rows", () => {
    // Missing type graph
    const missingGraph = diffContractSnapshots(
      { revision: "v1", codec: JSON_REJECT, rootType: "Order" },
      { revision: "v2", codec: JSON_REJECT, rootType: "Order" },
    );
    expect(missingGraph.verdict).toBe("unknown");
    expect(missingGraph.issues.some((i) => i.code === "MISSING_TYPE_GRAPH")).toBe(true);

    // Unsupported codec
    const unsupCodec = diffContractSnapshots(
      payloadSnap("v1", "A", { A: str() }, { codec: { name: "protobuf", version: "3", supported: false } }),
      payloadSnap("v2", "A", { A: str() }, { codec: { name: "protobuf", version: "3", supported: false } }),
    );
    expect(unsupCodec.verdict).toBe("unknown");
    expect(unsupCodec.issues.some((i) => i.code === "UNSUPPORTED_CODEC")).toBe(true);

    // Opaque native codec node
    const opaqueNode = diffContractSnapshots(
      payloadSnap("v1", "A", { A: { kind: "opaque", codec: "custom-bin", reason: "native serializer" } }),
      payloadSnap("v2", "A", { A: { kind: "opaque", codec: "custom-bin", reason: "native serializer" } }),
    );
    expect(opaqueNode.verdict).toBe("unknown");
    expect(opaqueNode.issues.some((i) => i.code === "OPAQUE_CODEC")).toBe(true);

    // Unsupported regex implication
    const regexDiff = diffContractSnapshots(
      payloadSnap("v1", "Email", { Email: str({ pattern: "^[a-z]+@example\\.com$" }) }),
      payloadSnap("v2", "Email", { Email: str({ pattern: "^[a-z0-9._]+@example\\.com$" }) }),
    );
    expect(regexDiff.verdict).toBe("unknown");
    expect(regexDiff.issues.some((i) => i.code === "UNSUPPORTED_REGEX_IMPLICATION")).toBe(true);

    // Identical regex IS compatible
    const sameRegex = diffContractSnapshots(
      payloadSnap("v1", "Email", { Email: str({ pattern: "^[a-z]+$" }) }),
      payloadSnap("v2", "Email", { Email: str({ pattern: "^[a-z]+$" }) }),
    );
    expect(sameRegex.verdict).toBe("compatible");

    // Generic row constraint
    const genericRow = diffContractSnapshots(
      payloadSnap("v1", "R", { R: { kind: "generic-row", constraint: "Row<r>" } }),
      payloadSnap("v2", "R", { R: { kind: "generic-row", constraint: "Row<r>" } }),
    );
    expect(genericRow.verdict).toBe("unknown");
    expect(genericRow.issues.some((i) => i.code === "GENERIC_ROW_CONSTRAINT")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Stage 2: Checked pure payload migrations
// ---------------------------------------------------------------------------

describe("RFC 0027 Stage 2: checkPureMigration", () => {
  const oldUserSnap = payloadSnap(
    "v1",
    "User",
    {
      User: {
        kind: "record",
        fields: [
          { name: "fullName", type: str({ minLength: 1 }) },
          { name: "age", type: num({ min: 0, max: 150 }) },
          { name: "legacyNote", type: str(), optional: true },
        ],
      },
    },
    { irContractId: "user:v1" },
  );

  const newUserSnap = payloadSnap(
    "v2",
    "User",
    {
      User: {
        kind: "record",
        fields: [
          { name: "displayName", type: str({ minLength: 1 }) },
          { name: "age", type: int({ min: 0, max: 120 }) },
          { name: "role", type: str({ literals: ["member", "admin"] }) },
        ],
      },
    },
    { irContractId: "user:v2" },
  );

  it("validates a pure migration with independent fixtures and reports explicit information loss", () => {
    const result = checkPureMigration({
      name: "user-v1-to-v2",
      oldSnapshot: oldUserSnap,
      newSnapshot: newUserSnap,
      fieldRenames: { $: { fullName: "displayName" } },
      migrate: (oldVal: { fullName: string; age: number; legacyNote?: string }) => ({
        displayName: oldVal.fullName,
        age: Math.min(120, Math.round(oldVal.age)),
        role: "member" as const,
      }),
      fixtures: [
        {
          name: "standard-user",
          before: { fullName: "Ada Lovelace", age: 36, legacyNote: "pioneer" },
          expectedAfter: { displayName: "Ada Lovelace", age: 36, role: "member" },
        },
        {
          name: "clamped-age",
          before: { fullName: "Methuselah", age: 140.4 },
          expectedAfter: { displayName: "Methuselah", age: 120, role: "member" },
        },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.verdict).toBe("compatible");
    expect(result.implementationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.fixtureResults.every((f) => f.ok)).toBe(true);
    expect(result.caveats.length).toBeGreaterThan(0);

    // Explicit information loss reported: legacyNote dropped, age precision-loss + narrowed-interval
    // fullName was explicitly renamed to displayName so it must NOT be reported as dropped!
    expect(result.informationLoss.some((l) => l.kind === "dropped-field" && l.path === "$.legacyNote")).toBe(true);
    expect(result.informationLoss.some((l) => l.kind === "dropped-field" && l.path === "$.fullName")).toBe(false);
    expect(result.informationLoss.some((l) => l.kind === "precision-loss" && l.path === "$.age")).toBe(true);
    expect(result.informationLoss.some((l) => l.kind === "narrowed-interval" && l.path === "$.age")).toBe(true);
  });

  it("fails when informationLossPolicy is 'forbid' and fields are dropped or narrowed", () => {
    const result = checkPureMigration({
      name: "forbid-loss",
      oldSnapshot: oldUserSnap,
      newSnapshot: newUserSnap,
      informationLossPolicy: "forbid",
      migrate: (oldVal: { fullName: string; age: number }) => ({
        displayName: oldVal.fullName,
        age: Math.min(120, Math.round(oldVal.age)),
        role: "member" as const,
      }),
      fixtures: [{ name: "basic", before: { fullName: "Ada", age: 30 } }],
    });

    expect(result.ok).toBe(false);
    expect(result.verdict).toBe("incompatible");
    expect(result.errors.some((e) => e.includes("Forbidden information loss"))).toBe(true);
  });

  it("rejects invalid migration outputs and impure migrations", () => {
    // 1. Invalid output (age exceeds new max 120, role not in literals)
    const invalidOut = checkPureMigration({
      name: "bad-output",
      oldSnapshot: oldUserSnap,
      newSnapshot: newUserSnap,
      migrate: (oldVal: { fullName: string; age: number }) => ({
        displayName: oldVal.fullName,
        age: 145,
        role: "superuser",
      }),
      fixtures: [{ name: "bad", before: { fullName: "Ada", age: 30 } }],
    });
    expect(invalidOut.ok).toBe(false);
    expect(invalidOut.verdict).toBe("incompatible");
    expect(invalidOut.fixtureResults[0]?.errors.some((e) => e.includes("violates upper bound"))).toBe(true);
    expect(invalidOut.fixtureResults[0]?.errors.some((e) => e.includes("not in allowed literals"))).toBe(true);

    // 2. Non-deterministic / impure migration
    let counter = 0;
    const impure = checkPureMigration({
      name: "impure",
      oldSnapshot: oldUserSnap,
      newSnapshot: newUserSnap,
      migrate: (oldVal: { fullName: string; age: number }) => ({
        displayName: `${oldVal.fullName}-${++counter}`,
        age: 30,
        role: "member",
      }),
      fixtures: [{ name: "nondet", before: { fullName: "Ada", age: 30 } }],
    });
    expect(impure.ok).toBe(false);
    expect(impure.fixtureResults[0]?.errors.some((e) => e.includes("not deterministic/pure"))).toBe(true);
  });

  it("checks both bidirectional inverse round-trip laws over the declared domain", () => {
    const celsiusSnap = payloadSnap("v1", "Temp", {
      Temp: { kind: "record", fields: [{ name: "celsius", type: int({ min: -100, max: 100 }) }] },
    });
    const kelvinSnap = payloadSnap("v2", "Temp", {
      Temp: { kind: "record", fields: [{ name: "kelvin", type: int({ min: 173, max: 373 }) }] },
    });

    // Valid lossless bijection passes both round-trip laws
    const validBijection = checkPureMigration({
      name: "celsius-to-kelvin",
      oldSnapshot: celsiusSnap,
      newSnapshot: kelvinSnap,
      fieldRenames: { $: { celsius: "kelvin" } },
      migrate: (x: { celsius: number }) => ({ kelvin: x.celsius + 273 }),
      inverse: (y: { kelvin: number }) => ({ celsius: y.kelvin - 273 }),
      fixtures: [
        { name: "freezing", before: { celsius: 0 }, expectedAfter: { kelvin: 273 } },
        { name: "boiling", before: { celsius: 100 }, expectedAfter: { kelvin: 373 } },
      ],
      inverseFixtures: [
        { name: "room-temp", after: { kelvin: 293 }, expectedBefore: { celsius: 20 } },
      ],
    });
    expect(validBijection.ok).toBe(true);
    expect(validBijection.roundTrip?.ok).toBe(true);
    expect(validBijection.roundTrip?.cases.some((c) => c.law === "inverse-after-migrate" && c.ok)).toBe(true);
    expect(validBijection.roundTrip?.cases.some((c) => c.law === "migrate-after-inverse" && c.ok)).toBe(true);

    // Broken inverse fails round-trip laws
    const brokenInverse = checkPureMigration({
      name: "broken-inverse",
      oldSnapshot: celsiusSnap,
      newSnapshot: kelvinSnap,
      migrate: (x: { celsius: number }) => ({ kelvin: x.celsius + 273 }),
      inverse: (y: { kelvin: number }) => ({ celsius: y.kelvin - 270 }), // off by 3!
      fixtures: [{ name: "freezing", before: { celsius: 0 }, expectedAfter: { kelvin: 273 } }],
      inverseFixtures: [{ name: "room-temp", after: { kelvin: 293 } }],
    });
    expect(brokenInverse.ok).toBe(false);
    expect(brokenInverse.verdict).toBe("incompatible");
    expect(brokenInverse.roundTrip?.ok).toBe(false);
    expect(
      brokenInverse.roundTrip?.cases.some((c) => c.law === "inverse-after-migrate" && !c.ok),
    ).toBe(true);
    expect(
      brokenInverse.roundTrip?.cases.some((c) => c.law === "migrate-after-inverse" && !c.ok),
    ).toBe(true);
  });
});
