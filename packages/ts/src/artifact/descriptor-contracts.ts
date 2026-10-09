import type { FormDescriptor } from "../descriptor/FormDescriptor.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";
import { parse, toSExprMany } from "../reader/index.js";
import type { SExpr } from "../reader/types.js";
import type { ArtifactValidatorRegistry } from "./validator-registry.js";

export interface PayloadContract {
  readonly requiredFields: readonly string[];
  readonly fieldConstraints: readonly { readonly field: string; readonly kind?: "string" | "array" | "object"; readonly literal?: string }[];
}
export type PayloadContracts = ReadonlyMap<string, unknown>;
const clauses = ["contract", "required-fields", "string-fields", "array-fields", "object-fields", "literal-fields"];
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const normalize = (v: string) => v.replace(/^:/, "");

function names(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  const values = Array.isArray(value) ? value : [value];
  const result: string[] = [];
  for (const v of values) {
    if (typeof v !== "string" || !normalize(v)) throw new Error(`${label} must contain nonempty textual names.`);
    const name = normalize(v);
    if (result.includes(name)) throw new Error(`${label} must not repeat ${JSON.stringify(name)}.`);
    result.push(name);
  }
  return result;
}

export function descriptorValidatorNames(form: FormDescriptor): readonly string[] {
  const artifact = form.extensions?.["artifact"];
  return record(artifact) ? names(artifact["validators"], "Descriptor artifact validators") : [];
}

export function resolvePayloadContract(payload: unknown, contracts: PayloadContracts = new Map(), seen: readonly string[] = []): PayloadContract {
  if (payload === undefined) return { requiredFields: [], fieldConstraints: [] };
  if (!record(payload)) throw new Error("Descriptor artifact payload must be a map of clauses.");
  for (const key of Object.keys(payload)) if (!clauses.includes(key)) throw new Error(`Unknown descriptor artifact payload clause ${JSON.stringify(key)}.`);
  const requiredFields: string[] = [];
  const fieldConstraints: PayloadContract["fieldConstraints"][number][] = [];
  const merge = (contract: PayloadContract) => {
    for (const field of contract.requiredFields) if (!requiredFields.includes(field)) requiredFields.push(field);
    for (const next of contract.fieldConstraints) {
      for (const previous of fieldConstraints.filter(c => c.field === next.field)) {
        if (previous.kind && next.kind && previous.kind !== next.kind || previous.literal !== undefined && next.literal !== undefined && previous.literal !== next.literal || previous.literal !== undefined && next.kind && next.kind !== "string" || next.literal !== undefined && previous.kind && previous.kind !== "string") throw new Error(`Descriptor artifact payload field ${JSON.stringify(next.field)} has conflicting constraints.`);
      }
      fieldConstraints.push(next);
    }
  };
  const references = names(payload["contract"], "Descriptor artifact payload contract reference");
  if (payload["contract"] !== undefined && !references.length) throw new Error("Descriptor artifact payload contract reference must not be empty.");
  for (const reference of references) {
    if (seen.includes(reference)) throw new Error(`Descriptor artifact payload contract ${JSON.stringify(reference)} is recursive.`);
    if (!contracts.has(reference)) throw new Error(`Unknown descriptor artifact payload contract ${JSON.stringify(reference)}.`);
    merge(resolvePayloadContract(contracts.get(reference), contracts, [...seen, reference]));
  }
  merge({ requiredFields: names(payload["required-fields"], "required-fields"), fieldConstraints: [] });
  for (const kind of ["string", "array", "object"] as const) merge({ requiredFields: [], fieldConstraints: names(payload[`${kind}-fields`], `${kind}-fields`).map(field => ({ field, kind })) });
  if (payload["literal-fields"] !== undefined) {
    if (!Array.isArray(payload["literal-fields"])) throw new Error("literal-fields must be a list.");
    const fields: string[] = [];
    for (const entry of payload["literal-fields"]) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !normalize(entry[0]) || typeof entry[1] !== "string") throw new Error("literal-fields must contain textual [field literal] entries.");
      const field = normalize(entry[0]);
      if (fields.includes(field)) throw new Error(`literal-fields must not repeat field ${field}.`);
      fields.push(field);
      merge({ requiredFields: [], fieldConstraints: [{ field, literal: entry[1] }] });
    }
  }
  return { requiredFields, fieldConstraints };
}

export function descriptorPayloadContract(form: FormDescriptor, contracts?: PayloadContracts): PayloadContract {
  const artifact = form.extensions?.["artifact"];
  if (!record(artifact)) return resolvePayloadContract(undefined);
  return resolvePayloadContract(artifact["payload"] ?? (clauses.some(c => c in artifact) ? Object.fromEntries(Object.entries(artifact).filter(([k]) => clauses.includes(k))) : undefined), contracts);
}

/** Extension point for the descriptor metacheck stage. No bootstrap or I/O. */
export function checkArtifactDescriptor(form: FormDescriptor, options: { readonly registry: ArtifactValidatorRegistry; readonly contracts?: PayloadContracts; readonly span?: Span }): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const report = (code: string, message: string) => diagnostics.push({ code, severity: "error", phase: "elaborate", message, ...(options.span ? { span: options.span } : {}) });
  const artifact = form.extensions?.["artifact"];
  if (artifact === undefined) return diagnostics;
  if (!record(artifact)) report("artifact/descriptor-artifact", "Descriptor artifact extension must be a map of artifact clauses.");
  try {
    for (const name of descriptorValidatorNames(form)) if (!options.registry.has(name)) report("artifact/unknown-validator", `Unknown artifact validator ${JSON.stringify(name)}.`);
  } catch (error) { report("artifact/descriptor-validators", (error as Error).message); }
  try { descriptorPayloadContract(form, options.contracts); }
  catch (error) { report("artifact/descriptor-payload", (error as Error).message); }
  if (form.elaboration.kind === "none" || form.elaboration.kind === "static") report("artifact/descriptor-summary", `Artifact-producing form ${form.name} must declare a construct hook.`);
  if (form.resultType.kind === "none") report("artifact/descriptor-summary", `Artifact-producing form ${form.name} must declare a result type.`);
  return diagnostics;
}

/** Parse contract data without executing domain vocabulary in the language core. */
export function payloadContractsFromSources(sources: readonly string[]): PayloadContracts {
  const contracts = new Map<string, unknown>();
  const datum = (e: SExpr): unknown => {
    if (e._tag === "Sym") return normalize(e.name);
    if (e._tag === "Str") return e.value;
    if (e._tag === "List" || e._tag === "Vector") return e.items.map(datum);
    return null;
  };
  for (const source of sources) for (const e of toSExprMany(parse(source).redTree)) {
    if (e._tag !== "List" || e.items[0]?._tag !== "Sym" || e.items[0].name !== "__payload-contract" || e.items[1]?._tag !== "Sym") continue;
    const entries = e.items.slice(2).map(clause => {
      if (clause._tag !== "List" || !clause.items[0]) return ["invalid", null];
      return [String(datum(clause.items[0])), clause.items.length === 2 ? datum(clause.items[1]!) : clause.items.slice(1).map(datum)];
    });
    contracts.set(e.items[1].name, Object.fromEntries(entries));
  }
  return contracts;
}

/** Validate named contracts too, including unused and recursive definitions. */
export function checkArtifactPayloadContracts(contracts: PayloadContracts, spanForName?: (name: string) => Span | undefined): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const [name, contract] of contracts) {
    try { resolvePayloadContract(contract, contracts, [name]); }
    catch (error) {
      const span = spanForName?.(name);
      diagnostics.push({ code: "artifact/descriptor-payload", severity: "error", phase: "elaborate", message: (error as Error).message, ...(span ? { span } : {}) });
    }
  }
  return diagnostics;
}
