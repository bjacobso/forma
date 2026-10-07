/**
 * Typed elaboration for the bundled ontology DSL.
 *
 * Builds on `elaborateProgram`: payloads from `define-entity`, `define-relation`,
 * `define-action`, `define-mutation`, `define-query`, and `define-datalog-query`
 * are decoded into the declaration shapes described by `preludes/ontology-ir.lisp`
 * (EntityIR, RelationIR, ActionIR, MutationIR, QueryIR). Other ontology forms
 * are returned untouched in `model.others`. Cross-references between
 * declarations are checked and reported at the referring declaration.
 */

import type { DeclarationOrigin, JsonValue } from "../artifact/artifact.js";
import type { BootstrappedPrelude } from "../descriptor/bootstrap.js";
import {
  declarationDiagnostic,
  elaborateSources,
  isJsonRuntimeStringLiteral,
  type ElaboratedDeclaration,
  type ProgramSource,
} from "../descriptor/elaborate.js";
import type { Diagnostic, Span } from "../diagnostic/diagnostic.js";
import { bootstrapOntologyPreludes } from "../Preludes.js";

/** A field or input type written in ontology source. */
export type OntologyType =
  | { readonly kind: "scalar"; readonly name: string }
  | { readonly kind: "ref"; readonly target: string }
  | { readonly kind: "list" | "set"; readonly item: OntologyType }
  | { readonly kind: "apply"; readonly constructor: string; readonly args: readonly OntologyType[] };

export interface OntologyField {
  readonly name: string;
  readonly type: OntologyType;
  readonly required: boolean;
  readonly indexed: boolean;
  /** Where the field was written, when the source map locates it. */
  readonly span?: Span;
}

export interface OntologyInput {
  readonly name: string;
  readonly type: OntologyType;
  readonly required: boolean;
  readonly span?: Span;
}

interface DeclarationBase {
  readonly name: string;
  readonly doc?: string;
  /** Where the declaration was written, or the macro call that produced it. */
  readonly span: Span;
  readonly origin: DeclarationOrigin;
}

export interface EntityDeclaration extends DeclarationBase {
  readonly kind: "Entity";
  readonly role?: string;
  readonly idPattern?: string;
  readonly fields: readonly OntologyField[];
}

export interface RelationDeclaration extends DeclarationBase {
  readonly kind: "Relation";
  readonly source: string;
  readonly target: string;
  readonly fields: readonly OntologyField[];
}

export interface ActionDeclaration extends DeclarationBase {
  readonly kind: "Action" | "Mutation";
  readonly inputs: readonly OntologyInput[];
  readonly returns?: string;
  /**
   * The `:do` body as a canonical runtime expression: lists are arrays,
   * symbols and keywords are strings, and string literals are marker objects
   * (see `isJsonRuntimeStringLiteral`).
   */
  readonly body?: JsonValue;
}

export interface QueryDeclaration extends DeclarationBase {
  readonly kind: "Query";
  /** Source entity, or `"*"` for Datalog queries. */
  readonly from: string;
  readonly select?: readonly string[];
  /** Typed `:where` runtime expression, for `define-query`. */
  readonly where?: JsonValue;
  /** Plain Datalog data with string literals unwrapped, for `define-datalog-query`. */
  readonly datalog?: JsonValue;
}

export type OntologyDeclaration =
  | EntityDeclaration
  | RelationDeclaration
  | ActionDeclaration
  | QueryDeclaration;

export interface OntologyModel {
  readonly entities: readonly EntityDeclaration[];
  readonly relations: readonly RelationDeclaration[];
  readonly actions: readonly ActionDeclaration[];
  readonly queries: readonly QueryDeclaration[];
  /** Declarations of other ontology forms (views, processes, ...), as elaborated. */
  readonly others: readonly ElaboratedDeclaration[];
}

export interface ElaborateOntologyOptions {
  /** Identifies a single string source. Defaults to `"source.forma"`. */
  readonly sourceId?: string;
  /** Defaults to a shared bootstrap of the bundled ontology preludes. */
  readonly prelude?: BootstrappedPrelude;
  /** Restrict accepted top-level forms. */
  readonly forms?: Iterable<string>;
}

export interface ElaborateOntologyResult {
  readonly ok: boolean;
  readonly model: OntologyModel;
  readonly diagnostics: readonly Diagnostic[];
}

/** Scalar type names understood by the ontology DSL; anything else must name an entity. */
export const ontologyScalarTypes: ReadonlySet<string> = new Set([
  "String",
  "Text",
  "Symbol",
  "Keyword",
  "Int",
  "Float",
  "Number",
  "Decimal",
  "Bool",
  "Boolean",
  "Date",
  "DateTime",
  "Instant",
  "Duration",
  "Json",
  "Any",
  "Id",
]);

let sharedPrelude: BootstrappedPrelude | undefined;

/**
 * Elaborate ontology source into typed declarations with located diagnostics.
 * Pass several sources to elaborate a model split across files.
 */
export function elaborateOntology(
  source: string | readonly ProgramSource[],
  options: ElaborateOntologyOptions = {},
): ElaborateOntologyResult {
  const prelude = options.prelude ?? (sharedPrelude ??= bootstrapOntologyPreludes());
  const sources =
    typeof source === "string" ? [{ sourceId: options.sourceId ?? "source.forma", source }] : source;
  const program = elaborateSources(sources, {
    prelude,
    ...(options.forms !== undefined ? { forms: options.forms } : {}),
  });

  const entities: EntityDeclaration[] = [];
  const relations: RelationDeclaration[] = [];
  const actions: ActionDeclaration[] = [];
  const queries: QueryDeclaration[] = [];
  const others: ElaboratedDeclaration[] = [];
  const diagnostics: Diagnostic[] = [...program.diagnostics];

  for (const declaration of program.declarations) {
    const payload = record(declaration.payload);
    const base = {
      name: string(payload["name"]) ?? declaration.summary.name ?? "anonymous",
      ...optional("doc", string(payload["doc"])),
      span: declaration.span,
      origin: declaration.origin,
    };
    const spanAt = (key: string, index: number): Span | undefined =>
      declaration.sourceMap.find((entry) => entry.path === `/${key}/${index}`)?.span;
    const fields = () =>
      array(payload["fields"]).map((value, index) => ({ ...field(value), ...optional("span", spanAt("fields", index)) }));
    switch (payload["kind"]) {
      case "Entity":
        entities.push({
          kind: "Entity",
          ...base,
          ...optional("role", string(payload["role"])),
          ...optional("idPattern", string(payload["idPattern"])),
          fields: fields(),
        });
        break;
      case "Relation":
        relations.push({
          kind: "Relation",
          ...base,
          source: string(payload["source"]) ?? "",
          target: string(payload["target"]) ?? "",
          fields: fields(),
        });
        break;
      case "Action":
      case "Mutation":
        actions.push({
          kind: payload["kind"],
          ...base,
          inputs: array(payload["inputs"]).map((value, index) => ({
            ...input(value),
            ...optional("span", spanAt("inputs", index)),
          })),
          ...optional("returns", string(payload["returns"])),
          ...optional("body", runtimeExprBody(payload["do"])),
        });
        break;
      case "Query": {
        const select = array(payload["select"]).flatMap((item) => string(item) ?? []);
        const datalog = runtimeExprBody(payload["datalog"]);
        queries.push({
          kind: "Query",
          ...base,
          from: string(payload["from"]) ?? "*",
          ...(select.length > 0 ? { select } : {}),
          ...optional("where", runtimeExprBody(payload["where"])),
          ...optional("datalog", datalog === undefined ? undefined : runtimeLiteralsToStrings(datalog)),
        });
        break;
      }
      default:
        others.push(declaration);
    }
  }

  const model = {
    entities: entities.map((entity) => resolveRefs(entity, entities)),
    relations: relations.map((relation) => resolveRefs(relation, entities)),
    actions: actions.map((action) => ({
      ...action,
      inputs: action.inputs.map((item) => ({ ...item, type: refTo(item.type, entities) })),
    })),
    queries,
    others,
  };
  diagnostics.push(...checkReferences(model, program.declarations));
  return { ok: !diagnostics.some((d) => d.severity === "error"), model, diagnostics };
}

/** Parse a canonical type expression such as `"String"` or `["List", "String"]`. */
export function parseOntologyType(value: JsonValue | undefined): OntologyType {
  if (typeof value === "string") return { kind: "scalar", name: value.replace(/^:/, "") };
  if (Array.isArray(value) && typeof value[0] === "string") {
    const [constructor, ...rest] = value as readonly JsonValue[];
    const args = rest.map(parseOntologyType);
    if (constructor === "Id" && args[0]?.kind === "scalar") return { kind: "ref", target: args[0].name };
    if ((constructor === "List" || constructor === "Set") && args.length === 1) {
      return { kind: constructor === "List" ? "list" : "set", item: args[0]! };
    }
    return { kind: "apply", constructor: constructor as string, args };
  }
  return { kind: "scalar", name: "Any" };
}

/** Replace runtime string-literal markers with their strings, producing plain data. */
export function runtimeLiteralsToStrings(value: JsonValue): JsonValue {
  if (isJsonRuntimeStringLiteral(value)) return value.value;
  if (Array.isArray(value)) return value.map(runtimeLiteralsToStrings);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, runtimeLiteralsToStrings(item)]),
    );
  }
  return value;
}

const field = (value: JsonValue): OntologyField => {
  const item = record(value);
  return {
    name: string(item["name"]) ?? "",
    type: parseOntologyType(item["type"]),
    required: item["required"] === true,
    indexed: item["indexed"] === true,
  };
};

const input = (value: JsonValue): OntologyInput => {
  const item = record(value);
  return {
    name: string(item["name"]) ?? "",
    type: parseOntologyType(item["type"]),
    required: item["required"] === true,
  };
};

/** Unwrap `{ kind: "raw-expr", expr }` produced by `meta/slot-runtime-expr`. */
const runtimeExprBody = (value: JsonValue | undefined): JsonValue | undefined => {
  if (value === undefined || value === null) return undefined;
  const wrapper = record(value);
  return wrapper["kind"] === "raw-expr" && "expr" in wrapper ? wrapper["expr"]! : value;
};

const refTo = (type: OntologyType, entities: readonly EntityDeclaration[]): OntologyType => {
  switch (type.kind) {
    case "scalar":
      return !ontologyScalarTypes.has(type.name) && entities.some((e) => e.name === type.name)
        ? { kind: "ref", target: type.name }
        : type;
    case "list":
    case "set":
      return { kind: type.kind, item: refTo(type.item, entities) };
    case "apply":
      return { ...type, args: type.args.map((arg) => refTo(arg, entities)) };
    case "ref":
      return type;
  }
};

const resolveRefs = <T extends EntityDeclaration | RelationDeclaration>(
  declaration: T,
  entities: readonly EntityDeclaration[],
): T => ({
  ...declaration,
  fields: declaration.fields.map((item) => ({ ...item, type: refTo(item.type, entities) })),
});

const typeNames = (type: OntologyType): readonly string[] => {
  switch (type.kind) {
    case "scalar":
      return [type.name];
    case "ref":
      return [type.target];
    case "list":
    case "set":
      return typeNames(type.item);
    case "apply":
      return type.args.flatMap(typeNames);
  }
};

const checkReferences = (
  model: OntologyModel,
  declarations: readonly ElaboratedDeclaration[],
): readonly Diagnostic[] => {
  const entityNames = new Set(model.entities.map((entity) => entity.name));
  // Typed declarations share their span object with the elaborated declaration.
  const bySpan = new Map(declarations.map((d) => [d.span, d]));
  const diagnostics: Diagnostic[] = [];
  const report = (
    at: { readonly span: Span },
    code: string,
    message: string,
    severity: Diagnostic["severity"] = "error",
  ) => {
    const declaration = bySpan.get(at.span);
    if (declaration) diagnostics.push(declarationDiagnostic(declaration, code, message, severity));
  };
  const checkFields = (owner: EntityDeclaration | RelationDeclaration) => {
    const seen = new Set<string>();
    for (const item of owner.fields) {
      if (seen.has(item.name)) {
        report(owner, "ontology/duplicate-field", `${owner.name} declares ${item.name} twice`);
      }
      seen.add(item.name);
      for (const name of typeNames(item.type)) {
        if (!ontologyScalarTypes.has(name) && !entityNames.has(name)) {
          report(owner, "ontology/unknown-type", `${item.name} refers to unknown type ${name}`);
        }
      }
    }
  };

  model.entities.forEach(checkFields);
  for (const relation of model.relations) {
    checkFields(relation);
    for (const endpoint of [relation.source, relation.target]) {
      if (!entityNames.has(endpoint)) {
        report(relation, "ontology/unknown-entity", `${relation.name} refers to unknown entity ${endpoint}`);
      }
    }
  }
  for (const query of model.queries) {
    if (query.from !== "*" && !entityNames.has(query.from)) {
      report(query, "ontology/unknown-entity", `${query.name} queries unknown entity ${query.from}`);
    }
  }
  return diagnostics;
};

const record = (value: JsonValue | undefined): Readonly<Record<string, JsonValue>> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, JsonValue>>)
    : {};

const array = (value: JsonValue | undefined): readonly JsonValue[] =>
  Array.isArray(value) ? value : [];

const string = (value: JsonValue | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;

const optional = <K extends string, V>(key: K, value: V | undefined): { readonly [P in K]?: V } =>
  (value === undefined ? {} : { [key]: value }) as { readonly [P in K]?: V };
