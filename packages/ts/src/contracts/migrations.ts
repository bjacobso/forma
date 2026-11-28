/**
 * RFC 0027 (Stage 2): Checked pure payload migrations, fixture validation,
 * explicit information-loss reporting, and bidirectional round-trip law checking.
 *
 * Browser-safe: zero `node:*` imports.
 */

import { canonicalJson, sha256 } from "../artifact/canonical-json.js";
import type { JsonValue } from "../artifact/artifact.js";
import type {
  CompatibilityVerdict,
  ContractRecordField,
  ContractSnapshot,
  ContractTypeDecl,
  ContractTypeNode,
  InformationLossItem,
  MigrationCheckResult,
  MigrationFixtureResult,
  PureMigrationSpec,
  RoundTripCaseResult,
  RoundTripCheckResult,
  UnknownFieldPolicy,
} from "./types.js";

// ---------------------------------------------------------------------------
// Snapshot type resolution helpers
// ---------------------------------------------------------------------------

function isTypeDecl(
  entry: ContractTypeDecl | ContractTypeNode,
): entry is ContractTypeDecl {
  return "type" in entry && "name" in entry && !("kind" in entry);
}

function resolveNamedType(
  snapshot: ContractSnapshot,
  name: string,
): ContractTypeNode | undefined {
  const entry = snapshot.types?.[name];
  if (!entry) return undefined;
  return isTypeDecl(entry) ? entry.type : entry;
}

function resolveSpecType(
  snapshot: ContractSnapshot,
  explicit: ContractTypeNode | string | undefined,
): ContractTypeNode | undefined {
  if (explicit === undefined) {
    return snapshot.rootType !== undefined
      ? resolveNamedType(snapshot, snapshot.rootType)
      : undefined;
  }
  if (typeof explicit === "string") {
    return resolveNamedType(snapshot, explicit);
  }
  return explicit;
}

function getEffectiveContractId(snapshot: ContractSnapshot): string | undefined {
  return snapshot.irContractId ?? snapshot.contractId ?? snapshot.payloadContractId;
}

function getPolicy(
  snapshot: ContractSnapshot,
  recordPolicy: UnknownFieldPolicy | undefined,
): UnknownFieldPolicy {
  return recordPolicy ?? snapshot.unknownFieldPolicy ?? snapshot.codec.unknownFieldPolicy ?? "reject";
}

// ---------------------------------------------------------------------------
// Deep structural equality (browser-safe, handles Uint8Array, arrays, records)
// ---------------------------------------------------------------------------

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") {
    return false;
  }
  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  const aRec = a as Record<string, unknown>;
  const bRec = b as Record<string, unknown>;
  const aKeys = Object.keys(aRec).filter((k) => aRec[k] !== undefined);
  const bKeys = Object.keys(bRec).filter((k) => bRec[k] !== undefined);
  if (aKeys.length !== bKeys.length) return false;
  for (const key of aKeys) {
    if (!(key in bRec) || !deepEqual(aRec[key], bRec[key])) return false;
  }
  return true;
}

function formatVal(v: unknown): string {
  try {
    if (v instanceof Uint8Array) return `Uint8Array(${v.length})`;
    return canonicalJson(v as JsonValue);
  } catch {
    return String(v);
  }
}

// ---------------------------------------------------------------------------
// Runtime value validator against ContractTypeNode
// ---------------------------------------------------------------------------

interface ValidationResult {
  readonly valid: boolean;
  readonly unknown: boolean;
  readonly errors: readonly string[];
}

function acceptsNullNode(
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
      return node.members.some((m) => acceptsNullNode(m, snap, seen));
    case "ref": {
      if (seen.has(node.target)) return false;
      seen.add(node.target);
      const target = resolveNamedType(snap, node.target);
      return target ? acceptsNullNode(target, snap, seen) : false;
    }
    default:
      return false;
  }
}

export function validateValueAgainstType(
  value: unknown,
  node: ContractTypeNode,
  snapshot: ContractSnapshot,
  path = "$",
  allowExtraKeys?: ReadonlySet<string>,
): ValidationResult {
  const errors: string[] = [];
  let unknown = false;

  const visit = (
    val: unknown,
    typeNode: ContractTypeNode,
    curPath: string,
    extraAllowed?: ReadonlySet<string>,
  ): void => {
    switch (typeNode.kind) {
      case "opaque":
      case "generic-row":
      case "unsupported":
        unknown = true;
        return;

      case "ref": {
        const target = resolveNamedType(snapshot, typeNode.target);
        if (!target) {
          unknown = true;
          errors.push(`${curPath}: unresolved type ref '${typeNode.target}'`);
          return;
        }
        visit(val, target, curPath, extraAllowed);
        return;
      }

      case "literal":
        if (val !== typeNode.value) {
          errors.push(
            `${curPath}: expected literal ${JSON.stringify(typeNode.value)}, got ${formatVal(val)}`,
          );
        }
        return;

      case "primitive": {
        switch (typeNode.primitive) {
          case "string": {
            if (typeof val !== "string") {
              errors.push(`${curPath}: expected string, got ${typeof val}`);
              return;
            }
            const ref = typeNode.stringRefinement;
            if (ref) {
              if (ref.minLength !== undefined && val.length < ref.minLength) {
                errors.push(
                  `${curPath}: string length ${val.length} < minLength ${ref.minLength}`,
                );
              }
              if (ref.maxLength !== undefined && val.length > ref.maxLength) {
                errors.push(
                  `${curPath}: string length ${val.length} > maxLength ${ref.maxLength}`,
                );
              }
              if (ref.literals !== undefined && !ref.literals.includes(val)) {
                errors.push(
                  `${curPath}: string ${JSON.stringify(val)} not in allowed literals [${ref.literals.join(", ")}]`,
                );
              }
              if (ref.pattern !== undefined) {
                try {
                  if (!new RegExp(ref.pattern).test(val)) {
                    errors.push(
                      `${curPath}: string ${JSON.stringify(val)} does not match /${ref.pattern}/`,
                    );
                  }
                } catch {
                  unknown = true;
                }
              }
            }
            return;
          }
          case "number":
          case "integer": {
            if (typeof val !== "number" || !Number.isFinite(val)) {
              errors.push(`${curPath}: expected finite ${typeNode.primitive}, got ${formatVal(val)}`);
              return;
            }
            const mustBeInt =
              typeNode.primitive === "integer" || typeNode.interval?.integer === true;
            if (mustBeInt && !Number.isInteger(val)) {
              errors.push(`${curPath}: expected integer, got ${val}`);
            }
            const intv = typeNode.interval;
            if (intv) {
              if (intv.min !== undefined) {
                if (intv.minExclusive ? val <= intv.min : val < intv.min) {
                  errors.push(
                    `${curPath}: value ${val} violates lower bound ${intv.minExclusive ? ">" : ">="} ${intv.min}`,
                  );
                }
              }
              if (intv.max !== undefined) {
                if (intv.maxExclusive ? val >= intv.max : val > intv.max) {
                  errors.push(
                    `${curPath}: value ${val} violates upper bound ${intv.maxExclusive ? "<" : "<="} ${intv.max}`,
                  );
                }
              }
              if (intv.multipleOf !== undefined && intv.multipleOf !== 0) {
                if (Math.abs(val % intv.multipleOf) > 1e-9) {
                  errors.push(
                    `${curPath}: value ${val} is not a multiple of ${intv.multipleOf}`,
                  );
                }
              }
            }
            return;
          }
          case "boolean":
            if (typeof val !== "boolean") {
              errors.push(`${curPath}: expected boolean, got ${typeof val}`);
            }
            return;
          case "null":
            if (val !== null) {
              errors.push(`${curPath}: expected null, got ${formatVal(val)}`);
            }
            return;
          case "bytes":
            if (!(val instanceof Uint8Array)) {
              errors.push(`${curPath}: expected Uint8Array bytes, got ${typeof val}`);
            }
            return;
        }
      }

      case "record": {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          errors.push(`${curPath}: expected record object, got ${formatVal(val)}`);
          return;
        }
        const obj = val as Record<string, unknown>;
        const declared = new Set<string>();
        for (const field of typeNode.fields) {
          declared.add(field.name);
          const hasKey = Object.prototype.hasOwnProperty.call(obj, field.name);
          const fVal = obj[field.name];
          if (!hasKey || fVal === undefined) {
            if (field.optional !== true) {
              errors.push(`${curPath}.${field.name}: missing required field`);
            }
            continue;
          }
          if (fVal === null) {
            if (field.nullable === true || acceptsNullNode(field.type, snapshot)) {
              continue;
            }
            errors.push(`${curPath}.${field.name}: null is not allowed for non-nullable field`);
            continue;
          }
          visit(fVal, field.type, `${curPath}.${field.name}`);
        }
        const policy = getPolicy(snapshot, typeNode.unknownFields);
        if (policy === "reject") {
          for (const key of Object.keys(obj)) {
            if (obj[key] === undefined) continue;
            if (!declared.has(key) && !extraAllowed?.has(key)) {
              errors.push(`${curPath}.${key}: unknown field rejected (unknownFields: "reject")`);
            }
          }
        }
        return;
      }

      case "array": {
        if (!Array.isArray(val)) {
          errors.push(`${curPath}: expected array, got ${formatVal(val)}`);
          return;
        }
        if (typeNode.minItems !== undefined && val.length < typeNode.minItems) {
          errors.push(`${curPath}: array length ${val.length} < minItems ${typeNode.minItems}`);
        }
        if (typeNode.maxItems !== undefined && val.length > typeNode.maxItems) {
          errors.push(`${curPath}: array length ${val.length} > maxItems ${typeNode.maxItems}`);
        }
        for (let i = 0; i < val.length; i++) {
          visit(val[i], typeNode.element, `${curPath}[${i}]`);
        }
        return;
      }

      case "tuple": {
        if (!Array.isArray(val)) {
          errors.push(`${curPath}: expected tuple array, got ${formatVal(val)}`);
          return;
        }
        if (val.length !== typeNode.elements.length) {
          errors.push(
            `${curPath}: expected tuple of length ${typeNode.elements.length}, got ${val.length}`,
          );
          return;
        }
        for (let i = 0; i < typeNode.elements.length; i++) {
          visit(val[i], typeNode.elements[i]!, `${curPath}[${i}]`);
        }
        return;
      }

      case "map": {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          errors.push(`${curPath}: expected map object, got ${formatVal(val)}`);
          return;
        }
        for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
          visit(k, typeNode.key, `${curPath}.<key:${k}>`);
          visit(v, typeNode.value, `${curPath}[${JSON.stringify(k)}]`);
        }
        return;
      }

      case "tagged-union": {
        if (typeof val !== "object" || val === null || Array.isArray(val)) {
          errors.push(`${curPath}: expected tagged-union object, got ${formatVal(val)}`);
          return;
        }
        const obj = val as Record<string, unknown>;
        const tag = obj[typeNode.tagField];
        if (typeof tag !== "string") {
          errors.push(
            `${curPath}.${typeNode.tagField}: missing string discriminator tag`,
          );
          return;
        }
        const variant = typeNode.variants.find((v) => v.tag === tag);
        if (!variant) {
          errors.push(
            `${curPath}.${typeNode.tagField}: unknown variant tag ${JSON.stringify(tag)}`,
          );
          return;
        }
        visit(
          val,
          variant.payload,
          `${curPath}[tag=${tag}]`,
          new Set([typeNode.tagField]),
        );
        return;
      }

      case "union": {
        let anyUnknown = false;
        for (const member of typeNode.members) {
          const sub = validateValueAgainstType(val, member, snapshot, curPath, extraAllowed);
          if (sub.valid && !sub.unknown) return;
          if (sub.unknown) anyUnknown = true;
        }
        if (anyUnknown) {
          unknown = true;
        } else {
          errors.push(`${curPath}: value ${formatVal(val)} did not match any union member`);
        }
        return;
      }

      case "option": {
        const rep = typeNode.representation;
        if (rep === "nullable") {
          if (val === null) return;
          visit(val, typeNode.inner, curPath);
          return;
        }
        if (rep === "absent") {
          if (val === undefined) return;
          visit(val, typeNode.inner, curPath);
          return;
        }
        if (rep === "tagged") {
          if (typeof val !== "object" || val === null || Array.isArray(val)) {
            errors.push(`${curPath}: expected tagged Option object`);
            return;
          }
          const obj = val as Record<string, unknown>;
          const tag = obj["_tag"] ?? obj["tag"];
          if (tag === "None" || tag === "none") return;
          if (tag === "Some" || tag === "some") {
            visit(obj["value"], typeNode.inner, `${curPath}.value`);
            return;
          }
          errors.push(`${curPath}: expected tagged Option ('Some'/'None'), got ${formatVal(val)}`);
          return;
        }
        if (val === null || val === undefined) return;
        visit(val, typeNode.inner, curPath);
        return;
      }
    }
  };

  visit(value, node, path, allowExtraKeys);
  return { valid: errors.length === 0, unknown, errors };
}

// ---------------------------------------------------------------------------
// Explicit information-loss detection (oldType -> newType)
// ---------------------------------------------------------------------------

function lookupMigrationFieldRename(
  fieldRenames: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined,
  scopePath: string,
  oldName: string,
): string | undefined {
  if (!fieldRenames) return undefined;
  if (fieldRenames[scopePath]?.[oldName] !== undefined) {
    return fieldRenames[scopePath]![oldName];
  }
  if (fieldRenames["$"]?.[oldName] !== undefined && scopePath === "$") {
    return fieldRenames["$"]![oldName];
  }
  const lastSeg = scopePath.split(".").pop();
  if (lastSeg && fieldRenames[lastSeg]?.[oldName] !== undefined) {
    return fieldRenames[lastSeg]![oldName];
  }
  return undefined;
}

function detectInformationLoss(
  oldNode: ContractTypeNode,
  newNode: ContractTypeNode,
  oldSnap: ContractSnapshot,
  newSnap: ContractSnapshot,
  fieldRenames: Readonly<Record<string, Readonly<Record<string, string>>>> | undefined,
  path: string,
  visited: Set<string>,
  out: InformationLossItem[],
): void {
  if (oldNode.kind === "ref" || newNode.kind === "ref") {
    const pKey = oldNode.kind === "ref" ? `ref:${oldNode.target}` : `inline:${oldNode.kind}`;
    const cKey = newNode.kind === "ref" ? `ref:${newNode.target}` : `inline:${newNode.kind}`;
    const pairKey = `${pKey}|${cKey}`;
    if (visited.has(pairKey)) return;
    visited.add(pairKey);

    const resolvedOld =
      oldNode.kind === "ref" ? resolveNamedType(oldSnap, oldNode.target) : oldNode;
    const resolvedNew =
      newNode.kind === "ref" ? resolveNamedType(newSnap, newNode.target) : newNode;
    if (!resolvedOld || !resolvedNew) return;
    detectInformationLoss(
      resolvedOld,
      resolvedNew,
      oldSnap,
      newSnap,
      fieldRenames,
      path,
      visited,
      out,
    );
    return;
  }

  if (oldNode.kind === "record" && newNode.kind === "record") {
    const usedNew = new Set<number>();
    for (const ofield of oldNode.fields) {
      let foundIdx = -1;
      if (ofield.id !== undefined) {
        foundIdx = newNode.fields.findIndex(
          (nf, i) => !usedNew.has(i) && nf.id !== undefined && nf.id === ofield.id,
        );
      }
      if (foundIdx < 0) {
        const renamed = lookupMigrationFieldRename(fieldRenames, path, ofield.name);
        if (renamed !== undefined) {
          foundIdx = newNode.fields.findIndex(
            (nf, i) => !usedNew.has(i) && nf.name === renamed,
          );
        }
      }
      if (foundIdx < 0) {
        foundIdx = newNode.fields.findIndex(
          (nf, i) => !usedNew.has(i) && nf.name === ofield.name,
        );
      }

      const fPath = `${path}.${ofield.name}`;
      if (foundIdx < 0) {
        out.push({
          kind: "dropped-field",
          path: fPath,
          message: `Field '${ofield.name}' is present in old type but dropped in new type.`,
          ...(ofield.span !== undefined ? { oldSpan: ofield.span } : {}),
        });
        continue;
      }

      usedNew.add(foundIdx);
      const nfield: ContractRecordField = newNode.fields[foundIdx]!;

      if (ofield.optional === true && nfield.optional !== true) {
        out.push({
          kind: "narrowed-optionality",
          path: fPath,
          message: `Field '${ofield.name}' narrowed from optional to required (absence distinction lost).`,
          ...(ofield.span !== undefined ? { oldSpan: ofield.span } : {}),
          ...(nfield.span !== undefined ? { newSpan: nfield.span } : {}),
        });
      }
      if (ofield.nullable === true && nfield.nullable !== true && !acceptsNullNode(nfield.type, newSnap)) {
        out.push({
          kind: "narrowed-nullability",
          path: fPath,
          message: `Field '${ofield.name}' narrowed from nullable to non-nullable (null distinction lost).`,
          ...(ofield.span !== undefined ? { oldSpan: ofield.span } : {}),
          ...(nfield.span !== undefined ? { newSpan: nfield.span } : {}),
        });
      }

      detectInformationLoss(
        ofield.type,
        nfield.type,
        oldSnap,
        newSnap,
        fieldRenames,
        fPath,
        visited,
        out,
      );
    }
    return;
  }

  if (oldNode.kind === "primitive" && newNode.kind === "primitive") {
    const oldNum = oldNode.primitive === "number" || oldNode.primitive === "integer";
    const newNum = newNode.primitive === "number" || newNode.primitive === "integer";
    if (oldNum && newNum) {
      const oldInt = oldNode.primitive === "integer" || oldNode.interval?.integer === true;
      const newInt = newNode.primitive === "integer" || newNode.interval?.integer === true;
      if (!oldInt && newInt) {
        out.push({
          kind: "precision-loss",
          path,
          message: `Numeric type narrowed from floating-point number to integer (fractional precision lost).`,
          ...(oldNode.span !== undefined ? { oldSpan: oldNode.span } : {}),
          ...(newNode.span !== undefined ? { newSpan: newNode.span } : {}),
        });
      }
      const oMin = oldNode.interval?.min ?? -Infinity;
      const oMax = oldNode.interval?.max ?? Infinity;
      const nMin = newNode.interval?.min ?? -Infinity;
      const nMax = newNode.interval?.max ?? Infinity;
      if (nMin > oMin || nMax < oMax) {
        out.push({
          kind: "narrowed-interval",
          path,
          message: `Numeric interval narrowed from [${oMin}, ${oMax}] to [${nMin}, ${nMax}].`,
          ...(oldNode.span !== undefined ? { oldSpan: oldNode.span } : {}),
          ...(newNode.span !== undefined ? { newSpan: newNode.span } : {}),
        });
      }
    }
    if (oldNode.primitive === "string" && newNode.primitive === "string") {
      const oRef = oldNode.stringRefinement ?? {};
      const nRef = newNode.stringRefinement ?? {};
      if (
        (nRef.minLength !== undefined && (oRef.minLength === undefined || nRef.minLength > oRef.minLength)) ||
        (nRef.maxLength !== undefined && (oRef.maxLength === undefined || nRef.maxLength < oRef.maxLength))
      ) {
        out.push({
          kind: "narrowed-string",
          path,
          message: `String length bounds narrowed in new type.`,
          ...(oldNode.span !== undefined ? { oldSpan: oldNode.span } : {}),
          ...(newNode.span !== undefined ? { newSpan: newNode.span } : {}),
        });
      }
      if (nRef.literals !== undefined) {
        const nSet = new Set(nRef.literals);
        const lost =
          oRef.literals === undefined ||
          oRef.literals.some((lit) => !nSet.has(lit));
        if (lost) {
          out.push({
            kind: "narrowed-string",
            path,
            message: `String literal domain narrowed to [${nRef.literals.join(", ")}].`,
            ...(oldNode.span !== undefined ? { oldSpan: oldNode.span } : {}),
            ...(newNode.span !== undefined ? { newSpan: newNode.span } : {}),
          });
        }
      }
    }
    return;
  }

  if (oldNode.kind === "tagged-union" && newNode.kind === "tagged-union") {
    for (const ov of oldNode.variants) {
      const nv = newNode.variants.find(
        (v) => (ov.id !== undefined && v.id === ov.id) || v.tag === ov.tag,
      );
      const vPath = `${path}[tag=${ov.tag}]`;
      if (!nv) {
        out.push({
          kind: "dropped-variant",
          path: vPath,
          message: `Union variant '${ov.tag}' is dropped in new type.`,
          ...(ov.span !== undefined ? { oldSpan: ov.span } : {}),
        });
      } else {
        detectInformationLoss(
          ov.payload,
          nv.payload,
          oldSnap,
          newSnap,
          fieldRenames,
          vPath,
          visited,
          out,
        );
      }
    }
    return;
  }

  if (oldNode.kind === "array" && newNode.kind === "array") {
    if (
      (newNode.maxItems !== undefined &&
        (oldNode.maxItems === undefined || newNode.maxItems < oldNode.maxItems)) ||
      (newNode.minItems !== undefined &&
        (oldNode.minItems === undefined || newNode.minItems > oldNode.minItems))
    ) {
      out.push({
        kind: "narrowed-collection",
        path,
        message: `Array cardinality bounds narrowed in new type.`,
        ...(oldNode.span !== undefined ? { oldSpan: oldNode.span } : {}),
        ...(newNode.span !== undefined ? { newSpan: newNode.span } : {}),
      });
    }
    detectInformationLoss(
      oldNode.element,
      newNode.element,
      oldSnap,
      newSnap,
      fieldRenames,
      `${path}[]`,
      visited,
      out,
    );
    return;
  }

  if (oldNode.kind === "tuple" && newNode.kind === "tuple") {
    if (newNode.elements.length < oldNode.elements.length) {
      out.push({
        kind: "narrowed-collection",
        path,
        message: `Tuple arity narrowed from ${oldNode.elements.length} to ${newNode.elements.length}.`,
        ...(oldNode.span !== undefined ? { oldSpan: oldNode.span } : {}),
        ...(newNode.span !== undefined ? { newSpan: newNode.span } : {}),
      });
    }
    const len = Math.min(oldNode.elements.length, newNode.elements.length);
    for (let i = 0; i < len; i++) {
      detectInformationLoss(
        oldNode.elements[i]!,
        newNode.elements[i]!,
        oldSnap,
        newSnap,
        fieldRenames,
        `${path}[${i}]`,
        visited,
        out,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry point: checkPureMigration
// ---------------------------------------------------------------------------

/**
 * Validate a pure payload migration from an old decoded type to a new decoded type:
 * - Validates before fixtures against oldType and migration outputs against newType
 * - Rejects invalid outputs and non-deterministic/impure results
 * - Reports explicit information loss (dropped/narrowed fields, intervals, variants)
 * - Optionally checks both round-trip laws over the declared domain when `inverse` is supplied
 */
export function checkPureMigration<TOld = unknown, TNew = unknown>(
  spec: PureMigrationSpec<TOld, TNew>,
): MigrationCheckResult {
  const oldContractId = getEffectiveContractId(spec.oldSnapshot);
  const newContractId = getEffectiveContractId(spec.newSnapshot);
  const implementationHash =
    spec.implementationHash ??
    sha256(
      JSON.stringify({
        name: spec.name,
        oldRevision: spec.oldSnapshot.revision,
        newRevision: spec.newSnapshot.revision,
        oldContractId: oldContractId ?? null,
        newContractId: newContractId ?? null,
        migrate: spec.migrate.toString(),
        inverse: spec.inverse?.toString() ?? null,
      }),
    );

  const caveats: string[] = [
    "Fixture-based migration checking does not prove preservation of business meaning, totality, or termination across untested inputs.",
  ];

  const errors: string[] = [];
  const fixtureResults: MigrationFixtureResult[] = [];
  const informationLoss: InformationLossItem[] = [];

  const oldType = resolveSpecType(spec.oldSnapshot, spec.oldType);
  const newType = resolveSpecType(spec.newSnapshot, spec.newType);

  if (!oldType || !newType) {
    errors.push(
      `Missing ${!oldType ? "old" : "new"} type definition for migration '${spec.name}'.`,
    );
    return {
      ok: false,
      verdict: "unknown",
      name: spec.name,
      oldRevision: spec.oldSnapshot.revision,
      newRevision: spec.newSnapshot.revision,
      ...(oldContractId !== undefined ? { oldContractId } : {}),
      ...(newContractId !== undefined ? { newContractId } : {}),
      implementationHash,
      fixtureResults,
      informationLoss,
      errors,
      caveats,
    };
  }

  // 1. Explicit information-loss analysis
  detectInformationLoss(
    oldType,
    newType,
    spec.oldSnapshot,
    spec.newSnapshot,
    spec.fieldRenames,
    "$",
    new Set(),
    informationLoss,
  );

  if (spec.informationLossPolicy === "forbid" && informationLoss.length > 0) {
    for (const loss of informationLoss) {
      errors.push(`Forbidden information loss (${loss.kind}) at ${loss.path}: ${loss.message}`);
    }
  }

  // 2. Fixture validation & purity check
  let sawUnknown = false;
  if (spec.fixtures.length === 0) {
    sawUnknown = true;
    errors.push(`Migration '${spec.name}' has no fixtures; cannot validate behavior.`);
  }

  const validMigratedPairs: Array<{ readonly name: string; readonly before: TOld; readonly after: TNew }> = [];

  for (const fixture of spec.fixtures) {
    const fErrors: string[] = [];

    // Validate before fixture against oldType
    const beforeCheck = validateValueAgainstType(fixture.before, oldType, spec.oldSnapshot, "$");
    if (beforeCheck.unknown) sawUnknown = true;
    if (!beforeCheck.valid) {
      for (const e of beforeCheck.errors) {
        fErrors.push(`Invalid 'before' fixture: ${e}`);
      }
    }

    // Validate expectedAfter if provided
    if (fixture.expectedAfter !== undefined) {
      const expCheck = validateValueAgainstType(
        fixture.expectedAfter,
        newType,
        spec.newSnapshot,
        "$",
      );
      if (expCheck.unknown) sawUnknown = true;
      if (!expCheck.valid) {
        for (const e of expCheck.errors) {
          fErrors.push(`Invalid 'expectedAfter' fixture: ${e}`);
        }
      }
    }

    // Execute pure migration (twice to detect obvious non-determinism / impurity)
    let actualAfter: TNew | undefined;
    let secondAfter: TNew | undefined;
    try {
      actualAfter = spec.migrate(fixture.before);
      secondAfter = spec.migrate(fixture.before);
    } catch (err) {
      fErrors.push(
        `Migration threw an error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (fErrors.length === 0 || actualAfter !== undefined) {
      if (actualAfter !== undefined && !deepEqual(actualAfter, secondAfter)) {
        fErrors.push(`Migration is not deterministic/pure on fixture '${fixture.name}'.`);
      }

      if (actualAfter !== undefined) {
        const afterCheck = validateValueAgainstType(actualAfter, newType, spec.newSnapshot, "$");
        if (afterCheck.unknown) sawUnknown = true;
        if (!afterCheck.valid) {
          for (const e of afterCheck.errors) {
            fErrors.push(`Invalid migration output: ${e}`);
          }
        }

        if (fixture.expectedAfter !== undefined && !deepEqual(actualAfter, fixture.expectedAfter)) {
          fErrors.push(
            `Migration output mismatch: expected ${formatVal(fixture.expectedAfter)}, got ${formatVal(actualAfter)}.`,
          );
        }
      }
    }

    const ok = fErrors.length === 0;
    fixtureResults.push({
      name: fixture.name,
      ok,
      ...(actualAfter !== undefined ? { actualAfter } : {}),
      errors: fErrors,
    });
    if (!ok) {
      for (const e of fErrors) errors.push(`[fixture:${fixture.name}] ${e}`);
    } else if (actualAfter !== undefined) {
      validMigratedPairs.push({ name: fixture.name, before: fixture.before, after: actualAfter });
    }
  }

  // 3. Optional inverse round-trip laws (both laws over declared domain)
  let roundTrip: RoundTripCheckResult | undefined;
  if (spec.inverse !== undefined) {
    const rtCases: RoundTripCaseResult[] = [];

    // Law 1: inverse(migrate(x)) === x for every valid before fixture x
    for (const pair of validMigratedPairs) {
      const cErrors: string[] = [];
      let roundTrippedOld: TOld | undefined;
      try {
        roundTrippedOld = spec.inverse(pair.after);
      } catch (err) {
        cErrors.push(
          `Inverse threw on migrated output: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (roundTrippedOld !== undefined) {
        const oldCheck = validateValueAgainstType(roundTrippedOld, oldType, spec.oldSnapshot, "$");
        if (oldCheck.unknown) sawUnknown = true;
        if (!oldCheck.valid) {
          for (const e of oldCheck.errors) cErrors.push(`Invalid inverse output: ${e}`);
        }
        if (!deepEqual(roundTrippedOld, pair.before)) {
          cErrors.push(
            `Round-trip law inverse(migrate(x)) === x failed: expected ${formatVal(pair.before)}, got ${formatVal(roundTrippedOld)}.`,
          );
        }
      }
      const ok = cErrors.length === 0;
      rtCases.push({ name: pair.name, law: "inverse-after-migrate", ok, errors: cErrors });
      if (!ok) {
        for (const e of cErrors) errors.push(`[round-trip:inverse-after-migrate:${pair.name}] ${e}`);
      }
    }

    // Law 2: migrate(inverse(y)) === y over explicit inverseFixtures (or migrated outputs if none supplied)
    const putGetInputs: Array<{ readonly name: string; readonly after: TNew; readonly expectedBefore?: TOld }> =
      spec.inverseFixtures && spec.inverseFixtures.length > 0
        ? spec.inverseFixtures.map((f) => ({
            name: f.name,
            after: f.after,
            ...(f.expectedBefore !== undefined ? { expectedBefore: f.expectedBefore } : {}),
          }))
        : validMigratedPairs.map((p) => ({ name: p.name, after: p.after }));

    for (const item of putGetInputs) {
      const cErrors: string[] = [];
      const afterCheck = validateValueAgainstType(item.after, newType, spec.newSnapshot, "$");
      if (afterCheck.unknown) sawUnknown = true;
      if (!afterCheck.valid) {
        for (const e of afterCheck.errors) cErrors.push(`Invalid 'after' inverse fixture: ${e}`);
      }

      let invOld: TOld | undefined;
      try {
        invOld = spec.inverse(item.after);
      } catch (err) {
        cErrors.push(
          `Inverse threw on '${item.name}': ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (invOld !== undefined) {
        const invOldCheck = validateValueAgainstType(invOld, oldType, spec.oldSnapshot, "$");
        if (invOldCheck.unknown) sawUnknown = true;
        if (!invOldCheck.valid) {
          for (const e of invOldCheck.errors) cErrors.push(`Invalid inverse output: ${e}`);
        }
        if (item.expectedBefore !== undefined && !deepEqual(invOld, item.expectedBefore)) {
          cErrors.push(
            `Inverse output mismatch: expected ${formatVal(item.expectedBefore)}, got ${formatVal(invOld)}.`,
          );
        }

        let roundTrippedNew: TNew | undefined;
        try {
          roundTrippedNew = spec.migrate(invOld);
        } catch (err) {
          cErrors.push(
            `Migrate threw during round-trip on '${item.name}': ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        if (roundTrippedNew !== undefined) {
          const rtNewCheck = validateValueAgainstType(
            roundTrippedNew,
            newType,
            spec.newSnapshot,
            "$",
          );
          if (rtNewCheck.unknown) sawUnknown = true;
          if (!rtNewCheck.valid) {
            for (const e of rtNewCheck.errors) cErrors.push(`Invalid round-trip output: ${e}`);
          }
          if (!deepEqual(roundTrippedNew, item.after)) {
            cErrors.push(
              `Round-trip law migrate(inverse(y)) === y failed: expected ${formatVal(item.after)}, got ${formatVal(roundTrippedNew)}.`,
            );
          }
        }
      }

      const ok = cErrors.length === 0;
      rtCases.push({ name: item.name, law: "migrate-after-inverse", ok, errors: cErrors });
      if (!ok) {
        for (const e of cErrors) errors.push(`[round-trip:migrate-after-inverse:${item.name}] ${e}`);
      }
    }

    roundTrip = {
      ok: rtCases.every((c) => c.ok),
      cases: rtCases,
    };
  }

  const hasFailures =
    errors.length > 0 ||
    fixtureResults.some((r) => !r.ok) ||
    (roundTrip !== undefined && !roundTrip.ok);

  const verdict: CompatibilityVerdict = hasFailures
    ? "incompatible"
    : sawUnknown
      ? "unknown"
      : "compatible";

  return {
    ok: !hasFailures && !sawUnknown,
    verdict,
    name: spec.name,
    oldRevision: spec.oldSnapshot.revision,
    newRevision: spec.newSnapshot.revision,
    ...(oldContractId !== undefined ? { oldContractId } : {}),
    ...(newContractId !== undefined ? { newContractId } : {}),
    implementationHash,
    fixtureResults,
    informationLoss,
    ...(roundTrip !== undefined ? { roundTrip } : {}),
    errors,
    caveats,
  };
}
