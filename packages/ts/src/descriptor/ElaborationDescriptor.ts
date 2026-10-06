import type { SExpr } from "../reader/types.js";
import { headSym, tail, trySym } from "../reader/types.js";

/**
 * `__projection-plan` describes the structural projection from a form
 * descriptor to canonical IR. During migration, descriptors coexist with
 * Lisp `__form-hook .../construct` bodies and the parity gate compares both
 * paths. Once a hook body is deleted, the descriptor is the sole construct
 * implementation for that hook.
 */

export type ElaborationSource =
  | { readonly kind: "identifier"; readonly name: string }
  | { readonly kind: "slot-string"; readonly name: string }
  | { readonly kind: "slot-string-list"; readonly name: string }
  | { readonly kind: "slot-symbol"; readonly name: string }
  | { readonly kind: "slot-expr"; readonly name: string }
  | { readonly kind: "slot-runtime-expr"; readonly name: string }
  | { readonly kind: "positional"; readonly index: number }
  | { readonly kind: "loc" }
  | { readonly kind: "format"; readonly parts: readonly ElaborationSource[] }
  | { readonly kind: "default"; readonly source: ElaborationSource; readonly fallback: string }
  | { readonly kind: "first"; readonly sources: readonly ElaborationSource[] }
  | { readonly kind: "ref"; readonly refKind: string; readonly source: ElaborationSource }
  | { readonly kind: "object"; readonly fields: readonly ElaborationObjectField[] }
  | {
      readonly kind: "child";
      readonly child: string;
      readonly fields: readonly ElaborationObjectField[];
    }
  | {
      readonly kind: "children";
      readonly child: string;
      readonly fields: readonly ElaborationObjectField[];
    }
  | {
      readonly kind: "when";
      readonly condition: ElaborationSource;
      readonly source: ElaborationSource;
    }
  | { readonly kind: "primitive"; readonly name: string; readonly source: ElaborationSource }
  | { readonly kind: "literal"; readonly value: string };

export interface ElaborationObjectField {
  readonly output: string;
  readonly source: ElaborationSource;
}

export type ElaborationField =
  | { readonly kind: "source"; readonly output: string; readonly source: ElaborationSource }
  | {
      readonly kind: "assignments";
      readonly output: string;
      readonly child: string;
      readonly key: string;
      readonly value: string;
      readonly default?: string;
    }
  | {
      readonly kind: "children";
      readonly output: string;
      readonly child: string;
      readonly fields: readonly ElaborationObjectField[];
    };

export interface ElaborationDescriptor {
  readonly name: string;
  readonly hook: string;
  readonly form: string;
  readonly irKind: string;
  readonly resultType: string;
  readonly nameOutput?: string;
  readonly nameSource?: ElaborationSource;
  readonly nameDefault?: string;
  readonly fields: readonly ElaborationField[];
}

export class ElaborationDescriptorSyntaxError extends Error {
  constructor(
    readonly elaborationName: string,
    readonly section: string,
    message: string,
  ) {
    super(message);
    this.name = "ElaborationDescriptorSyntaxError";
  }
}

export function parseElaborationDescriptor(expr: SExpr): ElaborationDescriptor | undefined {
  if (headSym(expr) !== "__projection-plan") return undefined;

  const args = tail(expr);
  const name = args[0] ? trySym(args[0]) : undefined;
  if (!name) {
    throw new ElaborationDescriptorSyntaxError(
      "<anonymous>",
      ":name",
      "__projection-plan is missing its symbol name",
    );
  }

  const clauses = args.slice(1);
  const hook = singleTextClause(name, clauses, "hook");
  const form = singleTextClause(name, clauses, "form");
  const irKind = singleTextClause(name, clauses, "kind");
  const resultType = singleTextClause(name, clauses, "result-type");
  const nameClause = clause("name", clauses);
  const nameSpec = nameClause ? parseNameSpec(name, nameClause) : undefined;

  if (name === hook) {
    throw new ElaborationDescriptorSyntaxError(
      name,
      ":hook",
      `__projection-plan '${name}' must not bind the hook name '${hook}'`,
    );
  }

  return {
    name,
    hook,
    form,
    irKind,
    resultType,
    ...(nameSpec ?? {}),
    fields: clauses.flatMap((item) => {
      const parsed = parseField(name, item);
      return parsed ? [parsed] : [];
    }),
  };
}

function parseNameSpec(
  elaborationName: string,
  nameClause: readonly SExpr[],
): Pick<ElaborationDescriptor, "nameOutput" | "nameSource" | "nameDefault"> {
  if (nameClause.length < 2) {
    throw new ElaborationDescriptorSyntaxError(
      elaborationName,
      ":name",
      `__projection-plan '${elaborationName}' has malformed ':name' section`,
    );
  }

  const nameOutput = valueText(nameClause[0]);
  const nameSource = parseSource(nameClause[1]);
  if (!nameOutput || !nameSource) {
    throw new ElaborationDescriptorSyntaxError(
      elaborationName,
      ":name",
      `__projection-plan '${elaborationName}' has malformed ':name' section`,
    );
  }

  const nameDefault = parseDefault(nameClause.slice(2));
  return {
    nameOutput,
    nameSource,
    ...(nameDefault !== undefined ? { nameDefault } : {}),
  };
}

function singleTextClause(
  elaborationName: string,
  clauses: readonly SExpr[],
  name: string,
): string {
  const values = clause(name, clauses);
  const value = values?.[0] ? valueText(values[0]) : undefined;
  if (!value) {
    throw new ElaborationDescriptorSyntaxError(
      elaborationName,
      `:${name}`,
      `__projection-plan '${elaborationName}' is missing required section ':${name}'`,
    );
  }
  return value;
}

function clause(name: string, clauses: readonly SExpr[]): readonly SExpr[] | undefined {
  const found = clauses.find((item) => headSym(item) === `:${name}`);
  return found?._tag === "List" ? tail(found) : undefined;
}

function valueText(expr: SExpr | undefined): string | undefined {
  if (!expr) return undefined;
  switch (expr._tag) {
    case "Sym":
      return expr.name;
    case "Str":
      return expr.value;
    default:
      return undefined;
  }
}

function parseSource(expr: SExpr | undefined): ElaborationSource | undefined {
  const head = expr ? headSym(expr) : undefined;
  const values = expr ? tail(expr) : [];
  const name = values[0] ? valueText(values[0]) : undefined;
  switch (head) {
    case ":identifier":
      return name ? { kind: "identifier", name } : undefined;
    case ":slot-string":
      return name ? { kind: "slot-string", name } : undefined;
    case ":slot-string-list":
      return name ? { kind: "slot-string-list", name } : undefined;
    case ":slot-symbol":
      return name ? { kind: "slot-symbol", name } : undefined;
    case ":slot-expr":
      return name ? { kind: "slot-expr", name } : undefined;
    case ":slot-runtime-expr":
      return name ? { kind: "slot-runtime-expr", name } : undefined;
    case ":positional": {
      const index = values[0]?._tag === "Num" ? values[0].value : undefined;
      return index !== undefined && Number.isInteger(index)
        ? { kind: "positional", index }
        : undefined;
    }
    case ":loc":
      return values.length === 0 ? { kind: "loc" } : undefined;
    case ":format": {
      const parts = values.map(parseFormatPart);
      return parts.every((part): part is ElaborationSource => part !== undefined)
        ? { kind: "format", parts }
        : undefined;
    }
    case ":default": {
      const source = parseSource(values[0]);
      const fallback = valueText(values[1]);
      return source && fallback !== undefined ? { kind: "default", source, fallback } : undefined;
    }
    case ":first": {
      const sources = values.map(parseSource);
      return sources.length > 0 &&
        sources.every((source): source is ElaborationSource => source !== undefined)
        ? { kind: "first", sources }
        : undefined;
    }
    case ":ref": {
      const refKind = valueText(values[0]);
      const source = parseSource(values[1]);
      return refKind && source ? { kind: "ref", refKind, source } : undefined;
    }
    case ":object": {
      const fields = values.map((value) => parseObjectField("<source>", value));
      return fields.every((field): field is ElaborationObjectField => field !== undefined)
        ? { kind: "object", fields }
        : undefined;
    }
    case ":child":
    case ":children": {
      const child = valueText(values[0]);
      const fields = values.slice(1).map((value) => parseObjectField("<source>", value));
      if (!child || !fields.every((field): field is ElaborationObjectField => field !== undefined))
        return undefined;
      return head === ":child"
        ? { kind: "child", child, fields }
        : { kind: "children", child, fields };
    }
    case ":when": {
      const condition = parseSource(values[0]);
      const source = parseSource(values[1]);
      return condition && source ? { kind: "when", condition, source } : undefined;
    }
    case ":primitive": {
      const primitiveName = valueText(values[0]);
      const source = parseSource(values[1]);
      return primitiveName && source
        ? { kind: "primitive", name: primitiveName, source }
        : undefined;
    }
    case ":literal": {
      const value = valueText(values[0]);
      return value !== undefined ? { kind: "literal", value } : undefined;
    }
    default:
      return undefined;
  }
}

function parseFormatPart(expr: SExpr): ElaborationSource | undefined {
  const source = parseSource(expr);
  if (source) return source;
  const value = valueText(expr);
  return value !== undefined ? { kind: "literal", value } : undefined;
}

function parseDefault(options: readonly SExpr[]): string | undefined {
  const values = clause("default", options);
  return values?.[0] ? valueText(values[0]) : undefined;
}

function parseOption(name: string, options: readonly SExpr[]): string | undefined {
  const values = clause(name, options);
  return values?.[0] ? valueText(values[0]) : undefined;
}

function parseAssignments(
  elaborationName: string,
  output: string,
  expr: SExpr,
): ElaborationField | undefined {
  if (headSym(expr) !== ":assignments") return undefined;
  const values = tail(expr);
  const child = values[0] ? valueText(values[0]) : undefined;
  const key = parseOption("key", values.slice(1));
  const value = parseOption("value", values.slice(1));
  if (!child || !key || !value) {
    throw new ElaborationDescriptorSyntaxError(
      elaborationName,
      ":assignments",
      `__projection-plan '${elaborationName}' has malformed ':assignments' field '${output}'`,
    );
  }
  const defaultValue = parseOption("default", values.slice(1));
  return {
    kind: "assignments",
    output,
    child,
    key,
    value,
    ...(defaultValue !== undefined ? { default: defaultValue } : {}),
  };
}

function parseObjectField(
  elaborationName: string,
  expr: SExpr,
): ElaborationObjectField | undefined {
  if (headSym(expr) !== ":field") return undefined;
  const values = tail(expr);
  const output = values[0] ? valueText(values[0]) : undefined;
  const source = parseSource(values[1]);
  if (!output || !source) {
    throw new ElaborationDescriptorSyntaxError(
      elaborationName,
      ":children",
      `__projection-plan '${elaborationName}' has malformed child ':field'`,
    );
  }
  return { output, source };
}

function parseChildren(
  elaborationName: string,
  output: string,
  expr: SExpr,
): ElaborationField | undefined {
  if (headSym(expr) !== ":children" || parseSource(expr)) return undefined;
  const values = tail(expr);
  const child = values[0] ? valueText(values[0]) : undefined;
  if (!child) {
    throw new ElaborationDescriptorSyntaxError(
      elaborationName,
      ":children",
      `__projection-plan '${elaborationName}' has malformed ':children' field '${output}'`,
    );
  }
  return {
    kind: "children",
    output,
    child,
    fields: values.slice(1).flatMap((item) => {
      const field = parseObjectField(elaborationName, item);
      return field ? [field] : [];
    }),
  };
}

function parseField(elaborationName: string, expr: SExpr): ElaborationField | undefined {
  if (headSym(expr) !== ":field") return undefined;
  const values = tail(expr);
  const output = values[0] ? valueText(values[0]) : undefined;
  const sourceExpr = values[1];
  if (!output || !sourceExpr) {
    throw new ElaborationDescriptorSyntaxError(
      elaborationName,
      ":field",
      `__projection-plan '${elaborationName}' has malformed ':field'`,
    );
  }

  const source = parseSource(sourceExpr);
  if (source) return { kind: "source", output, source };

  return (
    parseAssignments(elaborationName, output, sourceExpr) ??
    parseChildren(elaborationName, output, sourceExpr)
  );
}
