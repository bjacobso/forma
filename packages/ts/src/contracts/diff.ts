/**
 * RFC 0027 (Stage 1): Directional, role-specific contract diff engine.
 *
 * Browser-safe: zero `node:*` imports.
 */

import { canonicalJson } from "../artifact/canonical-json.js";
import type { JsonValue } from "../artifact/artifact.js";
import type {
  CompatibilityDirection,
  CompatibilityIssue,
  CompatibilityRole,
  CompatibilityVerdict,
  ContractDiffOptions,
  ContractErrorDef,
  ContractOperationSig,
  ContractPrimitiveNode,
  ContractRecordField,
  ContractSnapshot,
  ContractTypeDecl,
  ContractTypeNode,
  ContractUnionVariant,
  DirectionalDiffReport,
  MetadataChange,
  NumericInterval,
  SourceSpan,
  StringRefinement,
  UnknownFieldPolicy,
} from "./types.js";

// ---------------------------------------------------------------------------
// Verdict lattice: incompatible > unknown > compatible
// ---------------------------------------------------------------------------

export function combineVerdicts(
  ...verdicts: readonly CompatibilityVerdict[]
): CompatibilityVerdict {
  let hasUnknown = false;
  for (const v of verdicts) {
    if (v === "incompatible") return "incompatible";
    if (v === "unknown") hasUnknown = true;
  }
  return hasUnknown ? "unknown" : "compatible";
}

// ---------------------------------------------------------------------------
// Snapshot & declaration helpers
// ---------------------------------------------------------------------------

function isTypeDecl(
  entry: ContractTypeDecl | ContractTypeNode,
): entry is ContractTypeDecl {
  return "type" in entry && "name" in entry && !("kind" in entry);
}

interface ResolvedType {
  readonly name: string;
  readonly id?: string;
  readonly node: ContractTypeNode;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly span?: SourceSpan;
}

function resolveTypeInSnapshot(
  snapshot: ContractSnapshot,
  name: string,
): ResolvedType | undefined {
  const entry = snapshot.types?.[name];
  if (!entry) return undefined;
  if (isTypeDecl(entry)) {
    return {
      name: entry.name,
      ...(entry.id !== undefined ? { id: entry.id } : {}),
      node: entry.type,
      ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
      ...(entry.span !== undefined ? { span: entry.span } : {}),
    };
  }
  return {
    name,
    node: entry,
    ...(entry.metadata !== undefined ? { metadata: entry.metadata } : {}),
    ...(entry.span !== undefined ? { span: entry.span } : {}),
  };
}

function getEffectiveContractId(snapshot: ContractSnapshot): string | undefined {
  return snapshot.irContractId ?? snapshot.contractId ?? snapshot.payloadContractId;
}

function getUnknownFieldPolicy(
  consumerSnapshot: ContractSnapshot,
  consumerRecordPolicy: UnknownFieldPolicy | undefined,
  options: ContractDiffOptions | undefined,
): UnknownFieldPolicy {
  return (
    options?.unknownFieldPolicy ??
    consumerRecordPolicy ??
    consumerSnapshot.unknownFieldPolicy ??
    consumerSnapshot.codec.unknownFieldPolicy ??
    "reject"
  );
}

function lookupFieldRename(
  options: ContractDiffOptions | undefined,
  scopePath: string,
  oldName: string,
): string | undefined {
  if (!options?.fieldRenames) return undefined;
  const direct = options.fieldRenames[scopePath]?.[oldName];
  if (direct !== undefined) return direct;
  // Also allow matching by trailing type/op segment (e.g. "User" for "type:User")
  const colonIdx = scopePath.lastIndexOf(":");
  if (colonIdx >= 0) {
    const shortScope = scopePath.slice(colonIdx + 1);
    const byShort = options.fieldRenames[shortScope]?.[oldName];
    if (byShort !== undefined) return byShort;
  }
  return undefined;
}

function lookupTagRename(
  options: ContractDiffOptions | undefined,
  scopePath: string,
  oldTag: string,
): string | undefined {
  if (!options?.tagRenames) return undefined;
  const direct = options.tagRenames[scopePath]?.[oldTag];
  if (direct !== undefined) return direct;
  const colonIdx = scopePath.lastIndexOf(":");
  if (colonIdx >= 0) {
    const shortScope = scopePath.slice(colonIdx + 1);
    const byShort = options.tagRenames[shortScope]?.[oldTag];
    if (byShort !== undefined) return byShort;
  }
  return undefined;
}

function lookupTypeRename(
  options: ContractDiffOptions | undefined,
  oldName: string,
): string | undefined {
  return options?.typeRenames?.[oldName] ?? options?.renameMap?.[oldName];
}

function lookupOpRename(
  options: ContractDiffOptions | undefined,
  oldName: string,
): string | undefined {
  return options?.operationRenames?.[oldName] ?? options?.renameMap?.[oldName];
}

function stableJson(value: unknown): string {
  try {
    return canonicalJson(value as JsonValue);
  } catch {
    return String(value);
  }
}

function collectMetadataDiffs(
  path: string,
  oldMeta: Readonly<Record<string, unknown>> | undefined,
  newMeta: Readonly<Record<string, unknown>> | undefined,
  oldSpan: SourceSpan | undefined,
  newSpan: SourceSpan | undefined,
  out: MetadataChange[],
): void {
  const keys = new Set<string>([
    ...Object.keys(oldMeta ?? {}),
    ...Object.keys(newMeta ?? {}),
  ]);
  for (const key of [...keys].sort()) {
    const ov = oldMeta?.[key];
    const nv = newMeta?.[key];
    if (stableJson(ov) !== stableJson(nv)) {
      out.push({
        path,
        key,
        oldValue: ov,
        newValue: nv,
        ...(oldSpan !== undefined ? { oldSpan } : {}),
        ...(newSpan !== undefined ? { newSpan } : {}),
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Internal subtype / compatibility comparison context
// ---------------------------------------------------------------------------

interface CompareCtx {
  readonly producerSnap: ContractSnapshot;
  readonly consumerSnap: ContractSnapshot;
  /** True when producer is `old` and consumer is `new`; false when reversed. */
  readonly producerIsOld: boolean;
  readonly role: CompatibilityRole;
  readonly direction: CompatibilityDirection;
  readonly options: ContractDiffOptions | undefined;
  readonly issues: CompatibilityIssue[];
  readonly assumptions: Set<string>;
  readonly metadataChanges: MetadataChange[];
  readonly collectMeta: boolean;
  readonly visited: Set<string>;
}

function pushIssue(
  ctx: CompareCtx,
  verdict: CompatibilityVerdict,
  code: string,
  path: string,
  message: string,
  prodSpan?: SourceSpan,
  consSpan?: SourceSpan,
  issueAssumptions?: readonly string[],
): CompatibilityVerdict {
  const oldSpan = ctx.producerIsOld ? prodSpan : consSpan;
  const newSpan = ctx.producerIsOld ? consSpan : prodSpan;
  ctx.issues.push({
    verdict,
    code,
    role: ctx.role,
    direction: ctx.direction,
    path,
    message,
    ...(oldSpan !== undefined ? { oldSpan } : {}),
    ...(newSpan !== undefined ? { newSpan } : {}),
    ...(issueAssumptions && issueAssumptions.length > 0
      ? { assumptions: issueAssumptions }
      : {}),
  });
  return verdict;
}

function acceptsNull(
  node: ContractTypeNode,
  snap: ContractSnapshot,
  seen = new Set<string>(),
): boolean {
  switch (node.kind) {
    case "primitive":
      return node.primitive === "null";
    case "literal":
      return node.value === null;
    case "option":
      return node.representation === "nullable" || node.representation === undefined;
    case "union":
      return node.members.some((m) => acceptsNull(m, snap, seen));
    case "ref": {
      if (seen.has(node.target)) return false;
      seen.add(node.target);
      const resolved = resolveTypeInSnapshot(snap, node.target);
      return resolved ? acceptsNull(resolved.node, snap, seen) : false;
    }
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Interval & string refinement inclusion
// ---------------------------------------------------------------------------

function checkNumericIntervalInclusion(
  prod: ContractPrimitiveNode,
  cons: ContractPrimitiveNode,
  path: string,
  ctx: CompareCtx,
): CompatibilityVerdict {
  const prodInt = prod.primitive === "integer" || prod.interval?.integer === true;
  const consInt = cons.primitive === "integer" || cons.interval?.integer === true;

  if (!prodInt && consInt) {
    return pushIssue(
      ctx,
      "incompatible",
      "NUMBER_TO_INTEGER_NARROWING",
      path,
      `Producer emits non-integer numbers, but consumer requires integer.`,
      prod.span,
      cons.span,
    );
  }

  const pInt: NumericInterval = prod.interval ?? {};
  const cInt: NumericInterval = cons.interval ?? {};

  let verdict: CompatibilityVerdict = "compatible";

  if (prodInt) {
    const pMin =
      pInt.min === undefined
        ? -Infinity
        : pInt.minExclusive
          ? Math.floor(pInt.min) + 1
          : Math.ceil(pInt.min);
    const pMax =
      pInt.max === undefined
        ? Infinity
        : pInt.maxExclusive
          ? Math.ceil(pInt.max) - 1
          : Math.floor(pInt.max);
    const cMin =
      cInt.min === undefined
        ? -Infinity
        : cInt.minExclusive
          ? Math.floor(cInt.min) + 1
          : Math.ceil(cInt.min);
    const cMax =
      cInt.max === undefined
        ? Infinity
        : cInt.maxExclusive
          ? Math.ceil(cInt.max) - 1
          : Math.floor(cInt.max);

    // If producer interval is non-empty, check [pMin, pMax] ⊆ [cMin, cMax]
    if (pMin <= pMax) {
      if (pMin < cMin || pMax > cMax) {
        verdict = combineVerdicts(
          verdict,
          pushIssue(
            ctx,
            "incompatible",
            "INTERVAL_NARROWED",
            path,
            `Integer interval [${pMin}, ${pMax}] is not included in consumer interval [${cMin}, ${cMax}].`,
            prod.span,
            cons.span,
          ),
        );
      }
    }
  } else {
    // Continuous real/float interval comparison
    if (cInt.min !== undefined) {
      if (
        pInt.min === undefined ||
        pInt.min < cInt.min ||
        (pInt.min === cInt.min && !pInt.minExclusive && Boolean(cInt.minExclusive))
      ) {
        verdict = combineVerdicts(
          verdict,
          pushIssue(
            ctx,
            "incompatible",
            "INTERVAL_NARROWED",
            path,
            `Numeric lower bound (${pInt.min ?? "-Infinity"}) is not within consumer lower bound (${cInt.minExclusive ? "(" : "["}${cInt.min}).`,
            prod.span,
            cons.span,
          ),
        );
      }
    }
    if (cInt.max !== undefined) {
      if (
        pInt.max === undefined ||
        pInt.max > cInt.max ||
        (pInt.max === cInt.max && !pInt.maxExclusive && Boolean(cInt.maxExclusive))
      ) {
        verdict = combineVerdicts(
          verdict,
          pushIssue(
            ctx,
            "incompatible",
            "INTERVAL_NARROWED",
            path,
            `Numeric upper bound (${pInt.max ?? "+Infinity"}) is not within consumer upper bound (${cInt.max}${cInt.maxExclusive ? ")" : "]"}).`,
            prod.span,
            cons.span,
          ),
        );
      }
    }
  }

  // multipleOf check
  if (cInt.multipleOf !== undefined) {
    if (pInt.multipleOf === undefined) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "NUMERIC_REFINEMENT_NARROWED",
          path,
          `Consumer requires multipleOf(${cInt.multipleOf}) which producer does not guarantee.`,
          prod.span,
          cons.span,
        ),
      );
    } else if (pInt.multipleOf === cInt.multipleOf) {
      // identical
    } else if (
      Number.isInteger(pInt.multipleOf) &&
      Number.isInteger(cInt.multipleOf) &&
      cInt.multipleOf > 0
    ) {
      if (pInt.multipleOf % cInt.multipleOf !== 0) {
        verdict = combineVerdicts(
          verdict,
          pushIssue(
            ctx,
            "incompatible",
            "NUMERIC_REFINEMENT_NARROWED",
            path,
            `Producer multipleOf(${pInt.multipleOf}) is not divisible by consumer multipleOf(${cInt.multipleOf}).`,
            prod.span,
            cons.span,
          ),
        );
      }
    } else {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "unknown",
          "UNSUPPORTED_NUMERIC_REFINEMENT",
          path,
          `Cannot decide divisibility between non-integer multipleOf(${pInt.multipleOf}) and multipleOf(${cInt.multipleOf}).`,
          prod.span,
          cons.span,
        ),
      );
    }
  }

  return verdict;
}

function checkStringRefinementInclusion(
  prod: ContractPrimitiveNode,
  cons: ContractPrimitiveNode,
  path: string,
  ctx: CompareCtx,
): CompatibilityVerdict {
  const pRef: StringRefinement = prod.stringRefinement ?? {};
  const cRef: StringRefinement = cons.stringRefinement ?? {};
  let verdict: CompatibilityVerdict = "compatible";

  // Effective producer length bounds (taking finite literals into account)
  const prodMinLen =
    pRef.literals && pRef.literals.length > 0
      ? Math.min(...pRef.literals.map((s) => s.length))
      : pRef.minLength;
  const prodMaxLen =
    pRef.literals && pRef.literals.length > 0
      ? Math.max(...pRef.literals.map((s) => s.length))
      : pRef.maxLength;

  if (cRef.minLength !== undefined) {
    if (prodMinLen === undefined || prodMinLen < cRef.minLength) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "STRING_LENGTH_NARROWED",
          path,
          `Producer minLength (${prodMinLen ?? 0}) is less than consumer minLength (${cRef.minLength}).`,
          prod.span,
          cons.span,
        ),
      );
    }
  }

  if (cRef.maxLength !== undefined) {
    if (prodMaxLen === undefined || prodMaxLen > cRef.maxLength) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "STRING_LENGTH_NARROWED",
          path,
          `Producer maxLength (${prodMaxLen ?? "unbounded"}) exceeds consumer maxLength (${cRef.maxLength}).`,
          prod.span,
          cons.span,
        ),
      );
    }
  }

  if (cRef.literals !== undefined) {
    const allowed = new Set(cRef.literals);
    if (pRef.literals === undefined) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "STRING_LITERAL_SET_NARROWED",
          path,
          `Producer allows arbitrary strings, but consumer restricts to literals [${cRef.literals.join(", ")}].`,
          prod.span,
          cons.span,
        ),
      );
    } else {
      const disallowed = pRef.literals.filter((lit) => !allowed.has(lit));
      if (disallowed.length > 0) {
        verdict = combineVerdicts(
          verdict,
          pushIssue(
            ctx,
            "incompatible",
            "STRING_LITERAL_SET_NARROWED",
            path,
            `Producer emits string literals [${disallowed.join(", ")}] not accepted by consumer.`,
            prod.span,
            cons.span,
          ),
        );
      }
    }
  }

  if (cRef.pattern !== undefined) {
    if (pRef.pattern === cRef.pattern) {
      // Exact same regex string: compatible
    } else if (pRef.literals !== undefined) {
      try {
        const re = new RegExp(cRef.pattern);
        const failing = pRef.literals.filter((lit) => !re.test(lit));
        if (failing.length > 0) {
          verdict = combineVerdicts(
            verdict,
            pushIssue(
              ctx,
              "incompatible",
              "STRING_PATTERN_MISMATCH",
              path,
              `Producer literals [${failing.join(", ")}] do not match consumer pattern /${cRef.pattern}/.`,
              prod.span,
              cons.span,
            ),
          );
        }
      } catch {
        verdict = combineVerdicts(
          verdict,
          pushIssue(
            ctx,
            "unknown",
            "UNSUPPORTED_REGEX_IMPLICATION",
            path,
            `Consumer regex /${cRef.pattern}/ could not be evaluated against producer literals.`,
            prod.span,
            cons.span,
          ),
        );
      }
    } else {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "unknown",
          "UNSUPPORTED_REGEX_IMPLICATION",
          path,
          `Regex implication from ${pRef.pattern !== undefined ? `/${pRef.pattern}/` : "unconstrained string"} to /${cRef.pattern}/ is unsupported and reported as unknown.`,
          prod.span,
          cons.span,
        ),
      );
    }
  }

  return verdict;
}

function literalSatisfiesPrimitive(
  value: string | number | boolean | null,
  cons: ContractPrimitiveNode,
  path: string,
  prodSpan: SourceSpan | undefined,
  ctx: CompareCtx,
): CompatibilityVerdict {
  if (typeof value === "string") {
    if (cons.primitive !== "string") {
      return pushIssue(
        ctx,
        "incompatible",
        "TYPE_MISMATCH",
        path,
        `String literal ${JSON.stringify(value)} is not assignable to ${cons.primitive}.`,
        prodSpan,
        cons.span,
      );
    }
    const syntheticProd: ContractPrimitiveNode = {
      kind: "primitive",
      primitive: "string",
      stringRefinement: {
        literals: [value],
        minLength: value.length,
        maxLength: value.length,
      },
      ...(prodSpan !== undefined ? { span: prodSpan } : {}),
    };
    return checkStringRefinementInclusion(syntheticProd, cons, path, ctx);
  }
  if (typeof value === "number") {
    if (cons.primitive !== "number" && cons.primitive !== "integer") {
      return pushIssue(
        ctx,
        "incompatible",
        "TYPE_MISMATCH",
        path,
        `Numeric literal ${value} is not assignable to ${cons.primitive}.`,
        prodSpan,
        cons.span,
      );
    }
    const isInt = Number.isInteger(value);
    const syntheticProd: ContractPrimitiveNode = {
      kind: "primitive",
      primitive: isInt ? "integer" : "number",
      interval: { min: value, max: value, integer: isInt },
      ...(prodSpan !== undefined ? { span: prodSpan } : {}),
    };
    return checkNumericIntervalInclusion(syntheticProd, cons, path, ctx);
  }
  if (typeof value === "boolean") {
    if (cons.primitive === "boolean") return "compatible";
    return pushIssue(
      ctx,
      "incompatible",
      "TYPE_MISMATCH",
      path,
      `Boolean literal ${value} is not assignable to ${cons.primitive}.`,
      prodSpan,
      cons.span,
    );
  }
  if (value === null) {
    if (cons.primitive === "null") return "compatible";
    return pushIssue(
      ctx,
      "incompatible",
      "TYPE_MISMATCH",
      path,
      `Null literal is not assignable to ${cons.primitive}.`,
      prodSpan,
      cons.span,
    );
  }
  return "incompatible";
}

// ---------------------------------------------------------------------------
// Core recursive structural type comparison: is Val(prod) ⊆ Val(cons)?
// ---------------------------------------------------------------------------

function compareNodes(
  prod: ContractTypeNode,
  cons: ContractTypeNode,
  path: string,
  ctx: CompareCtx,
): CompatibilityVerdict {
  // 1. Opaque / generic-row / unsupported nodes ALWAYS yield "unknown"
  if (prod.kind === "opaque" || cons.kind === "opaque") {
    const opaqueNode = prod.kind === "opaque" ? prod : (cons as Extract<ContractTypeNode, { kind: "opaque" }>);
    return pushIssue(
      ctx,
      "unknown",
      "OPAQUE_CODEC",
      path,
      `Opaque native codec (${opaqueNode.codec ?? "unknown"}): ${opaqueNode.reason}`,
      prod.span,
      cons.span,
    );
  }
  if (prod.kind === "generic-row" || cons.kind === "generic-row") {
    const rowNode = prod.kind === "generic-row" ? prod : (cons as Extract<ContractTypeNode, { kind: "generic-row" }>);
    return pushIssue(
      ctx,
      "unknown",
      "GENERIC_ROW_CONSTRAINT",
      path,
      `Generic row constraint '${rowNode.constraint}' is unsupported in concrete contract diffing.`,
      prod.span,
      cons.span,
    );
  }
  if (prod.kind === "unsupported" || cons.kind === "unsupported") {
    const unsupNode = prod.kind === "unsupported" ? prod : (cons as Extract<ContractTypeNode, { kind: "unsupported" }>);
    return pushIssue(
      ctx,
      "unknown",
      "UNSUPPORTED_TYPE",
      path,
      `Unsupported type construct: ${unsupNode.reason}`,
      prod.span,
      cons.span,
    );
  }

  // 2. Resolve recursive / named references with terminating visited-pair set
  if (prod.kind === "ref" || cons.kind === "ref") {
    const pKey = prod.kind === "ref" ? `ref:${prod.target}` : `inline:${prod.kind}`;
    const cKey = cons.kind === "ref" ? `ref:${cons.target}` : `inline:${cons.kind}`;
    const pairKey = `${ctx.producerIsOld ? "O2N" : "N2O"}|${pKey}|${cKey}`;
    if (prod.kind === "ref" && cons.kind === "ref") {
      if (ctx.visited.has(pairKey)) {
        // Coinductive assumption: recursive back-edge terminates cleanly
        return "compatible";
      }
      ctx.visited.add(pairKey);
    }

    let nextProd: ContractTypeNode = prod;
    let nextCons: ContractTypeNode = cons;

    if (prod.kind === "ref") {
      if (!ctx.producerSnap.types) {
        return pushIssue(
          ctx,
          "unknown",
          "MISSING_TYPE_GRAPH",
          path,
          `Missing type graph in ${ctx.producerIsOld ? "old" : "new"} snapshot while resolving ref '${prod.target}'.`,
          prod.span,
          cons.span,
        );
      }
      const resolved = resolveTypeInSnapshot(ctx.producerSnap, prod.target);
      if (!resolved) {
        return pushIssue(
          ctx,
          "unknown",
          "UNRESOLVED_TYPE_REF",
          path,
          `Unresolved type reference '${prod.target}' in ${ctx.producerIsOld ? "old" : "new"} snapshot.`,
          prod.span,
          cons.span,
        );
      }
      nextProd = resolved.node;
    }

    if (cons.kind === "ref") {
      if (!ctx.consumerSnap.types) {
        return pushIssue(
          ctx,
          "unknown",
          "MISSING_TYPE_GRAPH",
          path,
          `Missing type graph in ${ctx.producerIsOld ? "new" : "old"} snapshot while resolving ref '${cons.target}'.`,
          prod.span,
          cons.span,
        );
      }
      const resolved = resolveTypeInSnapshot(ctx.consumerSnap, cons.target);
      if (!resolved) {
        return pushIssue(
          ctx,
          "unknown",
          "UNRESOLVED_TYPE_REF",
          path,
          `Unresolved type reference '${cons.target}' in ${ctx.producerIsOld ? "new" : "old"} snapshot.`,
          prod.span,
          cons.span,
        );
      }
      nextCons = resolved.node;
    }

    // Also guard single-sided ref recursion (e.g. ref unfolding into ref)
    if (!(prod.kind === "ref" && cons.kind === "ref")) {
      const singleKey = `${pairKey}@${path}`;
      if (ctx.visited.has(singleKey)) return "compatible";
      ctx.visited.add(singleKey);
    }

    if (ctx.collectMeta && prod.kind === "ref" && cons.kind === "ref") {
      const rProd = resolveTypeInSnapshot(ctx.producerSnap, prod.target);
      const rCons = resolveTypeInSnapshot(ctx.consumerSnap, cons.target);
      if (rProd && rCons) {
        collectMetadataDiffs(
          path,
          ctx.producerIsOld ? rProd.metadata : rCons.metadata,
          ctx.producerIsOld ? rCons.metadata : rProd.metadata,
          ctx.producerIsOld ? rProd.span : rCons.span,
          ctx.producerIsOld ? rCons.span : rProd.span,
          ctx.metadataChanges,
        );
      }
    }

    return compareNodes(nextProd, nextCons, path, ctx);
  }

  // Collect node-level metadata diffs once (on the primary pass)
  if (ctx.collectMeta) {
    collectMetadataDiffs(
      path,
      ctx.producerIsOld ? prod.metadata : cons.metadata,
      ctx.producerIsOld ? cons.metadata : prod.metadata,
      ctx.producerIsOld ? prod.span : cons.span,
      ctx.producerIsOld ? cons.span : prod.span,
      ctx.metadataChanges,
    );
  }

  // 3. Producer union: every member of producer must be accepted by consumer
  if (prod.kind === "union") {
    let verdict: CompatibilityVerdict = "compatible";
    for (let i = 0; i < prod.members.length; i++) {
      const member = prod.members[i]!;
      verdict = combineVerdicts(
        verdict,
        compareNodes(member, cons, `${path}[union:${i}]`, ctx),
      );
    }
    return verdict;
  }

  // 4. Consumer union: producer must be accepted by at least one member of consumer
  if (cons.kind === "union") {
    let sawUnknown = false;
    for (const member of cons.members) {
      const probeIssues: CompatibilityIssue[] = [];
      const probeCtx: CompareCtx = {
        ...ctx,
        issues: probeIssues,
        collectMeta: false,
        visited: new Set(ctx.visited),
      };
      const memberVerdict = compareNodes(prod, member, path, probeCtx);
      if (memberVerdict === "compatible") {
        return "compatible";
      }
      if (memberVerdict === "unknown") {
        sawUnknown = true;
      }
    }
    if (sawUnknown) {
      return pushIssue(
        ctx,
        "unknown",
        "UNION_COMPATIBILITY_UNKNOWN",
        path,
        `Could not prove producer type '${prod.kind}' is included in consumer union.`,
        prod.span,
        cons.span,
      );
    }
    return pushIssue(
      ctx,
      "incompatible",
      "UNION_MEMBER_NOT_ACCEPTED",
      path,
      `Producer type '${prod.kind}' is not accepted by any member of consumer union.`,
      prod.span,
      cons.span,
    );
  }

  // 5. Option handling
  if (prod.kind === "option" && cons.kind === "option") {
    const pRep = prod.representation;
    const cRep = cons.representation;
    if (pRep !== undefined && cRep !== undefined && pRep !== cRep) {
      return pushIssue(
        ctx,
        "incompatible",
        "OPTION_REPRESENTATION_MISMATCH",
        path,
        `Option wire representation changed from '${pRep}' to '${cRep}'.`,
        prod.span,
        cons.span,
      );
    }
    return compareNodes(prod.inner, cons.inner, `${path}.option`, ctx);
  }
  if (prod.kind !== "option" && cons.kind === "option") {
    // Non-option producer -> option consumer: compatible if prod <= cons.inner
    // (or if prod is null and cons is nullable option)
    if (
      (cons.representation === "nullable" || cons.representation === undefined) &&
      acceptsNull(prod, ctx.producerSnap)
    ) {
      return "compatible";
    }
    return compareNodes(prod, cons.inner, path, ctx);
  }
  if (prod.kind === "option" && cons.kind !== "option") {
    return pushIssue(
      ctx,
      "incompatible",
      "OPTION_NARROWED_TO_REQUIRED",
      path,
      `Producer emits Option (${prod.representation ?? "nullable"}), but consumer requires non-optional '${cons.kind}'.`,
      prod.span,
      cons.span,
    );
  }

  // 6. Literals
  if (prod.kind === "literal" && cons.kind === "literal") {
    if (prod.value === cons.value) return "compatible";
    return pushIssue(
      ctx,
      "incompatible",
      "LITERAL_MISMATCH",
      path,
      `Literal ${JSON.stringify(prod.value)} does not match expected literal ${JSON.stringify(cons.value)}.`,
      prod.span,
      cons.span,
    );
  }
  if (prod.kind === "literal" && cons.kind === "primitive") {
    return literalSatisfiesPrimitive(prod.value, cons, path, prod.span, ctx);
  }
  if (prod.kind === "primitive" && cons.kind === "literal") {
    return pushIssue(
      ctx,
      "incompatible",
      "PRIMITIVE_NARROWED_TO_LITERAL",
      path,
      `Primitive '${prod.primitive}' cannot be narrowed to literal ${JSON.stringify(cons.value)}.`,
      prod.span,
      cons.span,
    );
  }

  // 7. Primitives
  if (prod.kind === "primitive" && cons.kind === "primitive") {
    const isNumProd = prod.primitive === "number" || prod.primitive === "integer";
    const isNumCons = cons.primitive === "number" || cons.primitive === "integer";
    if (isNumProd && isNumCons) {
      return checkNumericIntervalInclusion(prod, cons, path, ctx);
    }
    if (prod.primitive !== cons.primitive) {
      return pushIssue(
        ctx,
        "incompatible",
        "TYPE_MISMATCH",
        path,
        `Primitive type '${prod.primitive}' is incompatible with '${cons.primitive}'.`,
        prod.span,
        cons.span,
      );
    }
    if (prod.primitive === "string") {
      return checkStringRefinementInclusion(prod, cons, path, ctx);
    }
    return "compatible";
  }

  // 8. Records
  if (prod.kind === "record" && cons.kind === "record") {
    return compareRecords(prod.fields, cons.fields, cons.unknownFields, path, ctx);
  }

  // 9. Arrays
  if (prod.kind === "array" && cons.kind === "array") {
    let verdict: CompatibilityVerdict = "compatible";
    if (cons.minItems !== undefined) {
      if (prod.minItems === undefined || prod.minItems < cons.minItems) {
        verdict = combineVerdicts(
          verdict,
          pushIssue(
            ctx,
            "incompatible",
            "ARRAY_LENGTH_NARROWED",
            path,
            `Producer array minItems (${prod.minItems ?? 0}) is less than consumer minItems (${cons.minItems}).`,
            prod.span,
            cons.span,
          ),
        );
      }
    }
    if (cons.maxItems !== undefined) {
      if (prod.maxItems === undefined || prod.maxItems > cons.maxItems) {
        verdict = combineVerdicts(
          verdict,
          pushIssue(
            ctx,
            "incompatible",
            "ARRAY_LENGTH_NARROWED",
            path,
            `Producer array maxItems (${prod.maxItems ?? "unbounded"}) exceeds consumer maxItems (${cons.maxItems}).`,
            prod.span,
            cons.span,
          ),
        );
      }
    }
    return combineVerdicts(
      verdict,
      compareNodes(prod.element, cons.element, `${path}[]`, ctx),
    );
  }

  // 10. Tuples
  if (prod.kind === "tuple" && cons.kind === "tuple") {
    if (prod.elements.length !== cons.elements.length) {
      return pushIssue(
        ctx,
        "incompatible",
        "TUPLE_ARITY_MISMATCH",
        path,
        `Tuple arity ${prod.elements.length} does not match consumer arity ${cons.elements.length}.`,
        prod.span,
        cons.span,
      );
    }
    let verdict: CompatibilityVerdict = "compatible";
    for (let i = 0; i < prod.elements.length; i++) {
      verdict = combineVerdicts(
        verdict,
        compareNodes(prod.elements[i]!, cons.elements[i]!, `${path}[${i}]`, ctx),
      );
    }
    return verdict;
  }

  // 11. Maps
  if (prod.kind === "map" && cons.kind === "map") {
    const keyV = compareNodes(prod.key, cons.key, `${path}.<key>`, ctx);
    const valV = compareNodes(prod.value, cons.value, `${path}.<value>`, ctx);
    return combineVerdicts(keyV, valV);
  }

  // 12. Tagged unions
  if (prod.kind === "tagged-union" && cons.kind === "tagged-union") {
    if (prod.tagField !== cons.tagField) {
      return pushIssue(
        ctx,
        "incompatible",
        "TAG_FIELD_MISMATCH",
        path,
        `Tagged union discriminator field '${prod.tagField}' does not match consumer '${cons.tagField}'.`,
        prod.span,
        cons.span,
      );
    }
    return compareTaggedUnionVariants(prod.variants, cons.variants, path, ctx);
  }

  // 13. Fallback kind mismatch
  return pushIssue(
    ctx,
    "incompatible",
    "TYPE_MISMATCH",
    path,
    `Type kind '${prod.kind}' is incompatible with '${cons.kind}'.`,
    prod.span,
    cons.span,
  );
}

// ---------------------------------------------------------------------------
// Record comparison (reordering, optional vs nullable, unknown-field policy,
// stable id / explicit rename matching — never by similar spelling)
// ---------------------------------------------------------------------------

function matchRecordFields(
  prodFields: readonly ContractRecordField[],
  consFields: readonly ContractRecordField[],
  scopePath: string,
  ctx: CompareCtx,
): {
  readonly matched: Array<{
    readonly prod: ContractRecordField;
    readonly cons: ContractRecordField;
    readonly matchedBy: "id" | "rename" | "name";
  }>;
  readonly unmatchedProd: ContractRecordField[];
  readonly unmatchedCons: ContractRecordField[];
} {
  const matched: Array<{
    readonly prod: ContractRecordField;
    readonly cons: ContractRecordField;
    readonly matchedBy: "id" | "rename" | "name";
  }> = [];
  const usedCons = new Set<number>();
  const unmatchedProd: ContractRecordField[] = [];

  for (const pf of prodFields) {
    let foundIdx = -1;
    let matchedBy: "id" | "rename" | "name" = "name";

    // 1. Match by stable declaration identity
    if (pf.id !== undefined) {
      foundIdx = consFields.findIndex(
        (cf, idx) => !usedCons.has(idx) && cf.id !== undefined && cf.id === pf.id,
      );
      if (foundIdx >= 0) matchedBy = "id";
    }

    // 2. Match by explicit field rename map (direction-aware)
    if (foundIdx < 0) {
      if (ctx.producerIsOld) {
        const renamedTo = lookupFieldRename(ctx.options, scopePath, pf.name);
        if (renamedTo !== undefined) {
          foundIdx = consFields.findIndex(
            (cf, idx) => !usedCons.has(idx) && cf.name === renamedTo,
          );
          if (foundIdx >= 0) matchedBy = "rename";
        }
      } else {
        // Producer is new, consumer is old: invert rename lookup
        foundIdx = consFields.findIndex((cf, idx) => {
          if (usedCons.has(idx)) return false;
          const renamedTo = lookupFieldRename(ctx.options, scopePath, cf.name);
          return renamedTo === pf.name;
        });
        if (foundIdx >= 0) matchedBy = "rename";
      }
    }

    // 3. Match by exact wire name (never fuzzy/similar spelling)
    if (foundIdx < 0) {
      foundIdx = consFields.findIndex((cf, idx) => {
        if (usedCons.has(idx)) return false;
        if (cf.name !== pf.name) return false;
        // Do not match two fields that explicitly carry different stable IDs
        if (pf.id !== undefined && cf.id !== undefined && pf.id !== cf.id) return false;
        return true;
      });
      if (foundIdx >= 0) matchedBy = "name";
    }

    if (foundIdx >= 0) {
      usedCons.add(foundIdx);
      matched.push({ prod: pf, cons: consFields[foundIdx]!, matchedBy });
    } else {
      unmatchedProd.push(pf);
    }
  }

  const unmatchedCons: ContractRecordField[] = [];
  for (let i = 0; i < consFields.length; i++) {
    if (!usedCons.has(i)) unmatchedCons.push(consFields[i]!);
  }

  return { matched, unmatchedProd, unmatchedCons };
}

function compareRecords(
  prodFields: readonly ContractRecordField[],
  consFields: readonly ContractRecordField[],
  consRecordPolicy: UnknownFieldPolicy | undefined,
  path: string,
  ctx: CompareCtx,
): CompatibilityVerdict {
  const policy = getUnknownFieldPolicy(ctx.consumerSnap, consRecordPolicy, ctx.options);
  ctx.assumptions.add(
    `Consumer (${ctx.producerIsOld ? "new" : "old"}) unknown-field policy: ${policy}`,
  );

  const { matched, unmatchedProd, unmatchedCons } = matchRecordFields(
    prodFields,
    consFields,
    path,
    ctx,
  );

  let verdict: CompatibilityVerdict = "compatible";

  // Matched fields
  for (const { prod: pf, cons: cf, matchedBy } of matched) {
    const fieldPath = `${path}.${pf.name}`;

    if (ctx.collectMeta) {
      collectMetadataDiffs(
        fieldPath,
        ctx.producerIsOld ? pf.metadata : cf.metadata,
        ctx.producerIsOld ? cf.metadata : pf.metadata,
        ctx.producerIsOld ? pf.span : cf.span,
        ctx.producerIsOld ? cf.span : pf.span,
        ctx.metadataChanges,
      );
    }

    // Wire key rename is breaking on name-keyed wire codecs
    if (pf.name !== cf.name) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "FIELD_RENAMED",
          fieldPath,
          `Field '${pf.name}' was renamed to '${cf.name}' (matched by ${matchedBy}); wire key changed.`,
          pf.span,
          cf.span,
          [`Matched renamed field '${pf.name}' -> '${cf.name}' via ${matchedBy}`],
        ),
      );
    }

    // Optionality (key absence) — orthogonal to nullability
    const prodOptional = pf.optional === true;
    const consOptional = cf.optional === true;
    if (prodOptional && !consOptional) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "FIELD_OPTIONALITY_NARROWED",
          fieldPath,
          `Field '${pf.name}' may be absent in producer, but consumer requires the key to be present.`,
          pf.span,
          cf.span,
        ),
      );
    }

    // Nullability (explicit null value) — orthogonal to optionality
    const prodNullable = pf.nullable === true;
    const consNullable = cf.nullable === true || acceptsNull(cf.type, ctx.consumerSnap);
    if (prodNullable && !consNullable) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "FIELD_NULLABILITY_NARROWED",
          fieldPath,
          `Field '${pf.name}' may be null in producer, but consumer rejects null.`,
          pf.span,
          cf.span,
        ),
      );
    }

    verdict = combineVerdicts(verdict, compareNodes(pf.type, cf.type, fieldPath, ctx));
  }

  // Fields present in producer but absent in consumer
  for (const pf of unmatchedProd) {
    const fieldPath = `${path}.${pf.name}`;
    if (policy === "reject") {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "UNKNOWN_FIELD_REJECTED",
          fieldPath,
          `Producer may send field '${pf.name}' which consumer does not declare and rejects (unknownFields: "reject").`,
          pf.span,
          undefined,
          [`unknownFields: "reject"`],
        ),
      );
    } else {
      ctx.assumptions.add(
        `Consumer ignores unknown field '${fieldPath}' (unknownFields: "ignore")`,
      );
    }
  }

  // Fields present in consumer but absent in producer
  for (const cf of unmatchedCons) {
    const fieldPath = `${path}.${cf.name}`;
    if (cf.optional !== true) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "REQUIRED_FIELD_MISSING",
          fieldPath,
          `Consumer requires field '${cf.name}' which producer does not emit.`,
          undefined,
          cf.span,
        ),
      );
    }
  }

  return verdict;
}

// ---------------------------------------------------------------------------
// Tagged union variant comparison
// ---------------------------------------------------------------------------

function compareTaggedUnionVariants(
  prodVariants: readonly ContractUnionVariant[],
  consVariants: readonly ContractUnionVariant[],
  path: string,
  ctx: CompareCtx,
): CompatibilityVerdict {
  let verdict: CompatibilityVerdict = "compatible";
  const usedCons = new Set<number>();

  for (const pv of prodVariants) {
    let foundIdx = -1;
    let matchedBy: "id" | "rename" | "tag" = "tag";

    if (pv.id !== undefined) {
      foundIdx = consVariants.findIndex(
        (cv, idx) => !usedCons.has(idx) && cv.id !== undefined && cv.id === pv.id,
      );
      if (foundIdx >= 0) matchedBy = "id";
    }

    if (foundIdx < 0) {
      if (ctx.producerIsOld) {
        const renamedTo = lookupTagRename(ctx.options, path, pv.tag);
        if (renamedTo !== undefined) {
          foundIdx = consVariants.findIndex(
            (cv, idx) => !usedCons.has(idx) && cv.tag === renamedTo,
          );
          if (foundIdx >= 0) matchedBy = "rename";
        }
      } else {
        foundIdx = consVariants.findIndex((cv, idx) => {
          if (usedCons.has(idx)) return false;
          const renamedTo = lookupTagRename(ctx.options, path, cv.tag);
          return renamedTo === pv.tag;
        });
        if (foundIdx >= 0) matchedBy = "rename";
      }
    }

    if (foundIdx < 0) {
      foundIdx = consVariants.findIndex((cv, idx) => {
        if (usedCons.has(idx)) return false;
        if (cv.tag !== pv.tag) return false;
        if (pv.id !== undefined && cv.id !== undefined && pv.id !== cv.id) return false;
        return true;
      });
      if (foundIdx >= 0) matchedBy = "tag";
    }

    const variantPath = `${path}[tag=${pv.tag}]`;
    if (foundIdx < 0) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "TAG_NOT_ACCEPTED",
          variantPath,
          `Producer may emit tag '${pv.tag}' which consumer does not accept.`,
          pv.span,
          undefined,
        ),
      );
      continue;
    }

    usedCons.add(foundIdx);
    const cv = consVariants[foundIdx]!;

    if (ctx.collectMeta) {
      collectMetadataDiffs(
        variantPath,
        ctx.producerIsOld ? pv.metadata : cv.metadata,
        ctx.producerIsOld ? cv.metadata : pv.metadata,
        ctx.producerIsOld ? pv.span : cv.span,
        ctx.producerIsOld ? cv.span : pv.span,
        ctx.metadataChanges,
      );
    }

    if (pv.tag !== cv.tag) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "TAG_RENAMED",
          variantPath,
          `Tagged union variant '${pv.tag}' was renamed to '${cv.tag}' (matched by ${matchedBy}); wire tag changed.`,
          pv.span,
          cv.span,
        ),
      );
    }

    verdict = combineVerdicts(
      verdict,
      compareNodes(pv.payload, cv.payload, variantPath, ctx),
    );
  }

  return verdict;
}

// ---------------------------------------------------------------------------
// Operation matching & error/requirement comparison
// ---------------------------------------------------------------------------

function matchOperations(
  oldOps: readonly ContractOperationSig[],
  newOps: readonly ContractOperationSig[],
  options: ContractDiffOptions | undefined,
): {
  readonly matched: Array<{
    readonly oldOp: ContractOperationSig;
    readonly newOp: ContractOperationSig;
    readonly matchedBy: "id" | "rename" | "name";
  }>;
  readonly removed: ContractOperationSig[];
  readonly added: ContractOperationSig[];
} {
  const matched: Array<{
    readonly oldOp: ContractOperationSig;
    readonly newOp: ContractOperationSig;
    readonly matchedBy: "id" | "rename" | "name";
  }> = [];
  const usedNew = new Set<number>();
  const removed: ContractOperationSig[] = [];

  for (const oldOp of oldOps) {
    let foundIdx = -1;
    let matchedBy: "id" | "rename" | "name" = "name";

    if (oldOp.id !== undefined) {
      foundIdx = newOps.findIndex(
        (n, idx) => !usedNew.has(idx) && n.id !== undefined && n.id === oldOp.id,
      );
      if (foundIdx >= 0) matchedBy = "id";
    }

    if (foundIdx < 0) {
      const renamedTo = lookupOpRename(options, oldOp.name);
      if (renamedTo !== undefined) {
        foundIdx = newOps.findIndex(
          (n, idx) => !usedNew.has(idx) && n.name === renamedTo,
        );
        if (foundIdx >= 0) matchedBy = "rename";
      }
    }

    if (foundIdx < 0) {
      foundIdx = newOps.findIndex((n, idx) => {
        if (usedNew.has(idx)) return false;
        if (n.name !== oldOp.name) return false;
        if (oldOp.id !== undefined && n.id !== undefined && oldOp.id !== n.id) return false;
        return true;
      });
      if (foundIdx >= 0) matchedBy = "name";
    }

    if (foundIdx >= 0) {
      usedNew.add(foundIdx);
      matched.push({ oldOp, newOp: newOps[foundIdx]!, matchedBy });
    } else {
      removed.push(oldOp);
    }
  }

  const added: ContractOperationSig[] = [];
  for (let i = 0; i < newOps.length; i++) {
    if (!usedNew.has(i)) added.push(newOps[i]!);
  }

  return { matched, removed, added };
}

function compareErrorSets(
  prodErrors: readonly ContractErrorDef[],
  consErrors: readonly ContractErrorDef[],
  opPath: string,
  ctx: CompareCtx,
): CompatibilityVerdict {
  let verdict: CompatibilityVerdict = "compatible";
  const usedCons = new Set<number>();

  for (const pe of prodErrors) {
    let foundIdx = -1;
    if (pe.id !== undefined) {
      foundIdx = consErrors.findIndex(
        (ce, idx) => !usedCons.has(idx) && ce.id !== undefined && ce.id === pe.id,
      );
    }
    if (foundIdx < 0) {
      foundIdx = consErrors.findIndex((ce, idx) => {
        if (usedCons.has(idx)) return false;
        if (ce.name !== pe.name) return false;
        if (pe.id !== undefined && ce.id !== undefined && pe.id !== ce.id) return false;
        return true;
      });
    }

    const errPath = `${opPath}.errors.${pe.name}`;
    if (foundIdx < 0) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "ERROR_SET_EXPANDED",
          errPath,
          `Error '${pe.name}' is observable from producer but not in consumer's handled error set.`,
          pe.span,
          undefined,
        ),
      );
      continue;
    }

    usedCons.add(foundIdx);
    const ce = consErrors[foundIdx]!;
    if (pe.payload && ce.payload) {
      verdict = combineVerdicts(
        verdict,
        compareNodes(pe.payload, ce.payload, errPath, ctx),
      );
    } else if (pe.payload && !ce.payload) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "ERROR_PAYLOAD_ADDED",
          errPath,
          `Error '${pe.name}' carries a payload not expected by consumer.`,
          pe.span,
          ce.span,
        ),
      );
    } else if (!pe.payload && ce.payload) {
      verdict = combineVerdicts(
        verdict,
        pushIssue(
          ctx,
          "incompatible",
          "ERROR_PAYLOAD_MISSING",
          errPath,
          `Error '${pe.name}' omits payload expected by consumer.`,
          pe.span,
          ce.span,
        ),
      );
    }
  }

  return verdict;
}

function compareRequirementSets(
  newReqs: readonly string[],
  oldReqs: readonly string[],
  opPath: string,
  direction: CompatibilityDirection,
  issues: CompatibilityIssue[],
  oldSpan?: SourceSpan,
  newSpan?: SourceSpan,
): CompatibilityVerdict {
  const allowed = new Set(oldReqs);
  const added = newReqs.filter((r) => !allowed.has(r));
  if (added.length === 0) return "compatible";

  for (const req of added) {
    issues.push({
      verdict: "incompatible",
      code: "REQUIREMENT_SET_EXPANDED",
      role: "requirement",
      direction,
      path: `${opPath}.requirements.${req}`,
      message: `Operation requires new host capability '${req}' not previously granted.`,
      ...(oldSpan !== undefined ? { oldSpan } : {}),
      ...(newSpan !== undefined ? { newSpan } : {}),
    });
  }
  return "incompatible";
}

// ---------------------------------------------------------------------------
// Public entry point: diffContractSnapshots
// ---------------------------------------------------------------------------

/**
 * Compare two explicitly supplied, validated contract snapshots and return a
 * directional, role-specific compatibility report (RFC 0027 Stage 1).
 */
export function diffContractSnapshots(
  oldSnap: ContractSnapshot,
  newSnap: ContractSnapshot,
  options?: ContractDiffOptions,
): DirectionalDiffReport {
  const issues: CompatibilityIssue[] = [];
  const metadataChanges: MetadataChange[] = [];
  const assumptions = new Set<string>();

  const oldContractId = getEffectiveContractId(oldSnap);
  const newContractId = getEffectiveContractId(newSnap);
  const contractIdChanged =
    oldContractId !== undefined &&
    newContractId !== undefined &&
    oldContractId !== newContractId;

  assumptions.add(`Old codec: ${oldSnap.codec.name}@${oldSnap.codec.version}`);
  assumptions.add(`New codec: ${newSnap.codec.name}@${newSnap.codec.version}`);

  collectMetadataDiffs(
    "snapshot",
    oldSnap.metadata,
    newSnap.metadata,
    undefined,
    undefined,
    metadataChanges,
  );

  // 1. Codec support / opaqueness checks -> never silently compatible
  if (oldSnap.codec.supported === false || newSnap.codec.supported === false) {
    issues.push({
      verdict: "unknown",
      code: "UNSUPPORTED_CODEC",
      role: "codec",
      direction: "old-to-new",
      path: "codec",
      message: `Unsupported codec (${oldSnap.codec.name}@${oldSnap.codec.version} -> ${newSnap.codec.name}@${newSnap.codec.version}); compatibility is unknown.`,
    });
    return buildReport(
      oldSnap,
      newSnap,
      oldContractId,
      newContractId,
      contractIdChanged,
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      issues,
      metadataChanges,
      assumptions,
    );
  }

  if (oldSnap.codec.opaque === true || newSnap.codec.opaque === true) {
    issues.push({
      verdict: "unknown",
      code: "OPAQUE_CODEC",
      role: "codec",
      direction: "old-to-new",
      path: "codec",
      message: `Opaque native codec (${oldSnap.codec.name} -> ${newSnap.codec.name}); wire compatibility cannot be proven.`,
    });
    return buildReport(
      oldSnap,
      newSnap,
      oldContractId,
      newContractId,
      contractIdChanged,
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      issues,
      metadataChanges,
      assumptions,
    );
  }

  if (oldSnap.codec.name !== newSnap.codec.name) {
    issues.push({
      verdict: "unknown",
      code: "CODEC_MISMATCH",
      role: "codec",
      direction: "old-to-new",
      path: "codec",
      message: `Codec changed from '${oldSnap.codec.name}' to '${newSnap.codec.name}'; cross-codec wire compatibility is unknown.`,
    });
    return buildReport(
      oldSnap,
      newSnap,
      oldContractId,
      newContractId,
      contractIdChanged,
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      issues,
      metadataChanges,
      assumptions,
    );
  }

  let requestVerdict: CompatibilityVerdict = "compatible";
  let responseVerdict: CompatibilityVerdict = "compatible";
  let errorsVerdict: CompatibilityVerdict = "compatible";
  let requirementsVerdict: CompatibilityVerdict = "compatible";
  let forwardVerdict: CompatibilityVerdict = "compatible";
  let backwardVerdict: CompatibilityVerdict = "compatible";

  const hasOps =
    (oldSnap.operations && oldSnap.operations.length > 0) ||
    (newSnap.operations && newSnap.operations.length > 0);
  const hasRoot = oldSnap.rootType !== undefined || newSnap.rootType !== undefined;

  // 2. Missing graphs check
  if (!hasOps && !hasRoot) {
    issues.push({
      verdict: "unknown",
      code: "MISSING_TYPE_GRAPH",
      role: "payload",
      direction: "old-to-new",
      path: "snapshot",
      message: `Neither operations nor rootType were supplied in the snapshots; compatibility is unknown.`,
    });
    return buildReport(
      oldSnap,
      newSnap,
      oldContractId,
      newContractId,
      contractIdChanged,
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      "unknown",
      issues,
      metadataChanges,
      assumptions,
    );
  }

  // 3. Compare standalone root payload type (if specified)
  if (hasRoot) {
    if (!oldSnap.types || !newSnap.types) {
      issues.push({
        verdict: "unknown",
        code: "MISSING_TYPE_GRAPH",
        role: "payload",
        direction: "old-to-new",
        path: "root",
        message: `Missing resolved type graph in ${!oldSnap.types ? "old" : "new"} snapshot.`,
      });
      backwardVerdict = combineVerdicts(backwardVerdict, "unknown");
      forwardVerdict = combineVerdicts(forwardVerdict, "unknown");
    } else {
      const oldRootName = oldSnap.rootType;
      const expectedNewRootName =
        newSnap.rootType ??
        (oldRootName !== undefined ? lookupTypeRename(options, oldRootName) ?? oldRootName : undefined);

      const oldRoot = oldRootName ? resolveTypeInSnapshot(oldSnap, oldRootName) : undefined;
      let newRoot = expectedNewRootName
        ? resolveTypeInSnapshot(newSnap, expectedNewRootName)
        : undefined;

      // Also support matching root type by stable declaration identity
      if (!newRoot && oldRoot?.id !== undefined) {
        for (const key of Object.keys(newSnap.types)) {
          const candidate = resolveTypeInSnapshot(newSnap, key);
          if (candidate?.id !== undefined && candidate.id === oldRoot.id) {
            newRoot = candidate;
            assumptions.add(
              `Matched renamed root type '${oldRoot.name}' -> '${candidate.name}' by stable id '${oldRoot.id}'`,
            );
            break;
          }
        }
      }

      if (!oldRoot || !newRoot) {
        issues.push({
          verdict: "unknown",
          code: "MISSING_TYPE_GRAPH",
          role: "payload",
          direction: "old-to-new",
          path: "root",
          message: `Root type '${oldRootName ?? "<none>"}' / '${expectedNewRootName ?? "<none>"}' not found in snapshot type graph.`,
        });
        backwardVerdict = combineVerdicts(backwardVerdict, "unknown");
        forwardVerdict = combineVerdicts(forwardVerdict, "unknown");
      } else {
        // Check if renamed explicitly or via id (type declaration rename does not change wire data)
        if (oldRoot.name !== newRoot.name) {
          const explicitRename = lookupTypeRename(options, oldRoot.name);
          const idMatch = oldRoot.id !== undefined && oldRoot.id === newRoot.id;
          if (!idMatch && explicitRename !== newRoot.name) {
            // Two differently-named roots supplied explicitly without rename/id -> compare structurally with assumption
            assumptions.add(
              `Comparing explicit root types '${oldRoot.name}' -> '${newRoot.name}'`,
            );
          } else {
            assumptions.add(
              `Matched renamed type declaration '${oldRoot.name}' -> '${newRoot.name}' (${idMatch ? `id=${oldRoot.id}` : "explicit renameMap"})`,
            );
            metadataChanges.push({
              path: `type:${oldRoot.name}`,
              key: "name",
              oldValue: oldRoot.name,
              newValue: newRoot.name,
              ...(oldRoot.span !== undefined ? { oldSpan: oldRoot.span } : {}),
              ...(newRoot.span !== undefined ? { newSpan: newRoot.span } : {}),
            });
          }
        }

        collectMetadataDiffs(
          `type:${oldRoot.name}`,
          oldRoot.metadata,
          newRoot.metadata,
          oldRoot.span,
          newRoot.span,
          metadataChanges,
        );

        const scopePath = `type:${oldRoot.name}`;
        const bwdCtx: CompareCtx = {
          producerSnap: oldSnap,
          consumerSnap: newSnap,
          producerIsOld: true,
          role: "payload",
          direction: "old-to-new",
          options,
          issues,
          assumptions,
          metadataChanges,
          collectMeta: true,
          visited: new Set([`O2N|ref:${oldRoot.name}|ref:${newRoot.name}`]),
        };
        const bwd = compareNodes(oldRoot.node, newRoot.node, scopePath, bwdCtx);
        backwardVerdict = combineVerdicts(backwardVerdict, bwd);

        const fwdIssues: CompatibilityIssue[] = [];
        const fwdCtx: CompareCtx = {
          producerSnap: newSnap,
          consumerSnap: oldSnap,
          producerIsOld: false,
          role: "payload",
          direction: "new-to-old",
          options,
          issues: fwdIssues,
          assumptions,
          metadataChanges,
          collectMeta: false,
          visited: new Set([`N2O|ref:${newRoot.name}|ref:${oldRoot.name}`]),
        };
        const fwd = compareNodes(newRoot.node, oldRoot.node, scopePath, fwdCtx);
        forwardVerdict = combineVerdicts(forwardVerdict, fwd);
        issues.push(...fwdIssues);
      }
    }
  }

  // 4. Compare exported operation signatures (request, response, errors, requirements)
  if (hasOps) {
    const oldOps = oldSnap.operations ?? [];
    const newOps = newSnap.operations ?? [];
    const { matched, removed, added } = matchOperations(oldOps, newOps, options);

    for (const rem of removed) {
      issues.push({
        verdict: "incompatible",
        code: "OPERATION_REMOVED",
        role: "operation",
        direction: "old-client-new-server",
        path: `op:${rem.name}`,
        message: `Operation '${rem.name}' was removed in the new snapshot; old clients calling it will fail.`,
        ...(rem.span !== undefined ? { oldSpan: rem.span } : {}),
      });
      backwardVerdict = combineVerdicts(backwardVerdict, "incompatible");
      requestVerdict = combineVerdicts(requestVerdict, "incompatible");
    }

    for (const add of added) {
      issues.push({
        verdict: "incompatible",
        code: "OPERATION_ADDED",
        role: "operation",
        direction: "new-client-old-server",
        path: `op:${add.name}`,
        message: `Operation '${add.name}' was added in the new snapshot; old servers do not implement it.`,
        ...(add.span !== undefined ? { newSpan: add.span } : {}),
      });
      forwardVerdict = combineVerdicts(forwardVerdict, "incompatible");
    }

    for (const { oldOp, newOp, matchedBy } of matched) {
      const opPath = `op:${oldOp.name}`;
      if (oldOp.name !== newOp.name) {
        assumptions.add(
          `Matched renamed operation '${oldOp.name}' -> '${newOp.name}' via ${matchedBy}`,
        );
        metadataChanges.push({
          path: opPath,
          key: "name",
          oldValue: oldOp.name,
          newValue: newOp.name,
          ...(oldOp.span !== undefined ? { oldSpan: oldOp.span } : {}),
          ...(newOp.span !== undefined ? { newSpan: newOp.span } : {}),
        });
      }

      collectMetadataDiffs(
        opPath,
        oldOp.metadata,
        newOp.metadata,
        oldOp.span,
        newOp.span,
        metadataChanges,
      );

      // Backward Request: old client -> new server
      const bwdReqCtx: CompareCtx = {
        producerSnap: oldSnap,
        consumerSnap: newSnap,
        producerIsOld: true,
        role: "request",
        direction: "old-client-new-server",
        options,
        issues,
        assumptions,
        metadataChanges,
        collectMeta: true,
        visited: new Set(),
      };
      const reqV = compareNodes(oldOp.request, newOp.request, `${opPath}.request`, bwdReqCtx);
      requestVerdict = combineVerdicts(requestVerdict, reqV);

      // Backward Response: new server -> old client
      const bwdRespCtx: CompareCtx = {
        producerSnap: newSnap,
        consumerSnap: oldSnap,
        producerIsOld: false,
        role: "response",
        direction: "old-client-new-server",
        options,
        issues,
        assumptions,
        metadataChanges,
        collectMeta: true,
        visited: new Set(),
      };
      const respV = compareNodes(newOp.response, oldOp.response, `${opPath}.response`, bwdRespCtx);
      responseVerdict = combineVerdicts(responseVerdict, respV);

      // Backward Errors: new server errors ⊆ old client handled errors
      const bwdErrCtx: CompareCtx = {
        producerSnap: newSnap,
        consumerSnap: oldSnap,
        producerIsOld: false,
        role: "error",
        direction: "old-client-new-server",
        options,
        issues,
        assumptions,
        metadataChanges,
        collectMeta: false,
        visited: new Set(),
      };
      const errV = compareErrorSets(newOp.errors, oldOp.errors, opPath, bwdErrCtx);
      errorsVerdict = combineVerdicts(errorsVerdict, errV);

      // Backward Requirements: new server requirements ⊆ old host granted capabilities
      const reqsV = compareRequirementSets(
        newOp.requirements,
        oldOp.requirements,
        opPath,
        "old-client-new-server",
        issues,
        oldOp.span,
        newOp.span,
      );
      requirementsVerdict = combineVerdicts(requirementsVerdict, reqsV);

      backwardVerdict = combineVerdicts(
        backwardVerdict,
        reqV,
        respV,
        errV,
        reqsV,
      );

      // Forward compatibility: new client -> old server
      const fwdReqCtx: CompareCtx = {
        producerSnap: newSnap,
        consumerSnap: oldSnap,
        producerIsOld: false,
        role: "request",
        direction: "new-client-old-server",
        options,
        issues,
        assumptions,
        metadataChanges,
        collectMeta: false,
        visited: new Set(),
      };
      const fwdReqV = compareNodes(newOp.request, oldOp.request, `${opPath}.request`, fwdReqCtx);

      const fwdRespCtx: CompareCtx = {
        producerSnap: oldSnap,
        consumerSnap: newSnap,
        producerIsOld: true,
        role: "response",
        direction: "new-client-old-server",
        options,
        issues,
        assumptions,
        metadataChanges,
        collectMeta: false,
        visited: new Set(),
      };
      const fwdRespV = compareNodes(oldOp.response, newOp.response, `${opPath}.response`, fwdRespCtx);

      const fwdErrCtx: CompareCtx = {
        producerSnap: oldSnap,
        consumerSnap: newSnap,
        producerIsOld: true,
        role: "error",
        direction: "new-client-old-server",
        options,
        issues,
        assumptions,
        metadataChanges,
        collectMeta: false,
        visited: new Set(),
      };
      const fwdErrV = compareErrorSets(oldOp.errors, newOp.errors, opPath, fwdErrCtx);

      const fwdReqsV = compareRequirementSets(
        oldOp.requirements,
        newOp.requirements,
        opPath,
        "new-client-old-server",
        issues,
        oldOp.span,
        newOp.span,
      );

      forwardVerdict = combineVerdicts(
        forwardVerdict,
        fwdReqV,
        fwdRespV,
        fwdErrV,
        fwdReqsV,
      );
    }
  }

  return buildReport(
    oldSnap,
    newSnap,
    oldContractId,
    newContractId,
    contractIdChanged,
    backwardVerdict,
    forwardVerdict,
    requestVerdict,
    responseVerdict,
    errorsVerdict,
    requirementsVerdict,
    issues,
    metadataChanges,
    assumptions,
  );
}

function buildReport(
  oldSnap: ContractSnapshot,
  newSnap: ContractSnapshot,
  oldContractId: string | undefined,
  newContractId: string | undefined,
  contractIdChanged: boolean,
  backward: CompatibilityVerdict,
  forward: CompatibilityVerdict,
  request: CompatibilityVerdict,
  response: CompatibilityVerdict,
  errors: CompatibilityVerdict,
  requirements: CompatibilityVerdict,
  issues: CompatibilityIssue[],
  metadataChanges: MetadataChange[],
  assumptions: Set<string>,
): DirectionalDiffReport {
  const structurallyIdentical =
    backward === "compatible" &&
    forward === "compatible" &&
    issues.every((i) => i.verdict === "compatible");

  const metadataOnlyChange =
    structurallyIdentical && (contractIdChanged || metadataChanges.length > 0);

  return {
    oldRevision: oldSnap.revision,
    newRevision: newSnap.revision,
    ...(oldContractId !== undefined ? { oldContractId } : {}),
    ...(newContractId !== undefined ? { newContractId } : {}),
    contractIdChanged,
    metadataOnlyChange,
    verdict: backward,
    directions: {
      backward,
      forward,
      request,
      response,
      errors,
      requirements,
    },
    issues,
    metadataChanges,
    assumptions: [...assumptions],
  };
}
